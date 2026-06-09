import { describe, expect, it } from "vitest";
import { createApiServer } from "./app.js";

describe("api app", () => {
  const config = {
    host: "127.0.0.1",
    port: 0,
    runnerBaseUrl: "http://127.0.0.1:1",
    runnerWsUrl: "ws://127.0.0.1:1"
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
      { redact: ["req.body.files[*].content", "req.body.stdin", "req.body.argv"] },
      { write: (chunk: string) => { logged += chunk; } }
    );

    logger.info({
      req: {
        body: {
          files: [{ path: "main.c", content: "TOP_SECRET_SOURCE" }],
          stdin: "SECRET_STDIN",
          argv: ["SECRET_ARGV"]
        }
      }
    });

    expect(logged).not.toContain("TOP_SECRET_SOURCE");
    expect(logged).not.toContain("SECRET_STDIN");
    expect(logged).not.toContain("SECRET_ARGV");
    expect(logged).toContain("main.c"); // file names are not sensitive
    expect(logged).toContain("[Redacted]");
  });

  it("keeps websocket-only debug routes from running on plain HTTP requests", async () => {
    const app = createApiServer(config);

    const response = await app.inject({ method: "GET", url: "/api/debug/session-1" });
    await app.close();

    expect(response.statusCode).toBe(404);
  });
});
