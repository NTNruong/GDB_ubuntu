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

  it("keeps websocket-only debug routes from running on plain HTTP requests", async () => {
    const app = createApiServer(config);

    const response = await app.inject({ method: "GET", url: "/api/debug/session-1" });
    await app.close();

    expect(response.statusCode).toBe(404);
  });
});
