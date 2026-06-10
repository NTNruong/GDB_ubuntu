import { randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { LoginRequestSchema, type AuthMeResponse } from "@internal/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiConfig } from "./config.js";
import { createRateLimiter, ensureUserHome, verifyLogin } from "./userStore.js";

const COOKIE_NAME = "gdb_session";
const SESSION_TTL = "7d";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

type ErrorResponse = { error: string };

/**
 * Register cookie-based JWT auth + the /api/auth routes on the top-level app,
 * and decorate `app.authenticate` so route plugins (e.g. files.ts) can gate
 * themselves. Stateless: the signed cookie is the whole session (no store).
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

  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      await reply.code(401).send({ error: "Unauthorized" } satisfies ErrorResponse);
    }
  });

  const limiter = createRateLimiter();

  app.post<{ Body: unknown; Reply: AuthMeResponse | ErrorResponse }>(
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

      const ok = await verifyLogin(config.usersFile, username, password);
      if (!ok) {
        limiter.recordFailure(key);
        return reply.code(401).send({ error: "Invalid username or password" });
      }
      limiter.reset(key);
      await ensureUserHome(config.userHomesRoot, username);

      const token = await reply.jwtSign({ sub: username }, { expiresIn: SESSION_TTL });
      reply.setCookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: config.sessionCookieSecure,
        maxAge: SESSION_MAX_AGE
      });
      request.log.info({ username }, "user logged in");
      return reply.send({ username });
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
      return { username: request.user.sub };
    }
  );
}
