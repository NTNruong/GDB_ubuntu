import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiServer } from "./app.js";
import type { ApiConfig } from "./config.js";
import { addUser } from "./userStore.js";

describe("file API", () => {
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
    const value = res.cookies.find((c) => c.name === "gdb_session")?.value;
    return value ?? "";
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "gdb-files-"));
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
      antigravityMaxMs: 180000
    };
    await addUser(config.usersFile, "alice", "pw");
    app = createApiServer(config);
    cookie = await login();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  function authed(method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: object) {
    return app.inject({ method, url, cookies: { gdb_session: cookie }, payload });
  }

  it("rejects every route without a session (401)", async () => {
    for (const [method, url] of [
      ["GET", "/api/files/tree"],
      ["GET", "/api/files/content?path=a.c"],
      ["GET", "/api/files/folder?path=sub"],
      ["PUT", "/api/files/content"],
      ["POST", "/api/files/mkdir"],
      ["POST", "/api/files/rename"],
      ["DELETE", "/api/files/entry?path=a.c"]
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("does full CRUD: create, read, tree, rename, delete", async () => {
    expect((await authed("PUT", "/api/files/content", { path: "main.c", content: "int main(){}" })).statusCode).toBe(200);
    expect((await authed("POST", "/api/files/mkdir", { path: "algos" })).statusCode).toBe(200);
    expect((await authed("PUT", "/api/files/content", { path: "algos/sort.c", content: "// sort" })).statusCode).toBe(200);

    const read = await authed("GET", "/api/files/content?path=main.c");
    expect(read.json().content).toBe("int main(){}");

    const tree = await authed("GET", "/api/files/tree");
    const names = (tree.json().entries as { name: string }[]).map((e) => e.name);
    expect(names).toEqual(["algos", "main.c"]);

    const rename = await authed("POST", "/api/files/rename", { path: "main.c", newName: "app.c" });
    expect(rename.json().path).toBe("app.c");

    expect((await authed("DELETE", "/api/files/entry?path=algos")).statusCode).toBe(200);
    const tree2 = await authed("GET", "/api/files/tree");
    expect((tree2.json().entries as { name: string }[]).map((e) => e.name)).toEqual(["app.c"]);
  });

  it("lists top-level regular files of a folder with content", async () => {
    await authed("POST", "/api/files/mkdir", { path: "proj" });
    await authed("PUT", "/api/files/content", { path: "proj/a.c", content: "AAA" });
    await authed("PUT", "/api/files/content", { path: "proj/b.h", content: "BBB" });
    await authed("POST", "/api/files/mkdir", { path: "proj/nested" });

    const res = await authed("GET", "/api/files/folder?path=proj");
    const files = res.json().files as { name: string; content: string }[];
    expect(files.map((f) => f.name).sort()).toEqual(["a.c", "b.h"]);
    expect(files.find((f) => f.name === "a.c")?.content).toBe("AAA");
  });

  it("lists top-level home files when path is empty (root-folder run, ISSUE-053)", async () => {
    await authed("PUT", "/api/files/content", { path: "main.c", content: "int main(){}" });
    await authed("PUT", "/api/files/content", { path: "util.h", content: "// h" });
    await authed("POST", "/api/files/mkdir", { path: "sub" });
    await authed("PUT", "/api/files/content", { path: "sub/nested.c", content: "// nested" });

    const res = await authed("GET", "/api/files/folder?path=");
    expect(res.statusCode).toBe(200);
    const files = res.json().files as { name: string; content: string }[];
    expect(files.map((f) => f.name).sort()).toEqual(["main.c", "util.h"]);
    expect(files.find((f) => f.name === "main.c")?.content).toBe("int main(){}");

    // No `path` query at all behaves the same as the home root.
    const res2 = await authed("GET", "/api/files/folder");
    expect(res2.statusCode).toBe(200);
    expect((res2.json().files as { name: string }[]).map((f) => f.name).sort()).toEqual([
      "main.c",
      "util.h"
    ]);
  });

  it.each([
    "../escape.c",
    "a/../../escape.c",
    "/etc/passwd",
    ".gdbinit",
    "a\\b.c"
  ])("rejects traversal path %s with 400", async (bad) => {
    const res = await authed("GET", `/api/files/content?path=${encodeURIComponent(bad)}`);
    expect(res.statusCode).toBe(400);
  });

  it("404 reading a missing file", async () => {
    expect((await authed("GET", "/api/files/content?path=ghost.c")).statusCode).toBe(404);
  });

  it("409 on mkdir over an existing entry", async () => {
    await authed("POST", "/api/files/mkdir", { path: "dir" });
    expect((await authed("POST", "/api/files/mkdir", { path: "dir" })).statusCode).toBe(409);
  });

  it("409 renaming onto an existing name", async () => {
    await authed("PUT", "/api/files/content", { path: "a.c", content: "" });
    await authed("PUT", "/api/files/content", { path: "b.c", content: "" });
    expect((await authed("POST", "/api/files/rename", { path: "a.c", newName: "b.c" })).statusCode).toBe(409);
  });

  it("rejects a file write above the per-file byte cap (400)", async () => {
    const tooBig = "x".repeat(200_001);
    const res = await authed("PUT", "/api/files/content", { path: "big.c", content: tooBig });
    expect(res.statusCode).toBe(400);
  });

  it("isolates one user's home from another's", async () => {
    await authed("PUT", "/api/files/content", { path: "secret.c", content: "alice-only" });
    await addUser(config.usersFile, "bob", "pw");
    const bobLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "bob", password: "pw" }
    });
    const bobCookie = bobLogin.cookies.find((c) => c.name === "gdb_session")?.value ?? "";
    const bobTree = await app.inject({
      method: "GET",
      url: "/api/files/tree",
      cookies: { gdb_session: bobCookie }
    });
    expect((bobTree.json().entries as unknown[]).length).toBe(0);
  });
});
