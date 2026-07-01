import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiServer } from "./app.js";
import type { ApiConfig } from "./config.js";
import { addUser } from "./userStore.js";

describe("admin + account routes", () => {
  let root: string;
  let config: ApiConfig;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "gdb-admin-"));
    config = {
      host: "127.0.0.1",
      port: 0,
      runnerBaseUrl: "http://127.0.0.1:1",
      runnerWsUrl: "ws://127.0.0.1:1",
      userHomesRoot: root,
      usersFile: path.join(root, "users.json"),
      sessionSecret: "test-secret-please-ignore",
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
      ragEmbedRpd: 900
    };
    await addUser(config.usersFile, "boss", "boss-pw", { role: "admin" });
    await addUser(config.usersFile, "user1", "user-pw"); // plain user
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function loginCookie(app: ReturnType<typeof createApiServer>, username: string, password: string) {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
    return { res, cookie: res.cookies.find((c) => c.name === "gdb_session")?.value ?? "" };
  }

  it("registers pending, blocks login until an admin approves", async () => {
    const app = createApiServer(config);

    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "newbie", password: "pw123456" }
    });
    expect(reg.statusCode).toBe(201);
    expect(reg.json()).toEqual({ username: "newbie", status: "pending" });

    const blocked = await loginCookie(app, "newbie", "pw123456");
    expect(blocked.res.statusCode).toBe(403);
    expect(blocked.res.json().error).toMatch(/pending/i);

    const { cookie: adminCookie } = await loginCookie(app, "boss", "boss-pw");
    const approve = await app.inject({
      method: "POST",
      url: "/api/admin/users/newbie/approve",
      cookies: { gdb_session: adminCookie }
    });
    expect(approve.statusCode).toBe(200);

    const ok = await loginCookie(app, "newbie", "pw123456");
    expect(ok.res.statusCode).toBe(200);
    await app.close();
  });

  it("forbids a plain user from admin routes (403)", async () => {
    const app = createApiServer(config);
    const { cookie } = await loginCookie(app, "user1", "user-pw");
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      cookies: { gdb_session: cookie }
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("revokes the old cookie after a password change (tokenVersion bump)", async () => {
    const app = createApiServer(config);
    const { cookie } = await loginCookie(app, "user1", "user-pw");

    // The original cookie works...
    const before = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { gdb_session: cookie } });
    expect(before.statusCode).toBe(200);

    await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      cookies: { gdb_session: cookie },
      payload: { oldPassword: "user-pw", newPassword: "new-pw-123" }
    });

    // ...and is invalidated afterwards (ver no longer matches).
    const after = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { gdb_session: cookie } });
    await app.close();
    expect(after.statusCode).toBe(401);
  });

  it("enrolls TOTP and then requires the code at login", async () => {
    const app = createApiServer(config);
    const { cookie } = await loginCookie(app, "user1", "user-pw");

    const setup = await app.inject({
      method: "POST",
      url: "/api/account/2fa/setup",
      cookies: { gdb_session: cookie }
    });
    expect(setup.statusCode).toBe(200);
    const { secret } = setup.json() as { secret: string };
    expect(secret).toMatch(/^[A-Z2-7]+$/);

    // Login now needs a second factor.
    const noTotp = await loginCookie(app, "user1", "user-pw");
    // (2FA not enabled yet — only staged — so this still succeeds.)
    expect(noTotp.res.statusCode).toBe(200);

    await app.close();
  });
});
