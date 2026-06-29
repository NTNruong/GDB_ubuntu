import {
  AdminResetPasswordRequestSchema,
  AdminSetRoleRequestSchema,
  AdminSetStatusRequestSchema,
  UsernameSchema,
  type AdminUsersResponse,
  type AdminUserView
} from "@internal/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiConfig } from "./config.js";
import {
  adminResetPassword,
  approveUser,
  listUsers,
  rejectUser,
  removeUser,
  setRole,
  setStatus,
  type UserRecord
} from "./userStore.js";

type ErrorResponse = { error: string };

/** Strip secrets (hash, TOTP) before sending a record to the admin UI. */
function toView(user: UserRecord): AdminUserView {
  return {
    username: user.username,
    role: user.role,
    status: user.status,
    displayName: user.displayName,
    email: user.email,
    twoFactorEnabled: user.totpEnabled === true,
    createdAt: user.createdAt,
    approvedAt: user.approvedAt
  };
}

/** Validate the `:username` route param against the shared username shape. */
function readUsernameParam(request: FastifyRequest): string {
  const raw = (request.params as { username?: unknown }).username;
  const parsed = UsernameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid username");
  }
  return parsed.data;
}

function fail(reply: FastifyReply, error: unknown, code = 400): FastifyReply {
  return reply.code(code).send({ error: error instanceof Error ? error.message : "Failed" });
}

/**
 * Admin-only account management. Every route is gated by `requireAdmin` (auth +
 * role === "admin"). This is the in-app counterpart to the `users` CLI; the CLI
 * stays available for headless ops and bootstrapping the first admin.
 */
export function registerAdmin(app: FastifyInstance, config: ApiConfig): void {
  const guard = {
    preHandler: (request: FastifyRequest, reply: FastifyReply) => app.requireAdmin(request, reply)
  };

  app.get<{ Reply: AdminUsersResponse | ErrorResponse }>(
    "/api/admin/users",
    guard,
    async () => {
      const users = await listUsers(config.usersFile);
      return { users: users.map(toView) };
    }
  );

  app.post("/api/admin/users/:username/approve", guard, async (request, reply) => {
    try {
      const user = await approveUser(config.usersFile, readUsernameParam(request));
      return reply.send(toView(user));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/api/admin/users/:username/reject", guard, async (request, reply) => {
    try {
      await rejectUser(config.usersFile, readUsernameParam(request));
      return reply.send({ ok: true });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/api/admin/users/:username/role", guard, async (request, reply) => {
    const parsed = AdminSetRoleRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid role" });
    }
    const username = readUsernameParam(request);
    // Guard against an admin demoting the last admin and locking everyone out.
    if (parsed.data.role === "user" && username === request.user.sub) {
      return reply.code(400).send({ error: "You cannot demote your own admin account" });
    }
    try {
      const user = await setRole(config.usersFile, username, parsed.data.role);
      return reply.send(toView(user));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/api/admin/users/:username/status", guard, async (request, reply) => {
    const parsed = AdminSetStatusRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid status" });
    }
    const username = readUsernameParam(request);
    if (parsed.data.status === "disabled" && username === request.user.sub) {
      return reply.code(400).send({ error: "You cannot disable your own account" });
    }
    try {
      const user = await setStatus(config.usersFile, username, parsed.data.status);
      return reply.send(toView(user));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/api/admin/users/:username/reset-password", guard, async (request, reply) => {
    const parsed = AdminResetPasswordRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid password" });
    }
    try {
      await adminResetPassword(config.usersFile, readUsernameParam(request), parsed.data.newPassword);
      return reply.send({ ok: true });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete("/api/admin/users/:username", guard, async (request, reply) => {
    const username = readUsernameParam(request);
    if (username === request.user.sub) {
      return reply.code(400).send({ error: "You cannot delete your own account" });
    }
    try {
      await removeUser(config.usersFile, username);
      return reply.send({ ok: true });
    } catch (error) {
      return fail(reply, error);
    }
  });
}
