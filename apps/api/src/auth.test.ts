import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiServer } from "./app.js";
import type { ApiConfig } from "./config.js";
import { addUser } from "./userStore.js";

describe("auth routes", () => {
  let root: string;
  let config: ApiConfig;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "gdb-auth-"));
    config = {
      host: "127.0.0.1",
      port: 0,
      runnerBaseUrl: "http://127.0.0.1:1",
      runnerWsUrl: "ws://127.0.0.1:1",
      userHomesRoot: root,
      usersFile: path.join(root, "users.json"),
      sessionSecret: "test-secret-please-ignore",
      sessionCookieSecure: false
    };
    await addUser(config.usersFile, "alice", "correct-horse");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("rejects a wrong password with 401 and no cookie", async () => {
    const app = createApiServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "nope" }
    });
    await app.close();
    expect(res.statusCode).toBe(401);
    expect(res.cookies).toEqual([]);
  });

  it("logs in, sets an HttpOnly cookie, and serves /me", async () => {
    const app = createApiServer(config);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "correct-horse" }
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ username: "alice" });
    const cookie = login.cookies.find((c) => c.name === "gdb_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe("lax");

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { gdb_session: cookie!.value }
    });
    await app.close();
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ username: "alice" });
  });

  it("returns 401 from /me without a cookie", async () => {
    const app = createApiServer(config);
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("locks out after 5 failed attempts (429)", async () => {
    const app = createApiServer(config);
    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "alice", password: "nope" }
      });
    }
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "correct-horse" }
    });
    await app.close();
    expect(res.statusCode).toBe(429);
  });

  it("clears the cookie on logout", async () => {
    const app = createApiServer(config);
    const res = await app.inject({ method: "POST", url: "/api/auth/logout" });
    await app.close();
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "gdb_session");
    expect(cookie?.value).toBe("");
  });
});
