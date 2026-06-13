import websocket from "@fastify/websocket";
import {
  DebugCommandSchema,
  DebugRequestSchema,
  LANGUAGE_CAPABILITIES,
  MAX_REQUEST_BODY_BYTES,
  RunRequestSchema,
  type DebugCommand,
  type DebugEvent,
  type RunEvent
} from "@internal/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type WebSocket from "ws";
import type { RunnerConfig } from "./config.js";
import { DapDebugSession } from "./dapDebugSession.js";
import { DebugSession } from "./debugSession.js";
import { DockerRunner } from "./dockerRunner.js";
import { EventBuffer } from "./eventBuffer.js";

type RunJob = {
  events: EventBuffer<RunEvent>;
  cancel: () => void;
};

type DebugSessionLike = {
  id: string;
  events: EventBuffer<DebugEvent>;
  start: () => Promise<void>;
  handleCommand: (command: DebugCommand) => void;
  close: (manual: boolean) => Promise<void>;
};

type RunnerState = {
  activeJobs: number;
  runJobs: Map<string, RunJob>;
  debugSessions: Map<string, DebugSessionLike>;
  debugByClient: Map<string, string>;
};

export function createRunnerServer(config: RunnerConfig, dockerRunner = new DockerRunner(config)): FastifyInstance {
  const app = Fastify({
    bodyLimit: MAX_REQUEST_BODY_BYTES,
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.body.files[*].content", "req.body.stdin", "req.body.argv"]
    }
  });
  const state: RunnerState = {
    activeJobs: 0,
    runJobs: new Map(),
    debugSessions: new Map(),
    debugByClient: new Map()
  };

  app.register(websocket);

  app.register(async (routes) => {
    routes.get("/health", async (_request, reply) => {
      const readiness = await dockerRunner.readiness();
      return reply.code(readiness.ok ? 200 : 503).send(readiness);
    });

    routes.post<{ Body: unknown }>("/run", async (request, reply) => {
      const parsed = RunRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(parsed.error.issues[0]?.message ?? "Invalid run request");
      }

      if (!tryAcquireJobSlot(state, config.maxConcurrentJobs)) {
        return reply.code(429).send("Runner is busy");
      }

      const id = crypto.randomUUID();
      const events = new EventBuffer<RunEvent>();
      const controller = new AbortController();
      state.runJobs.set(id, { events, cancel: () => controller.abort() });
      events.emit({ type: "ready", id });

      request.log.info({ jobId: id, language: parsed.data.language }, "runner accepted run job");
      void dockerRunner.run(parsed.data, events, controller.signal).finally(() => {
        releaseJobSlot(state);
        setTimeout(() => state.runJobs.delete(id), 5 * 60_000);
      });

      return reply.code(202).send({ id });
    });

    routes.post<{ Params: { id: string } }>("/run/:id/cancel", async (request, reply) => {
      const job = state.runJobs.get(request.params.id);
      if (!job) {
        return reply.code(404).send("Run job not found");
      }

      job.cancel();
      request.log.info({ jobId: request.params.id }, "runner cancelled run job");
      return reply.code(202).send({ ok: true });
    });

    routes.post<{ Body: unknown }>("/debug", async (request, reply) => {
      const parsed = DebugRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(parsed.error.issues[0]?.message ?? "Invalid debug request");
      }

      // Run-only languages (debug:false) have no debug entrypoint — reject before
      // creating a session so we never fall through to a wrong adapter.
      if (!LANGUAGE_CAPABILITIES.find((capability) => capability.id === parsed.data.language)?.debug) {
        return reply.code(400).send(`Debugging is not supported for ${parsed.data.language}`);
      }

      if (state.debugByClient.has(parsed.data.clientId)) {
        return reply.code(409).send("This browser already has an active debug session");
      }

      if (!tryAcquireJobSlot(state, config.maxConcurrentJobs)) {
        return reply.code(429).send("Runner is busy");
      }

      const events = new EventBuffer<DebugEvent>();
      // MI engine only implements C/C++ (debug-c/debug-cpp); every other language
      // (python, rust, …) must use DAP regardless of DEBUG_ENGINE.
      const createDebugSession =
        config.debugEngine === "mi" && (parsed.data.language === "c" || parsed.data.language === "cpp")
          ? DebugSession
          : DapDebugSession;
      const session = new createDebugSession(dockerRunner.docker, config, parsed.data, events, () => {
        state.debugSessions.delete(session.id);
        state.debugByClient.delete(parsed.data.clientId);
        releaseJobSlot(state);
      }, () => undefined);

      state.debugSessions.set(session.id, session);
      state.debugByClient.set(parsed.data.clientId, session.id);
      request.log.info({ debugId: session.id, language: parsed.data.language }, "runner accepted debug session");

      void session.start().catch((error) => {
        events.emit({ type: "error", message: error instanceof Error ? error.message : "Failed to start debug session" });
        void session.close(false);
      });

      return reply.code(202).send({ id: session.id });
    });

    routes.get<{ Params: { id: string } }>("/run/:id", { websocket: true }, (socket, request) => {
      const job = state.runJobs.get(request.params.id);
      if (!job) {
        send(socket, { type: "error", message: "Run job not found" });
        socket.close();
        return;
      }

      const unsubscribe = job.events.subscribe((event) => send(socket, event));
      socket.on("close", unsubscribe);
    });

    routes.get<{ Params: { id: string } }>("/run/:id/events", (request, reply) => {
      const job = state.runJobs.get(request.params.id);
      if (!job) {
        return reply.code(404).send("Run job not found");
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });

      let closed = false;
      let unsubscribe = () => {};
      const cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };
      const writeEvent = (event: RunEvent) => {
        if (closed) {
          return;
        }

        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === "exit" || event.type === "error") {
          cleanup();
          reply.raw.end();
        }
      };
      const heartbeat = setInterval(() => {
        if (!closed) {
          reply.raw.write(": heartbeat\n\n");
        }
      }, 15_000);
      unsubscribe = job.events.subscribe(writeEvent);

      reply.raw.on("close", cleanup);
      return undefined;
    });

    routes.get<{ Params: { id: string } }>("/debug/:id", { websocket: true }, (socket, request) => {
      const session = state.debugSessions.get(request.params.id);
      if (!session) {
        send(socket, { type: "error", message: "Debug session not found" });
        socket.close();
        return;
      }

      const unsubscribe = session.events.subscribe((event) => send(socket, event));
      socket.on("message", (message) => {
        let payload: unknown;
        try {
          payload = JSON.parse(message.toString());
        } catch {
          send(socket, { type: "error", message: "Invalid JSON debug command" });
          return;
        }

        const parsed = DebugCommandSchema.safeParse(payload);
        if (!parsed.success) {
          send(socket, { type: "error", message: parsed.error.issues[0]?.message ?? "Invalid debug command" });
          return;
        }
        session.handleCommand(parsed.data);
      });
      socket.on("close", () => {
        unsubscribe();
        void session.close(false);
      });
    });
  });

  return app;
}

function tryAcquireJobSlot(state: RunnerState, maxConcurrentJobs: number): boolean {
  if (state.activeJobs >= maxConcurrentJobs) {
    return false;
  }

  state.activeJobs += 1;
  return true;
}

function releaseJobSlot(state: RunnerState): void {
  state.activeJobs = Math.max(0, state.activeJobs - 1);
}

function send(socket: WebSocket, event: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}
