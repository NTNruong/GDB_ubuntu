import {
  AI_LEVELS,
  AI_SKILL_KINDS,
  AI_TOPICS,
  AI_WORKFLOW_INFO,
  ChatSendRequestSchema,
  LANGUAGE_CAPABILITIES,
  MAX_AI_HISTORY_MESSAGES,
  ThreadRenameRequestSchema,
  type AiModelsResponse,
  type AiThreadListResponse,
  type AiThreadResponse,
  type AiThreadMessage,
  type ChatMessage
} from "@internal/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiConfig } from "./config.js";
import { enabledModels, findEnabledModel, streamChat } from "./ai/index.js";
import { buildSystemPrompt } from "./ai/prompts.js";
import {
  appendMessages,
  createThread,
  deleteThread,
  listThreads,
  readThread,
  renameThread,
  titleFromMessage
} from "./ai/threads.js";
import { PathError } from "./pathSafety.js";
import { ensureUserHome } from "./userStore.js";

type ErrorResponse = { error: string };

/** Resolve (creating if needed) the authenticated user's AI thread directory. */
async function aiDirFor(request: FastifyRequest, config: ApiConfig): Promise<string> {
  return ensureUserHome(config.aiDataRoot, request.user.sub);
}

function fail(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof PathError) {
    return reply.code(error.status).send({ error: error.message } satisfies ErrorResponse);
  }
  throw error;
}

function sse(reply: FastifyReply, event: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * AI learning-assistant API (Phase 3). Every route is auth-gated; chat threads
 * live under `config.aiDataRoot/<username>/` (separate from the file explorer's
 * home). `POST /api/ai/chat` streams tokens as SSE using the same `reply.hijack`
 * pattern as the run event stream.
 */
export function registerChat(app: FastifyInstance, config: ApiConfig): void {
  const guard = {
    preHandler: (request: FastifyRequest, reply: FastifyReply) => app.authenticate(request, reply)
  };

  app.get<{ Reply: AiModelsResponse }>("/api/ai/models", guard, async (_request, reply) => {
    return reply.send({
      models: enabledModels(config),
      workflows: AI_WORKFLOW_INFO,
      skillKinds: AI_SKILL_KINDS,
      topics: AI_TOPICS,
      levels: AI_LEVELS,
      languages: LANGUAGE_CAPABILITIES.map((cap) => ({ id: cap.id, label: cap.label }))
    });
  });

  app.get<{ Reply: AiThreadListResponse }>("/api/ai/threads", guard, async (request, reply) => {
    const dir = await aiDirFor(request, config);
    return reply.send({ threads: await listThreads(dir) });
  });

  app.get<{ Params: { id: string }; Reply: AiThreadResponse | ErrorResponse }>(
    "/api/ai/threads/:id",
    guard,
    async (request, reply) => {
      try {
        const dir = await aiDirFor(request, config);
        return reply.send(await readThread(dir, request.params.id));
      } catch (error) {
        return fail(reply, error);
      }
    }
  );

  app.patch<{ Params: { id: string }; Body: unknown; Reply: { ok: true } | ErrorResponse }>(
    "/api/ai/threads/:id",
    guard,
    async (request, reply) => {
      const parsed = ThreadRenameRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid rename" });
      }
      try {
        const dir = await aiDirFor(request, config);
        await renameThread(dir, request.params.id, parsed.data.title);
        return reply.send({ ok: true });
      } catch (error) {
        return fail(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string }; Reply: { ok: true } | ErrorResponse }>(
    "/api/ai/threads/:id",
    guard,
    async (request, reply) => {
      try {
        const dir = await aiDirFor(request, config);
        await deleteThread(dir, request.params.id);
        return reply.send({ ok: true });
      } catch (error) {
        return fail(reply, error);
      }
    }
  );

  app.post<{ Body: unknown }>("/api/ai/chat", guard, async (request, reply) => {
    const parsed = ChatSendRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid chat request" });
    }
    const body = parsed.data;

    const model = findEnabledModel(config, body.model);
    if (!model) {
      return reply.code(400).send({ error: `Model "${body.model}" is not available` });
    }

    const dir = await aiDirFor(request, config);

    // Load the target thread (or create a fresh one auto-titled from this message).
    let thread;
    try {
      thread = body.threadId
        ? await readThread(dir, body.threadId)
        : await createThread(dir, model.id, titleFromMessage(body.message));
    } catch (error) {
      return fail(reply, error);
    }

    // Compose the model input: system prompt + recent history + the new message.
    const history: ChatMessage[] = thread.messages
      .slice(-MAX_AI_HISTORY_MESSAGES)
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content }));
    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(body.workflow, body.skill, body.context) },
      ...history,
      { role: "user", content: body.message }
    ];

    const controller = new AbortController();
    reply.raw.on("close", () => controller.abort());

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });

    let assistant = "";
    try {
      for await (const token of streamChat(config, model, messages, controller.signal)) {
        assistant += token;
        sse(reply, { type: "token", data: token });
      }
      sse(reply, { type: "done", threadId: thread.id, title: thread.title });
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : "AI request failed";
        app.log.warn({ err: error, model: model.id }, "ai chat stream failed");
        sse(reply, { type: "error", message });
      }
    } finally {
      // Persist the turn (user message + whatever assistant text we streamed),
      // unless the client disconnected before anything was produced.
      if (!controller.signal.aborted || assistant.length > 0) {
        const now = Date.now();
        const turn: AiThreadMessage[] = [{ role: "user", content: body.message, at: now }];
        if (assistant.length > 0) {
          turn.push({ role: "assistant", content: assistant, at: Date.now() });
        }
        try {
          await appendMessages(dir, thread.id, turn);
        } catch (error) {
          app.log.warn({ err: error, threadId: thread.id }, "failed to persist ai thread");
        }
      }
      reply.raw.end();
    }

    return undefined;
  });
}
