import {
  AI_LEVELS,
  AI_SKILL_KINDS,
  AI_TOPICS,
  AI_WORKFLOW_INFO,
  ApiKeyRequestSchema,
  ChatSendRequestSchema,
  CompactThreadRequestSchema,
  DEFAULT_COMPACT_KEEP,
  LANGUAGE_CAPABILITIES,
  MAX_AI_HISTORY_MESSAGES,
  SetLeafRequestSchema,
  ThreadRenameRequestSchema,
  type AiAgentStep,
  type AiKeyInfoResponse,
  type AiUsage,
  type AiModelsResponse,
  type AiThreadListResponse,
  type AiThreadResponse,
  type ChatMessage,
  type RagCitation
} from "@internal/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiConfig } from "./config.js";
import { enabledModels, findEnabledModel, streamAgent, streamChat } from "./ai/index.js";
import { activeEmbedModelDim, indexFilePath, makeEmbedder } from "./rag/embedderFactory.js";
import { formatDocContext, searchDocs } from "./rag/search.js";
import { JsonVectorStore } from "./rag/store.js";
import { toAgentInput } from "./ai/backends/antigravity.js";
import { runAgent } from "./ai/agent/agentLoop.js";
import { readMemory } from "./ai/agent/tools.js";
import { deleteUserKey, loadUserKey, storeUserKey, userKeyInfo } from "./ai/keystore.js";
import { buildAgentSystemPrompt, buildSummaryPrompt, buildSystemPrompt } from "./ai/prompts.js";
import {
  addNode,
  compactThread,
  createThread,
  deleteSubtree,
  deleteThread,
  listThreads,
  pathToLeaf,
  readThread,
  renameThread,
  setCurrentLeaf,
  titleFromMessage,
  updateThreadMeta
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

  app.get<{ Reply: AiModelsResponse }>("/api/ai/models", guard, async (request, reply) => {
    const dir = await aiDirFor(request, config);
    const info = config.aiKeySecret ? await userKeyInfo(dir, config.aiKeySecret) : { hasKey: false };
    return reply.send({
      models: enabledModels(config, info.hasKey),
      workflows: AI_WORKFLOW_INFO,
      skillKinds: AI_SKILL_KINDS,
      topics: AI_TOPICS,
      levels: AI_LEVELS,
      languages: LANGUAGE_CAPABILITIES.map((cap) => ({ id: cap.id, label: cap.label }))
    });
  });

  app.get<{ Reply: AiKeyInfoResponse }>("/api/ai/key", guard, async (request, reply) => {
    if (!config.aiKeySecret) {
      return reply.send({ hasKey: false });
    }
    const dir = await aiDirFor(request, config);
    return reply.send(await userKeyInfo(dir, config.aiKeySecret));
  });

  app.put<{ Body: unknown; Reply: AiKeyInfoResponse | ErrorResponse }>(
    "/api/ai/key",
    guard,
    async (request, reply) => {
      if (!config.aiKeySecret) {
        return reply.code(503).send({ error: "Per-user API keys are not enabled on this server" });
      }
      const parsed = ApiKeyRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid API key" });
      }
      const dir = await aiDirFor(request, config);
      await storeUserKey(dir, config.aiKeySecret, parsed.data.apiKey.trim());
      return reply.send(await userKeyInfo(dir, config.aiKeySecret));
    }
  );

  app.delete<{ Reply: { ok: true } }>("/api/ai/key", guard, async (request, reply) => {
    const dir = await aiDirFor(request, config);
    await deleteUserKey(dir);
    return reply.send({ ok: true });
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

  app.delete<{ Params: { id: string; nodeId: string }; Reply: { ok: true } | ErrorResponse }>(
    "/api/ai/threads/:id/nodes/:nodeId",
    guard,
    async (request, reply) => {
      try {
        const dir = await aiDirFor(request, config);
        await deleteSubtree(dir, request.params.id, request.params.nodeId);
        return reply.send({ ok: true });
      } catch (error) {
        return fail(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string }; Body: unknown; Reply: { ok: true } | ErrorResponse }>(
    "/api/ai/threads/:id/leaf",
    guard,
    async (request, reply) => {
      const parsed = SetLeafRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid leaf" });
      }
      try {
        const dir = await aiDirFor(request, config);
        await setCurrentLeaf(dir, request.params.id, parsed.data.leafId);
        return reply.send({ ok: true });
      } catch (error) {
        return fail(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string }; Body: unknown; Reply: AiThreadResponse | ErrorResponse }>(
    "/api/ai/threads/:id/compact",
    guard,
    async (request, reply) => {
      const parsed = CompactThreadRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid compact request" });
      }
      const dir = await aiDirFor(request, config);
      const userKey = config.aiKeySecret ? await loadUserKey(dir, config.aiKeySecret) : null;
      const effectiveGeminiKey = userKey ?? config.geminiApiKey;

      // The agentic Antigravity model can't write a plain summary; fall back to the
      // first enabled text (streamChat) model when it's selected.
      const requested = findEnabledModel(config, parsed.data.model, Boolean(userKey));
      const summaryModel =
        requested && requested.backend !== "antigravity"
          ? requested
          : enabledModels(config, Boolean(userKey)).find((model) => model.backend !== "antigravity");
      if (!summaryModel) {
        return reply.code(400).send({ error: "No text model is available to summarize" });
      }

      let thread;
      try {
        thread = await readThread(dir, request.params.id);
      } catch (error) {
        return fail(reply, error);
      }

      const keep = parsed.data.keepRecent ?? DEFAULT_COMPACT_KEEP;
      const fullPath = pathToLeaf(thread, thread.currentLeafId);
      if (fullPath.length <= keep) {
        return reply.send(thread); // nothing old enough to compact
      }
      const older = fullPath.slice(0, -keep);
      const messages: ChatMessage[] = [
        { role: "system", content: buildSummaryPrompt() },
        ...older.map((node) => ({ role: node.role, content: node.content })),
        { role: "user", content: "Hãy tóm tắt cuộc trò chuyện ở trên thành một bản recap ngắn gọn." }
      ];

      const controller = new AbortController();
      request.raw.on("close", () => controller.abort());

      let summary = "";
      try {
        const gen = streamChat(config, summaryModel, messages, controller.signal, effectiveGeminiKey);
        let next = await gen.next();
        while (!next.done) {
          summary += next.value;
          next = await gen.next();
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return reply.code(499).send({ error: "Compact cancelled" });
        }
        const message = error instanceof Error ? error.message : "Summarization failed";
        app.log.warn({ err: error, model: summaryModel.id }, "ai compact summarization failed");
        return reply.code(502).send({ error: message });
      }

      if (!summary.trim()) {
        return reply.code(502).send({ error: "Summarization produced no text" });
      }

      try {
        const compacted = await compactThread(dir, request.params.id, summary.trim(), keep);
        return reply.send(compacted);
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

    const dir = await aiDirFor(request, config);

    // Per-user key takes precedence over the server-wide fallback.
    const userKey = config.aiKeySecret ? await loadUserKey(dir, config.aiKeySecret) : null;
    const effectiveGeminiKey = userKey ?? config.geminiApiKey;

    const model = findEnabledModel(config, body.model, Boolean(userKey));
    if (!model) {
      return reply.code(400).send({ error: `Model "${body.model}" is not available` });
    }

    // Load the target thread (or create a fresh one auto-titled from this message).
    let thread;
    try {
      thread = body.threadId
        ? await readThread(dir, body.threadId)
        : await createThread(dir, model.id, titleFromMessage(body.message));
    } catch (error) {
      return fail(reply, error);
    }

    // Resolve the branch point in the conversation tree. `regenerate` produces a
    // new assistant sibling under an existing user node; a normal send attaches a
    // user node under `parentId` (or the current leaf) then the assistant under it.
    const branchParent = body.parentId ?? thread.currentLeafId;
    if (body.regenerate) {
      const parent = body.parentId ? thread.nodes.find((node) => node.id === body.parentId) : undefined;
      if (!parent || parent.role !== "user") {
        return reply.code(400).send({ error: "regenerate requires a user node parentId" });
      }
    } else if (body.parentId && !thread.nodes.some((node) => node.id === body.parentId)) {
      return reply.code(400).send({ error: `Unknown parentId "${body.parentId}"` });
    }

    // RAG: when the user asks to ground the answer in the documentation corpus,
    // retrieve the most relevant chunks and fold them into the system prompt.
    // Best-effort — a retrieval failure (no key, no index, model error) must not
    // break the chat, so we log and continue without docs.
    let docCitations: RagCitation[] = [];
    let docContext = "";
    // The local embed backend needs no Google key; gate on that OR a resolved Gemini key.
    if (body.useDocs && (config.ragEmbedBackend === "local" || effectiveGeminiKey)) {
      try {
        const embedder = makeEmbedder(config, effectiveGeminiKey);
        if (embedder) {
          const { model: embedModel, dim: embedDim } = activeEmbedModelDim(config);
          const store = new JsonVectorStore(indexFilePath(config), embedModel, embedDim);
          const hits = await searchDocs(store, embedder, body.message);
          if (hits.length > 0) {
            docContext = formatDocContext(hits);
            docCitations = hits.map((hit, index) => ({
              n: index + 1,
              doc: hit.doc,
              headingPath: hit.headingPath,
              sourceUrl: hit.sourceUrl
            }));
          }
        }
      } catch (error) {
        app.log.warn({ err: error }, "rag retrieval failed; answering without docs");
      }
    }

    // Compose the model input: system prompt (+ retrieved doc context) + the active
    // branch's history. For a regenerate the path already ends at the user node;
    // otherwise append the new message.
    const systemPrompt =
      buildSystemPrompt(body.workflow, body.skill, body.context, body.attachments) +
      (docContext ? `\n\n${docContext}` : "");
    const historyLeaf = body.regenerate ? body.parentId ?? null : branchParent;
    const history: ChatMessage[] = pathToLeaf(thread, historyLeaf)
      .slice(-MAX_AI_HISTORY_MESSAGES)
      .map((node) => ({ role: node.role, content: node.content }));
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history,
      ...(body.regenerate ? [] : [{ role: "user" as const, content: body.message }])
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

    // Surface the retrieved sources before tokens so the UI can render citations.
    if (docCitations.length > 0) {
      sse(reply, { type: "docs", citations: docCitations });
    }

    let assistant = "";
    const agentSteps: AiAgentStep[] = [];
    let agentMeta: { interactionId?: string; environmentId?: string } | undefined;
    let usage: AiUsage | undefined;
    let persisted = false;

    // Persist the turn into the tree: (maybe) a user node, then the assistant node,
    // making the assistant the new current leaf. Idempotent via `persisted`.
    const persistTurn = async (): Promise<void> => {
      if (persisted) {
        return;
      }
      persisted = true;
      try {
        const assistantParent = body.regenerate
          ? (body.parentId as string)
          : (await addNode(dir, thread.id, { parentId: branchParent, role: "user", content: body.message })).id;
        if (assistant.length > 0) {
          await addNode(dir, thread.id, {
            parentId: assistantParent,
            role: "assistant",
            content: assistant,
            steps: agentSteps,
            model: model.id
          });
        }
        if (agentMeta && (agentMeta.interactionId || agentMeta.environmentId)) {
          await updateThreadMeta(dir, thread.id, agentMeta);
        }
      } catch (error) {
        app.log.warn({ err: error, threadId: thread.id }, "failed to persist ai thread");
      }
    };

    try {
      if (model.backend === "antigravity") {
        // Agentic path: yields rich events (answer tokens + tool/code/image steps)
        // and returns the interaction/environment ids for multi-turn continuation.
        const input = toAgentInput(systemPrompt, body.message, Boolean(thread.interactionId));
        const agent = streamAgent(config, model, input, controller.signal, effectiveGeminiKey, {
          previousInteractionId: thread.interactionId,
          environmentId: thread.environmentId
        });
        let next = await agent.next();
        while (!next.done) {
          const event = next.value;
          if (event.type === "token") {
            assistant += event.data;
          } else if (event.type === "step") {
            agentSteps.push(event.step);
          }
          sse(reply, event);
          next = await agent.next();
        }
        agentMeta = next.value;
      } else if (body.useAgent && model.agent && effectiveGeminiKey) {
        // Local agent tool-loop (Gemini function-calling): reads the learner's code,
        // searches the docs, proposes edits + maintains STUDY_PLAN.md / MEMORY.md.
        // Yields the same token/step events as the Antigravity path.
        const userHome = await ensureUserHome(config.userHomesRoot, request.user.sub);
        const memory = await readMemory(userHome);
        const embedder = makeEmbedder(config, effectiveGeminiKey);
        const { model: embedModel, dim: embedDim } = activeEmbedModelDim(config);
        const store = new JsonVectorStore(indexFilePath(config), embedModel, embedDim);
        const agentSystemPrompt = buildAgentSystemPrompt(
          body.workflow,
          body.skill,
          memory,
          body.context,
          body.attachments
        );
        // For a regenerate the branch history already ends with the user turn, so
        // drop it and re-supply it as the agent's user message (avoid duplication).
        const agentHistory = body.regenerate ? history.slice(0, -1) : history;
        const agent = runAgent(
          effectiveGeminiKey,
          model.remoteModelId,
          agentSystemPrompt,
          agentHistory,
          body.message,
          { userHome, store, embedder, log: app.log },
          controller.signal
        );
        let next = await agent.next();
        while (!next.done) {
          const event = next.value;
          if (event.type === "token") {
            assistant += event.data;
          } else if (event.type === "step") {
            agentSteps.push(event.step);
          }
          sse(reply, event);
          next = await agent.next();
        }
        usage = next.value;
      } else {
        // Manual iteration (not for-await) so we can read the generator's return
        // value — the token usage reported on the final chunk.
        const chat = streamChat(
          config,
          model,
          messages,
          controller.signal,
          effectiveGeminiKey,
          body.reasoningEffort,
          body.showThinking
        );
        let next = await chat.next();
        while (!next.done) {
          assistant += next.value;
          sse(reply, { type: "token", data: next.value });
          next = await chat.next();
        }
        usage = next.value;
      }
      // Persist BEFORE `done` so the client's post-done reload sees the new nodes.
      await persistTurn();
      sse(reply, { type: "done", threadId: thread.id, title: thread.title, ...(usage ? { usage } : {}) });
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : "AI request failed";
        app.log.warn({ err: error, model: model.id }, "ai chat stream failed");
        sse(reply, { type: "error", message });
      }
    } finally {
      // Aborted mid-stream but we produced some text → still save it.
      if (!persisted && assistant.length > 0) {
        await persistTurn();
      }
      reply.raw.end();
    }

    return undefined;
  });
}
