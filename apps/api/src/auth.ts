import { randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  type AuthMeResponse,
  type RegisterResponse,
  type UserRole
} from "@internal/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { decryptSecret } from "./ai/keystore.js";
import type { ApiConfig } from "./config.js";
import { verifyTotp } from "./totp.js";
import {
  changePassword,
  createRateLimiter,
  ensureUserHome,
  getUser,
  registerPending,
  verifyCredentials,
  type UserRecord
} from "./userStore.js";

const COOKIE_NAME = "gdb_session";
const SESSION_TTL = "7d";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** The authenticated user's record, attached by `authenticate`. */
    account?: UserRecord;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; ver: number; role: UserRole };
    user: { sub: string; ver: number; role: UserRole };
  }
}

type ErrorResponse = { error: string };

function toMe(user: UserRecord): AuthMeResponse {
  return {
    username: user.username,
    role: user.role,
    status: user.status,
    displayName: user.displayName,
    email: user.email,
    twoFactorEnabled: user.totpEnabled === true
  };
}

/**
 * Register cookie-based JWT auth + the /api/auth routes on the top-level app,
 * and decorate `app.authenticate` / `app.requireAdmin` so route plugins gate
 * themselves. The signed cookie carries the user's `tokenVersion`; a mismatch
 * (password change, admin reset, "log out everywhere") invalidates it without
 * any server-side session store.
 */
export function registerAuth(app: FastifyInstance, config: ApiConfig): void {
  let secret = config.sessionSecret;
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    app.log.warn(
      "SESSION_SECRET is not set — using an ephemeral secret; all sessions reset on restart"
    );
  }

  app.register(cookie);
  app.register(jwt, {
    secret,
    cookie: { cookieName: COOKIE_NAME, signed: false }
  });

  app.decorateRequest("account", undefined);

  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      await reply.code(401).send({ error: "Unauthorized" } satisfies ErrorResponse);
      return;
    }
    // Re-check the live record so a revoked/disabled/role-changed account can't
    // keep riding a still-valid cookie. Cheap: getUser is mtime-cached.
    const user = await getUser(config.usersFile, request.user.sub);
    if (!user || user.status !== "active" || user.tokenVersion !== request.user.ver) {
      await reply.code(401).send({ error: "Unauthorized" } satisfies ErrorResponse);
      return;
    }
    request.account = user;
  });

  app.decorate("requireAdmin", async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply);
    if (reply.sent) {
      return;
    }
    if (request.account?.role !== "admin") {
      await reply.code(403).send({ error: "Forbidden" } satisfies ErrorResponse);
    }
  });

  async function issueSession(reply: FastifyReply, user: UserRecord): Promise<void> {
    const token = await reply.jwtSign(
      { sub: user.username, ver: user.tokenVersion, role: user.role },
      { expiresIn: SESSION_TTL }
    );
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: config.sessionCookieSecure,
      maxAge: SESSION_MAX_AGE
    });
  }

  const limiter = createRateLimiter();

  // Self-service sign-up → pending account awaiting admin approval (no session).
  app.post<{ Body: unknown; Reply: RegisterResponse | ErrorResponse }>(
    "/api/auth/register",
    async (request, reply) => {
      const parsed = RegisterRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Invalid registration" });
      }
      const { username, password, displayName } = parsed.data;
      try {
        await registerPending(config.usersFile, username, password, displayName);
      } catch (error) {
        return reply.code(409).send({ error: error instanceof Error ? error.message : "Failed" });
      }
      request.log.info({ username }, "user registered (pending approval)");
      return reply.code(201).send({ username, status: "pending" });
    }
  );

  app.post<{ Body: unknown; Reply: AuthMeResponse | (ErrorResponse & { totpRequired?: boolean }) }>(
    "/api/auth/login",
    async (request, reply) => {
      const parsed = LoginRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid login" });
      }
      const { username, password } = parsed.data;
      const key = `${request.ip}:${username}`;
      if (limiter.isLocked(key)) {
        return reply.code(429).send({ error: "Too many attempts — try again shortly" });
      }

      const user = await verifyCredentials(config.usersFile, username, password);
      if (!user) {
        limiter.recordFailure(key);
        return reply.code(401).send({ error: "Invalid username or password" });
      }
      if (user.status === "pending") {
        return reply
          .code(403)
          .send({ error: "Account pending approval — waiting for an administrator" });
      }
      if (user.status === "disabled") {
        return reply.code(403).send({ error: "Account disabled — contact an administrator" });
      }
      // Second factor: accounts with 2FA on must present a valid TOTP code. A
      // missing code returns `totpRequired` so the login dialog can prompt for it.
      if (user.totpEnabled && user.totpSecretEnc) {
        if (!parsed.data.totp) {
          return reply.code(401).send({ error: "Authenticator code required", totpRequired: true });
        }
        const secret = decryptSecret(config.aiKeySecret, user.totpSecretEnc);
        if (!verifyTotp(secret, parsed.data.totp)) {
          limiter.recordFailure(key);
          return reply.code(401).send({ error: "Invalid authenticator code", totpRequired: true });
        }
      }

      limiter.reset(key);
      await ensureUserHome(config.userHomesRoot, username);
      await issueSession(reply, user);
      request.log.info({ username }, "user logged in");
      return reply.send(toMe(user));
    }
  );

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true });
  });

  app.get<{ Reply: AuthMeResponse | ErrorResponse }>(
    "/api/auth/me",
    { preHandler: (request, reply) => app.authenticate(request, reply) },
    async (request) => {
      return toMe(request.account!);
    }
  );

  // Self change-password: verify old, set new, bump tokenVersion (kills other
  // sessions), then re-issue this session's cookie with the new version.
  app.post<{ Body: unknown; Reply: { ok: true } | ErrorResponse }>(
    "/api/auth/change-password",
    { preHandler: (request, reply) => app.authenticate(request, reply) },
    async (request, reply) => {
      const parsed = ChangePasswordRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
      }
      try {
        const updated = await changePassword(
          config.usersFile,
          request.user.sub,
          parsed.data.oldPassword,
          parsed.data.newPassword
        );
        await issueSession(reply, updated);
        return reply.send({ ok: true });
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed" });
      }
    }
  );
}
