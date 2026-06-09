import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import {
  DebugRequestSchema,
  LANGUAGE_CAPABILITIES,
  RunRequestSchema,
  type HealthResponse,
  type JobCreateResponse
} from "@internal/shared";
import Fastify, { type FastifyInstance } from "fastify";
import WebSocket from "ws";
import type { ApiConfig } from "./config.js";

type ErrorResponse = {
  error: string;
};

export function createApiServer(config: ApiConfig): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.body.files[*].content", "req.body.stdin", "req.body.argv"]
    }
  });

  app.register(cors, {
    origin: true
  });
  app.register(websocket);

  app.register(async (routes) => {
    routes.get("/api/health", async (): Promise<HealthResponse> => {
      let runner = false;
      try {
        const response = await fetch(`${config.runnerBaseUrl}/health`, {
          signal: AbortSignal.timeout(2_000)
        });
        runner = response.ok;
      } catch {
        runner = false;
      }

      return { ok: true, runner };
    });

    routes.get("/api/languages", async () => ({
      languages: LANGUAGE_CAPABILITIES
    }));

    routes.post<{ Body: unknown; Reply: JobCreateResponse | ErrorResponse }>("/api/run", async (request, reply) => {
      const parsed = RunRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid run request" });
      }

      const response = await fetch(`${config.runnerBaseUrl}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data)
      });

      if (!response.ok) {
        const text = await response.text();
        return reply.code(response.status).send({ error: text || "Runner rejected the job" });
      }

      const body = (await response.json()) as JobCreateResponse;
      request.log.info({ jobId: body.id, language: parsed.data.language }, "run job created");
      return reply.code(202).send(body);
    });

    routes.post<{ Body: unknown; Reply: JobCreateResponse | ErrorResponse }>("/api/debug", async (request, reply) => {
      const parsed = DebugRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid debug request" });
      }

      const response = await fetch(`${config.runnerBaseUrl}/debug`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data)
      });

      if (!response.ok) {
        const text = await response.text();
        return reply.code(response.status).send({ error: text || "Runner rejected the debug session" });
      }

      const body = (await response.json()) as JobCreateResponse;
      request.log.info({ debugId: body.id, language: parsed.data.language }, "debug session created");
      return reply.code(202).send(body);
    });

    routes.get<{ Params: { id: string } }>("/api/run/:id", { websocket: true }, (client, request) => {
      proxyWebSocket(client, `${config.runnerWsUrl}/run/${encodeURIComponent(request.params.id)}`);
    });

    routes.get<{ Params: { id: string } }>("/api/run/:id/events", async (request, reply) => {
      const controller = new AbortController();
      reply.raw.on("close", () => controller.abort());

      const response = await fetch(`${config.runnerBaseUrl}/run/${encodeURIComponent(request.params.id)}/events`, {
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        return reply.code(response.status).send(text || "Runner event stream is unavailable");
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });

      try {
        for await (const chunk of response.body) {
          reply.raw.write(chunk);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          app.log.warn({ err: error, jobId: request.params.id }, "run event stream failed");
        }
      } finally {
        reply.raw.end();
      }

      return undefined;
    });

    routes.get<{ Params: { id: string } }>("/api/debug/:id", { websocket: true }, (client, request) => {
      proxyWebSocket(client, `${config.runnerWsUrl}/debug/${encodeURIComponent(request.params.id)}`);
    });
  });

  return app;
}

function proxyWebSocket(client: WebSocket, upstreamUrl: string): void {
  const upstream = new WebSocket(upstreamUrl);

  const closeBoth = () => {
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close();
    }
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  };

  upstream.on("open", () => {
    client.on("message", (message, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(message, { binary: isBinary });
      }
    });
  });

  upstream.on("message", (message, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message, { binary: isBinary });
    }
  });

  upstream.on("error", () => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "error", message: "Runner websocket is unavailable" }));
    }
    closeBoth();
  });

  client.on("close", closeBoth);
  upstream.on("close", () => {
    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
  });
}
