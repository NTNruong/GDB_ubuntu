import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { USERNAME_PATTERN, type UserRole, type UserStatus } from "@internal/shared";

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
  /** Lifecycle: self-registered accounts start `pending` until an admin approves. */
  status: UserStatus;
  role: UserRole;
  /** Bumped on password change / admin reset / "log out everywhere" to invalidate old JWTs. */
  tokenVersion: number;
  displayName?: string;
  email?: string;
  approvedAt?: string;
  /** AES-256-GCM ciphertext of the active TOTP secret (encrypted by the route, opaque here). */
  totpSecretEnc?: string;
  totpEnabled?: boolean;
  /** A not-yet-verified TOTP secret staged during (re-)enrollment; promoted to `totpSecretEnc` on enable. */
  totpPendingEnc?: string;
};

type UsersFile = {
  version: 2;
  users: UserRecord[];
};

const EMPTY_STORE: UsersFile = { version: 2, users: [] };

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
    Array.isArray((value as { users?: unknown }).users)
  ) {
    const raw = (value as { users: unknown[] }).users;
    return { version: 2, users: raw.map(migrateRecord) };
  }
  return EMPTY_STORE;
}

/**
 * Migrate a stored record to the v2 shape. Legacy v1 records (only
 * username/passwordHash/createdAt) become `active` `user` accounts with
 * tokenVersion 0 — so existing CLI-seeded logins keep working. No record is
 * auto-promoted to admin; bootstrap the first admin via `users role <name> admin`.
 */
function migrateRecord(value: unknown): UserRecord {
  const u = (value ?? {}) as Partial<UserRecord> & { username?: string; passwordHash?: string };
  return {
    username: String(u.username ?? ""),
    passwordHash: String(u.passwordHash ?? ""),
    createdAt: u.createdAt ?? new Date().toISOString(),
    status: u.status === "pending" || u.status === "disabled" ? u.status : "active",
    role: u.role === "admin" ? "admin" : "user",
    tokenVersion: typeof u.tokenVersion === "number" ? u.tokenVersion : 0,
    displayName: u.displayName,
    email: u.email,
    approvedAt: u.approvedAt,
    totpSecretEnc: u.totpSecretEnc,
    totpEnabled: u.totpEnabled === true,
    totpPendingEnc: u.totpPendingEnc
  };
}

function findUser(store: UsersFile, username: string): UserRecord | undefined {
  return store.users.find((user) => user.username === username);
}

/**
 * Verify credentials against users.json. Always runs exactly one bcrypt compare
 * (decoy hash for unknown users) to keep timing uniform. Returns the matching
 * record on success (the caller then enforces status/2FA), or null. Status is
 * NOT checked here — that is the login route's job so it can give a tailored
 * "pending" / "disabled" message.
 */
export async function verifyCredentials(
  usersFile: string,
  username: string,
  password: string
): Promise<UserRecord | null> {
  const store = await loadUsers(usersFile);
  const user = findUser(store, username);
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const matches = await bcrypt.compare(password, hash);
  return user && matches ? user : null;
}

/** Read a single user record (cached by mtime). Used by JWT verification. */
export async function getUser(
  usersFile: string,
  username: string
): Promise<UserRecord | undefined> {
  return findUser(await loadUsers(usersFile), username);
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

type NewUserOptions = { role?: UserRole; status?: UserStatus };

/** Build a fresh v2 record (active/user by default). */
async function buildRecord(
  username: string,
  password: string,
  options: NewUserOptions
): Promise<UserRecord> {
  return {
    username,
    passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    createdAt: new Date().toISOString(),
    status: options.status ?? "active",
    role: options.role ?? "user",
    tokenVersion: 0,
    approvedAt: options.status === "pending" ? undefined : new Date().toISOString()
  };
}

function assertValidNewUser(store: UsersFile, username: string, password: string): void {
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error(`Invalid username "${username}" (3-32 chars, [a-z][a-z0-9_-])`);
  }
  if (password.length < 1) {
    throw new Error("Password must not be empty");
  }
  if (findUser(store, username)) {
    throw new Error(`User "${username}" already exists`);
  }
}

/** Admin-create a user (active by default). The CLI/admin path. */
export async function addUser(
  usersFile: string,
  username: string,
  password: string,
  options: NewUserOptions = {}
): Promise<void> {
  const store = await loadFresh(usersFile);
  assertValidNewUser(store, username, password);
  store.users.push(await buildRecord(username, password, options));
  await writeStore(usersFile, store);
}

/** Self-service sign-up — creates a `pending` account awaiting admin approval. */
export async function registerPending(
  usersFile: string,
  username: string,
  password: string,
  displayName?: string
): Promise<void> {
  const store = await loadFresh(usersFile);
  assertValidNewUser(store, username, password);
  const record = await buildRecord(username, password, { status: "pending" });
  if (displayName) {
    record.displayName = displayName;
  }
  store.users.push(record);
  await writeStore(usersFile, store);
}

export async function removeUser(usersFile: string, username: string): Promise<void> {
  const store = await loadFresh(usersFile);
  const next = store.users.filter((user) => user.username !== username);
  if (next.length === store.users.length) {
    throw new Error(`User "${username}" not found`);
  }
  await writeStore(usersFile, { version: 2, users: next });
}

export async function listUsers(usersFile: string): Promise<UserRecord[]> {
  return (await loadFresh(usersFile)).users;
}

/**
 * Find a user, apply `mutate`, and persist. Reads fresh (bypasses the mtime
 * cache) so concurrent admin edits don't clobber each other.
 */
async function mutateUser(
  usersFile: string,
  username: string,
  mutate: (user: UserRecord) => void | Promise<void>
): Promise<UserRecord> {
  const store = await loadFresh(usersFile);
  const user = findUser(store, username);
  if (!user) {
    throw new Error(`User "${username}" not found`);
  }
  await mutate(user);
  await writeStore(usersFile, store);
  return user;
}

/** Approve a pending account → active. */
export function approveUser(usersFile: string, username: string): Promise<UserRecord> {
  return mutateUser(usersFile, username, (user) => {
    if (user.status !== "pending") {
      throw new Error(`User "${username}" is not pending`);
    }
    user.status = "active";
    user.approvedAt = new Date().toISOString();
  });
}

/** Reject a pending account (delete it). No-op-safe for non-pending → throws. */
export async function rejectUser(usersFile: string, username: string): Promise<void> {
  const user = await getUser(usersFile, username);
  if (!user) {
    throw new Error(`User "${username}" not found`);
  }
  if (user.status !== "pending") {
    throw new Error(`User "${username}" is not pending`);
  }
  await removeUser(usersFile, username);
}

export function setStatus(
  usersFile: string,
  username: string,
  status: "active" | "disabled"
): Promise<UserRecord> {
  return mutateUser(usersFile, username, (user) => {
    user.status = status;
    if (status === "disabled") {
      user.tokenVersion += 1; // kick existing sessions
    }
  });
}

export function setRole(usersFile: string, username: string, role: UserRole): Promise<UserRecord> {
  return mutateUser(usersFile, username, (user) => {
    user.role = role;
  });
}

/** Admin reset: set a new password and bump tokenVersion (invalidates old sessions). */
export function adminResetPassword(
  usersFile: string,
  username: string,
  newPassword: string
): Promise<UserRecord> {
  return mutateUser(usersFile, username, async (user) => {
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    user.tokenVersion += 1;
  });
}

/** Self change-password: verify the old password, set the new one, bump tokenVersion. */
export async function changePassword(
  usersFile: string,
  username: string,
  oldPassword: string,
  newPassword: string
): Promise<UserRecord> {
  return mutateUser(usersFile, username, async (user) => {
    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) {
      throw new Error("Current password is incorrect");
    }
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    user.tokenVersion += 1;
  });
}

/** "Log out everywhere" — bump tokenVersion so all issued JWTs stop verifying. */
export function bumpTokenVersion(usersFile: string, username: string): Promise<UserRecord> {
  return mutateUser(usersFile, username, (user) => {
    user.tokenVersion += 1;
  });
}

export function updateProfile(
  usersFile: string,
  username: string,
  patch: { displayName?: string; email?: string }
): Promise<UserRecord> {
  return mutateUser(usersFile, username, (user) => {
    if (patch.displayName !== undefined) {
      user.displayName = patch.displayName || undefined;
    }
    if (patch.email !== undefined) {
      user.email = patch.email || undefined;
    }
  });
}

/**
 * Stage an (already-encrypted) TOTP secret as *pending* (enrollment step 1).
 * Crucially this never touches the active `totpSecretEnc`/`totpEnabled`, so a user
 * (or admin) who starts a re-enrollment ("Change 2FA") but cancels keeps their
 * existing 2FA — abandoning setup can no longer silently disable an admin's 2FA.
 */
export function stageTotpSecret(
  usersFile: string,
  username: string,
  totpPendingEnc: string
): Promise<UserRecord> {
  return mutateUser(usersFile, username, (user) => {
    user.totpPendingEnc = totpPendingEnc;
  });
}

/** Promote the staged secret to active and flip 2FA on, once its code verifies (enrollment step 2). */
export function enableTotp(usersFile: string, username: string): Promise<UserRecord> {
  return mutateUser(usersFile, username, (user) => {
    if (!user.totpPendingEnc) {
      throw new Error("No TOTP secret staged — run setup first");
    }
    user.totpSecretEnc = user.totpPendingEnc;
    user.totpPendingEnc = undefined;
    user.totpEnabled = true;
  });
}

export function clearTotp(usersFile: string, username: string): Promise<UserRecord> {
  return mutateUser(usersFile, username, (user) => {
    user.totpSecretEnc = undefined;
    user.totpPendingEnc = undefined;
    user.totpEnabled = false;
  });
}

/** Bypass the mtime cache (admin mutations must read the latest on disk). */
async function loadFresh(usersFile: string): Promise<UsersFile> {
  cache.delete(usersFile);
  const store = await loadUsers(usersFile);
  return { version: 2, users: [...store.users] };
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
