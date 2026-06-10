import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { USERNAME_PATTERN } from "@internal/shared";

const BCRYPT_COST = 12;

/**
 * Constant-time decoy: when a username is unknown we still run one bcrypt
 * compare against this hash so login timing doesn't reveal which usernames
 * exist. Computed once at module load.
 */
const DUMMY_HASH = bcrypt.hashSync("decoy-password-for-uniform-timing", BCRYPT_COST);

export type UserRecord = {
  username: string;
  passwordHash: string;
  createdAt: string;
};

type UsersFile = {
  version: 1;
  users: UserRecord[];
};

const EMPTY_STORE: UsersFile = { version: 1, users: [] };

// mtime-keyed cache so admin edits to users.json apply without an api restart,
// without re-reading the file on every login.
const cache = new Map<string, { mtimeMs: number; data: UsersFile }>();

/** Load users.json (cached by mtime). A missing file is an empty store. */
export async function loadUsers(usersFile: string): Promise<UsersFile> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(usersFile)).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return EMPTY_STORE;
    }
    throw error;
  }

  const cached = cache.get(usersFile);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.data;
  }

  const raw = await readFile(usersFile, "utf8");
  const data = normalizeStore(JSON.parse(raw));
  cache.set(usersFile, { mtimeMs, data });
  return data;
}

function normalizeStore(value: unknown): UsersFile {
  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as UsersFile).users)
  ) {
    return { version: 1, users: (value as UsersFile).users };
  }
  return EMPTY_STORE;
}

function findUser(store: UsersFile, username: string): UserRecord | undefined {
  return store.users.find((user) => user.username === username);
}

/**
 * Verify a login against users.json. Always runs exactly one bcrypt compare
 * (decoy hash for unknown users) to keep timing uniform.
 */
export async function verifyLogin(
  usersFile: string,
  username: string,
  password: string
): Promise<boolean> {
  const store = await loadUsers(usersFile);
  const user = findUser(store, username);
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const matches = await bcrypt.compare(password, hash);
  return Boolean(user) && matches;
}

/** Create the user's home directory if missing (mode 0700). Returns its path. */
export async function ensureUserHome(userHomesRoot: string, username: string): Promise<string> {
  const home = path.join(userHomesRoot, username);
  await mkdir(home, { recursive: true, mode: 0o700 });
  return home;
}

// --- Admin operations (used by the users CLI) ------------------------------

async function writeStore(usersFile: string, store: UsersFile): Promise<void> {
  await mkdir(path.dirname(usersFile), { recursive: true });
  const tmp = `${usersFile}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, usersFile);
  cache.delete(usersFile);
}

export async function addUser(
  usersFile: string,
  username: string,
  password: string
): Promise<void> {
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error(`Invalid username "${username}" (3-32 chars, [a-z][a-z0-9_-])`);
  }
  if (password.length < 1) {
    throw new Error("Password must not be empty");
  }
  const store = await loadFresh(usersFile);
  if (findUser(store, username)) {
    throw new Error(`User "${username}" already exists`);
  }
  store.users.push({
    username,
    passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    createdAt: new Date().toISOString()
  });
  await writeStore(usersFile, store);
}

export async function removeUser(usersFile: string, username: string): Promise<void> {
  const store = await loadFresh(usersFile);
  const next = store.users.filter((user) => user.username !== username);
  if (next.length === store.users.length) {
    throw new Error(`User "${username}" not found`);
  }
  await writeStore(usersFile, { version: 1, users: next });
}

export async function listUsers(usersFile: string): Promise<UserRecord[]> {
  return (await loadFresh(usersFile)).users;
}

/** Bypass the mtime cache (admin mutations must read the latest on disk). */
async function loadFresh(usersFile: string): Promise<UsersFile> {
  cache.delete(usersFile);
  const store = await loadUsers(usersFile);
  return { version: 1, users: [...store.users] };
}

// --- Login rate limiter (in-memory, per ip+username) -----------------------

const MAX_FAILS = 5;
const LOCK_MS = 30_000;

export type RateLimiter = {
  isLocked: (key: string) => boolean;
  recordFailure: (key: string) => void;
  reset: (key: string) => void;
};

export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  const attempts = new Map<string, { fails: number; lockedUntil: number }>();

  return {
    isLocked(key) {
      const entry = attempts.get(key);
      return entry !== undefined && entry.lockedUntil > now();
    },
    recordFailure(key) {
      const entry = attempts.get(key) ?? { fails: 0, lockedUntil: 0 };
      entry.fails += 1;
      if (entry.fails >= MAX_FAILS) {
        entry.lockedUntil = now() + LOCK_MS;
        entry.fails = 0;
      }
      attempts.set(key, entry);
    },
    reset(key) {
      attempts.delete(key);
    }
  };
}
