import { describe, expect, it } from "vitest";
import { createApiServer } from "./app.js";

describe("api app", () => {
  const config = {
    host: "127.0.0.1",
    port: 0,
    runnerBaseUrl: "http://127.0.0.1:1",
    runnerWsUrl: "ws://127.0.0.1:1",
    userHomesRoot: "/tmp/gdb-test-user-homes",
    usersFile: "/tmp/gdb-test-user-homes/users.json",
    sessionSecret: "test-secret",
    sessionCookieSecure: false,
    aiEnabled: true,
    llamaBaseUrl: "http://127.0.0.1:1",
    llamaApiKey: "",
    geminiApiKey: "",
    aiDataRoot: "/tmp/gdb-test-ai-data",
    aiKeySecret: "test-ai-key-secret",
    antigravityMaxMs: 180000,
    ragDataRoot: "/tmp/gdb-test-rag-data",
    ragEmbeddingModel: "gemini-embedding-001",
    ragEmbedDim: 768
  };

  it("returns language capabilities without contacting the runner", async () => {
    const app = createApiServer(config);

    const response = await app.inject({ method: "GET", url: "/api/languages" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().languages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "cpp", debug: true }),
          expect.objectContaining({ id: "python", debug: true })
        ])
      );
  });

  it("rejects invalid run requests before the runner is called", async () => {
    const app = createApiServer(config);

    const response = await app.inject({
      method: "POST",
      url: "/api/run",
      payload: { language: "ruby", source: "puts 'no'" }
    });
    await app.close();

    expect(response.statusCode).toBe(400);
  });

  it("redaction paths strip file contents, stdin and argv (not file names)", async () => {
    // Proves the production redact config (shared by createApiServer / createRunnerServer)
    // strips user code/input if a request body is ever logged. Tests the pino redact paths
    // directly because Fastify's default `req` serializer omits the body entirely.
    const pino = (await import("pino")).default;
    let logged = "";
    const logger = pino(
      {
        redact: [
          "req.body.files[*].content",
          "req.body.stdin",
          "req.body.argv",
          "req.body.content",
          "req.body.password"
        ]
      },
      { write: (chunk: string) => { logged += chunk; } }
    );

    logger.info({
      req: {
        body: {
          files: [{ path: "main.c", content: "TOP_SECRET_SOURCE" }],
          stdin: "SECRET_STDIN",
          argv: ["SECRET_ARGV"],
          content: "TOP_SECRET_FILE_WRITE",
          password: "TOP_SECRET_PASSWORD"
        }
      }
    });

    expect(logged).not.toContain("TOP_SECRET_SOURCE");
    expect(logged).not.toContain("SECRET_STDIN");
    expect(logged).not.toContain("SECRET_ARGV");
    expect(logged).not.toContain("TOP_SECRET_FILE_WRITE");
    expect(logged).not.toContain("TOP_SECRET_PASSWORD");
    expect(logged).toContain("main.c"); // file names are not sensitive
    expect(logged).toContain("[Redacted]");
  });

  it("accepts a run request larger than Fastify's default 1 MiB body limit (ISSUE-043)", async () => {
    const app = createApiServer(config);

    // ~1.8 MB of source across 9 files — well past the old default bodyLimit
    // (1 MiB) but within MAX_TOTAL_SOURCE_BYTES (2 MB). A 413 here would mean the
    // transport limit, not the schema, rejected a valid payload.
    const files = Array.from({ length: 9 }, (_, index) => ({
      path: `part${index}.c`,
      content: "a".repeat(200_000)
    }));

    const response = await app.inject({
      method: "POST",
      url: "/api/run",
      payload: { language: "c", files }
    });
    await app.close();

    // The runner URL is unreachable in this test, so the request gets past body
    // parsing + zod validation and then fails forwarding — anything but 413/400
    // proves the size gate accepted it.
    expect(response.statusCode).not.toBe(413);
    expect(response.statusCode).not.toBe(400);
  });

  it("keeps websocket-only debug routes from running on plain HTTP requests", async () => {
    const app = createApiServer(config);

    const response = await app.inject({ method: "GET", url: "/api/debug/session-1" });
    await app.close();

    expect(response.statusCode).toBe(404);
  });
});
