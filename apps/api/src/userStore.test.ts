import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addUser,
  createRateLimiter,
  ensureUserHome,
  listUsers,
  loadUsers,
  removeUser,
  verifyLogin
} from "./userStore.js";

describe("userStore", () => {
  let root: string;
  let usersFile: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "gdb-userstore-"));
    usersFile = path.join(root, "users.json");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads an empty store when the file is missing", async () => {
    expect(await loadUsers(usersFile)).toEqual({ version: 1, users: [] });
  });

  it("adds, lists and verifies a user", async () => {
    await addUser(usersFile, "alice", "s3cret-pass");
    const users = await listUsers(usersFile);
    expect(users.map((u) => u.username)).toEqual(["alice"]);
    expect(users[0]?.passwordHash).not.toContain("s3cret-pass");

    expect(await verifyLogin(usersFile, "alice", "s3cret-pass")).toBe(true);
    expect(await verifyLogin(usersFile, "alice", "wrong")).toBe(false);
    expect(await verifyLogin(usersFile, "ghost", "whatever")).toBe(false);
  });

  it("rejects duplicate users and invalid usernames", async () => {
    await addUser(usersFile, "bob", "pw");
    await expect(addUser(usersFile, "bob", "pw2")).rejects.toThrow(/already exists/);
    await expect(addUser(usersFile, "Bad Name", "pw")).rejects.toThrow(/Invalid username/);
  });

  it("removes a user", async () => {
    await addUser(usersFile, "carol", "pw");
    await removeUser(usersFile, "carol");
    expect(await listUsers(usersFile)).toEqual([]);
    await expect(removeUser(usersFile, "carol")).rejects.toThrow(/not found/);
  });

  it("reflects edits after the file changes (mtime cache invalidation)", async () => {
    await addUser(usersFile, "dave", "pw");
    expect(await verifyLogin(usersFile, "dave", "pw")).toBe(true);
    await removeUser(usersFile, "dave");
    expect(await verifyLogin(usersFile, "dave", "pw")).toBe(false);
  });

  it("creates the user home directory with mode 0700", async () => {
    const home = await ensureUserHome(root, "alice");
    expect(home).toBe(path.join(root, "alice"));
    await expect(readdir(home)).resolves.toEqual([]);
    if (process.platform !== "win32") {
      const mode = (await stat(home)).mode & 0o777;
      expect(mode).toBe(0o700);
    }
  });
});

describe("rate limiter", () => {
  it("locks after 5 failures and unlocks after the window", () => {
    let clock = 1_000;
    const limiter = createRateLimiter(() => clock);
    const key = "1.2.3.4:alice";

    for (let i = 0; i < 4; i += 1) {
      limiter.recordFailure(key);
      expect(limiter.isLocked(key)).toBe(false);
    }
    limiter.recordFailure(key);
    expect(limiter.isLocked(key)).toBe(true);

    clock += 30_001;
    expect(limiter.isLocked(key)).toBe(false);
  });

  it("reset clears the failure count", () => {
    const limiter = createRateLimiter();
    const key = "1.2.3.4:bob";
    limiter.recordFailure(key);
    limiter.reset(key);
    expect(limiter.isLocked(key)).toBe(false);
  });
});
