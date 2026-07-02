import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiServer } from "./app.js";
import type { ApiConfig } from "./config.js";
import { addUser } from "./userStore.js";

describe("ai chat API", () => {
  let root: string;
  let config: ApiConfig;
  let app: FastifyInstance;
  let cookie: string;

  async function login(): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "pw" }
    });
    return res.cookies.find((c) => c.name === "gdb_session")?.value ?? "";
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "gdb-chat-"));
    config = {
      host: "127.0.0.1",
      port: 0,
      runnerBaseUrl: "http://127.0.0.1:1",
      runnerWsUrl: "ws://127.0.0.1:1",
      userHomesRoot: root,
      usersFile: path.join(root, "users.json"),
      sessionSecret: "test-secret",
      sessionCookieSecure: false,
      aiEnabled: true,
      llamaBaseUrl: "http://127.0.0.1:1",
      llamaApiKey: "",
      geminiApiKey: "",
      aiDataRoot: path.join(root, "ai-data"),
      aiKeySecret: "test-ai-key-secret",
      antigravityMaxMs: 180000,
      ragDataRoot: path.join(root, "rag-data"),
      ragEmbeddingModel: "gemini-embedding-001",
      ragEmbedDim: 768,
      ragEmbedRpm: 90,
      ragEmbedTpm: 27000,
      ragEmbedRpd: 900,
      ragEmbedBackend: "gemini",
      localEmbedBaseUrl: "http://127.0.0.1:1",
      localEmbedModel: "qwen3-embedding-0.6b",
      localEmbedDim: 1024,
      localEmbedApiKey: ""
    };
    await addUser(config.usersFile, "alice", "pw");
    app = createApiServer(config);
    cookie = await login();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  function authed(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) {
    return app.inject({ method, url, cookies: { gdb_session: cookie }, payload });
  }

  it("rejects every route without a session (401)", async () => {
    for (const [method, url] of [
      ["GET", "/api/ai/models"],
      ["GET", "/api/ai/threads"],
      ["GET", "/api/ai/threads/abc"],
      ["PATCH", "/api/ai/threads/abc"],
      ["DELETE", "/api/ai/threads/abc"],
      ["POST", "/api/ai/chat"]
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("lists only configured backends (no gemini key ⇒ only local llama)", async () => {
    const res = await authed("GET", "/api/ai/models");
    expect(res.statusCode).toBe(200);
    const ids = (res.json().models as { id: string; backend: string }[]).map((m) => m.id);
    expect(ids).toContain("local-gemma-e4b");
    expect(ids).not.toContain("gemini-flash");
    expect(ids).not.toContain("antigravity-agent");
  });

  it("400s an unknown model and a malformed chat body", async () => {
    expect(
      (
        await authed("POST", "/api/ai/chat", {
          model: "does-not-exist",
          workflow: "answer",
          skill: { kind: "language_syntax", language: "c" },
          message: "hi"
        })
      ).statusCode
    ).toBe(400);
    expect((await authed("POST", "/api/ai/chat", { model: "local-gemma-e4b" })).statusCode).toBe(400);
  });

  it("starts with an empty thread list", async () => {
    const res = await authed("GET", "/api/ai/threads");
    expect(res.json().threads).toEqual([]);
  });

  it("per-user key: save → masked status → unlocks gemini models → delete", async () => {
    expect((await authed("GET", "/api/ai/key")).json()).toEqual({ hasKey: false });

    const put = await authed("PUT", "/api/ai/key", { apiKey: "AIzaTESTKEY0001" });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ hasKey: true, last4: "0001" });

    // With a user key, the Google-backed models (gemini + antigravity) appear.
    const withKey = (await authed("GET", "/api/ai/models")).json().models as { id: string }[];
    expect(withKey.map((m) => m.id)).toContain("gemini-flash");
    expect(withKey.map((m) => m.id)).toContain("antigravity-agent");

    expect((await authed("DELETE", "/api/ai/key")).statusCode).toBe(200);
    const after = (await authed("GET", "/api/ai/models")).json().models as { id: string }[];
    expect(after.map((m) => m.id)).not.toContain("gemini-flash");
  });

  it("rejects a too-short api key (400)", async () => {
    expect((await authed("PUT", "/api/ai/key", { apiKey: "short" })).statusCode).toBe(400);
  });
});
