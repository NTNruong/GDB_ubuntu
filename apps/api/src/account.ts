import {
  TotpEnableRequestSchema,
  UpdateProfileRequestSchema,
  type AuthMeResponse,
  type TotpSetupResponse
} from "@internal/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { decryptSecret, encryptSecret } from "./ai/keystore.js";
import type { ApiConfig } from "./config.js";
import { generateSecret, otpauthUri, verifyTotp } from "./totp.js";
import {
  bumpTokenVersion,
  clearTotp,
  enableTotp,
  getUser,
  stageTotpSecret,
  updateProfile,
  type UserRecord
} from "./userStore.js";

type ErrorResponse = { error: string };
const TOTP_ISSUER = "GDB Runner";

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
 * Authenticated self-service account routes: profile (display name + email),
 * "log out everywhere", and TOTP 2FA enrollment. Every route is gated by
 * `authenticate`; the acting user is always `request.user.sub` (never a param),
 * so a user can only ever edit their own account.
 */
export function registerAccount(app: FastifyInstance, config: ApiConfig): void {
  const guard = {
    preHandler: (request: FastifyRequest, reply: FastifyReply) => app.authenticate(request, reply)
  };

  app.put<{ Body: unknown; Reply: AuthMeResponse | ErrorResponse }>(
    "/api/account/profile",
    guard,
    async (request, reply) => {
      const parsed = UpdateProfileRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid profile" });
      }
      const user = await updateProfile(config.usersFile, request.user.sub, parsed.data);
      return reply.send(toMe(user));
    }
  );

  // Bump tokenVersion → every issued cookie (including this one) stops verifying.
  app.post("/api/account/logout-all", guard, async (request, reply) => {
    await bumpTokenVersion(config.usersFile, request.user.sub);
    reply.clearCookie("gdb_session", { path: "/" });
    return reply.send({ ok: true });
  });

  // 2FA step 1: mint + stage a secret, return the otpauth URI to enroll.
  app.post<{ Reply: TotpSetupResponse | ErrorResponse }>(
    "/api/account/2fa/setup",
    guard,
    async (request, reply) => {
      const secret = generateSecret();
      await stageTotpSecret(
        config.usersFile,
        request.user.sub,
        encryptSecret(config.aiKeySecret, secret)
      );
      return reply.send({ secret, otpauthUri: otpauthUri(TOTP_ISSUER, request.user.sub, secret) });
    }
  );

  // 2FA step 2: verify a code against the staged secret, then enable.
  app.post<{ Body: unknown; Reply: AuthMeResponse | ErrorResponse }>(
    "/api/account/2fa/enable",
    guard,
    async (request, reply) => {
      const parsed = TotpEnableRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid code" });
      }
      const user = await getUser(config.usersFile, request.user.sub);
      if (!user?.totpSecretEnc) {
        return reply.code(400).send({ error: "No TOTP secret staged — run setup first" });
      }
      const secret = decryptSecret(config.aiKeySecret, user.totpSecretEnc);
      if (!verifyTotp(secret, parsed.data.totp)) {
        return reply.code(400).send({ error: "Code did not match — try again" });
      }
      const updated = await enableTotp(config.usersFile, request.user.sub);
      return reply.send(toMe(updated));
    }
  );

  app.post<{ Reply: AuthMeResponse | ErrorResponse }>(
    "/api/account/2fa/disable",
    guard,
    async (request, reply) => {
      // Admins must keep 2FA on (mandatory for the admin role).
      if (request.account?.role === "admin") {
        return reply.code(403).send({ error: "Admins must keep 2FA enabled" });
      }
      const updated = await clearTotp(config.usersFile, request.user.sub);
      return reply.send(toMe(updated));
    }
  );
}
