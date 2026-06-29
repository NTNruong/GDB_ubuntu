import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addUser,
  adminResetPassword,
  approveUser,
  changePassword,
  createRateLimiter,
  ensureUserHome,
  getUser,
  listUsers,
  loadUsers,
  registerPending,
  removeUser,
  setRole,
  setStatus,
  verifyCredentials
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
    expect(await loadUsers(usersFile)).toEqual({ version: 2, users: [] });
  });

  it("adds an active user with default role/status", async () => {
    await addUser(usersFile, "alice", "s3cret-pass");
    const users = await listUsers(usersFile);
    expect(users.map((u) => u.username)).toEqual(["alice"]);
    expect(users[0]?.passwordHash).not.toContain("s3cret-pass");
    expect(users[0]?.status).toBe("active");
    expect(users[0]?.role).toBe("user");
    expect(users[0]?.tokenVersion).toBe(0);

    expect(await verifyCredentials(usersFile, "alice", "s3cret-pass")).not.toBeNull();
    expect(await verifyCredentials(usersFile, "alice", "wrong")).toBeNull();
    expect(await verifyCredentials(usersFile, "ghost", "whatever")).toBeNull();
  });

  it("registers a pending account and approves it", async () => {
    await registerPending(usersFile, "newbie", "pw", "New Bie");
    let user = await getUser(usersFile, "newbie");
    expect(user?.status).toBe("pending");
    expect(user?.displayName).toBe("New Bie");
    // Credentials are valid even while pending — the login route enforces status.
    expect(await verifyCredentials(usersFile, "newbie", "pw")).not.toBeNull();

    await approveUser(usersFile, "newbie");
    user = await getUser(usersFile, "newbie");
    expect(user?.status).toBe("active");
    expect(user?.approvedAt).toBeTruthy();
    await expect(approveUser(usersFile, "newbie")).rejects.toThrow(/not pending/);
  });

  it("bumps tokenVersion on password change, admin reset and disable", async () => {
    await addUser(usersFile, "eve", "pw1");
    await changePassword(usersFile, "eve", "pw1", "pw2");
    expect((await getUser(usersFile, "eve"))?.tokenVersion).toBe(1);
    await expect(changePassword(usersFile, "eve", "wrong", "pw3")).rejects.toThrow(/incorrect/);

    await adminResetPassword(usersFile, "eve", "pw9");
    expect((await getUser(usersFile, "eve"))?.tokenVersion).toBe(2);
    expect(await verifyCredentials(usersFile, "eve", "pw9")).not.toBeNull();

    await setStatus(usersFile, "eve", "disabled");
    expect((await getUser(usersFile, "eve"))?.tokenVersion).toBe(3);
  });

  it("migrates a legacy v1 record to active/user on read", async () => {
    await writeFile(
      usersFile,
      JSON.stringify({
        version: 1,
        users: [{ username: "legacy", passwordHash: "x", createdAt: "2020-01-01T00:00:00.000Z" }]
      })
    );
    const user = await getUser(usersFile, "legacy");
    expect(user?.status).toBe("active");
    expect(user?.role).toBe("user");
    expect(user?.tokenVersion).toBe(0);
    await setRole(usersFile, "legacy", "admin");
    expect((await getUser(usersFile, "legacy"))?.role).toBe("admin");
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
    expect(await verifyCredentials(usersFile, "dave", "pw")).not.toBeNull();
    await removeUser(usersFile, "dave");
    expect(await verifyCredentials(usersFile, "dave", "pw")).toBeNull();
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
