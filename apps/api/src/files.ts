import { readFile, readdir, rename, rm, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MAX_TREE_ENTRIES,
  MkdirRequestSchema,
  RenameRequestSchema,
  UserPathSchema,
  WriteFileRequestSchema,
  type FileResponse,
  type FolderFilesResponse,
  type TreeResponse
} from "@internal/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiConfig } from "./config.js";
import { PathError, assertSafePath, countEntries, walkTree } from "./pathSafety.js";
import { ensureUserHome } from "./userStore.js";

type ErrorResponse = { error: string };

/** Resolve the authenticated user's home root, creating it if missing. */
async function userRootFor(request: FastifyRequest, config: ApiConfig): Promise<string> {
  return ensureUserHome(config.userHomesRoot, request.user.sub);
}

/** Map PathError / fs errno to an HTTP reply. */
function fail(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof PathError) {
    return reply.code(error.status).send({ error: error.message } satisfies ErrorResponse);
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    return reply.code(404).send({ error: "Not found" });
  }
  if (code === "EEXIST") {
    return reply.code(409).send({ error: "Already exists" });
  }
  if (code === "ENOTDIR") {
    return reply.code(400).send({ error: "Parent is not a folder" });
  }
  if (code === "EISDIR") {
    return reply.code(400).send({ error: "Path is a folder" });
  }
  throw error;
}

function readPathQuery(request: FastifyRequest): string {
  const raw = (request.query as { path?: unknown }).path;
  const parsed = UserPathSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PathError(parsed.error.issues[0]?.message ?? "Invalid path");
  }
  return parsed.data;
}

/**
 * Per-user file explorer API. Every route is auth-gated; paths are confined to
 * the user's home (resolve + prefix assert + symlink rejection in pathSafety).
 */
export function registerFiles(app: FastifyInstance, config: ApiConfig): void {
  const guard = { preHandler: (request: FastifyRequest, reply: FastifyReply) => app.authenticate(request, reply) };

  app.get<{ Reply: TreeResponse | ErrorResponse }>("/api/files/tree", guard, async (request, reply) => {
    const root = await userRootFor(request, config);
    const entries = await walkTree(root);
    return reply.send({ username: request.user.sub, entries });
  });

  app.get<{ Querystring: { path?: string }; Reply: FileResponse | ErrorResponse }>(
    "/api/files/content",
    guard,
    async (request, reply) => {
      try {
        const root = await userRootFor(request, config);
        const rel = readPathQuery(request);
        const abs = await assertSafePath(root, rel);
        const info = await stat(abs);
        if (!info.isFile()) {
          return reply.code(400).send({ error: "Not a file" });
        }
        const content = await readFile(abs, "utf8");
        return reply.send({ path: rel, content, size: info.size, mtimeMs: info.mtimeMs });
      } catch (error) {
        return fail(reply, error);
      }
    }
  );

  app.get<{ Querystring: { path?: string }; Reply: FolderFilesResponse | ErrorResponse }>(
    "/api/files/folder",
    guard,
    async (request, reply) => {
      try {
        const root = await userRootFor(request, config);
        const rel = readPathQuery(request);
        const abs = await assertSafePath(root, rel);
        const dirents = await readdir(abs, { withFileTypes: true });
        const files: FolderFilesResponse["files"] = [];
        for (const dirent of dirents) {
          if (dirent.isSymbolicLink() || !dirent.isFile()) {
            continue;
          }
          const filePath = path.join(abs, dirent.name);
          const content = await readFile(filePath, "utf8");
          files.push({ name: dirent.name, content, size: Buffer.byteLength(content) });
        }
        return reply.send({ path: rel, files });
      } catch (error) {
        return fail(reply, error);
      }
    }
  );

  app.put<{ Body: unknown; Reply: FileResponse | ErrorResponse }>(
    "/api/files/content",
    guard,
    async (request, reply) => {
      try {
        const parsed = WriteFileRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
        }
        const root = await userRootFor(request, config);
        const abs = await assertSafePath(root, parsed.data.path);
        const isNew = !(await exists(abs));
        if (isNew && (await countEntries(root)) >= MAX_TREE_ENTRIES) {
          return reply.code(400).send({ error: `Storage limit reached (${MAX_TREE_ENTRIES} entries)` });
        }
        await writeFile(abs, parsed.data.content, { mode: 0o600 });
        const info = await stat(abs);
        return reply.send({
          path: parsed.data.path,
          content: parsed.data.content,
          size: info.size,
          mtimeMs: info.mtimeMs
        });
      } catch (error) {
        return fail(reply, error);
      }
    }
  );

  app.post<{ Body: unknown; Reply: { ok: true } | ErrorResponse }>(
    "/api/files/mkdir",
    guard,
    async (request, reply) => {
      try {
        const parsed = MkdirRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
        }
        const root = await userRootFor(request, config);
        const abs = await assertSafePath(root, parsed.data.path);
        if (await exists(abs)) {
          return reply.code(409).send({ error: "Already exists" });
        }
        if ((await countEntries(root)) >= MAX_TREE_ENTRIES) {
          return reply.code(400).send({ error: `Storage limit reached (${MAX_TREE_ENTRIES} entries)` });
        }
        await mkdir(abs, { mode: 0o700 });
        return reply.send({ ok: true });
      } catch (error) {
        return fail(reply, error);
      }
    }
  );

  app.post<{ Body: unknown; Reply: { ok: true; path: string } | ErrorResponse }>(
    "/api/files/rename",
    guard,
    async (request, reply) => {
      try {
        const parsed = RenameRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
        }
        const root = await userRootFor(request, config);
        const fromAbs = await assertSafePath(root, parsed.data.path);
        const dir = path.dirname(parsed.data.path);
        const newRel = dir === "." ? parsed.data.newName : `${dir}/${parsed.data.newName}`;
        const toAbs = await assertSafePath(root, newRel);
        if (await exists(toAbs)) {
          return reply.code(409).send({ error: "Target name already exists" });
        }
        await rename(fromAbs, toAbs);
        return reply.send({ ok: true, path: newRel });
      } catch (error) {
        return fail(reply, error);
      }
    }
  );

  app.delete<{ Querystring: { path?: string }; Reply: { ok: true } | ErrorResponse }>(
    "/api/files/entry",
    guard,
    async (request, reply) => {
      try {
        const root = await userRootFor(request, config);
        const rel = readPathQuery(request);
        const abs = await assertSafePath(root, rel);
        if (!(await exists(abs))) {
          return reply.code(404).send({ error: "Not found" });
        }
        await rm(abs, { recursive: true, force: false });
        return reply.send({ ok: true });
      } catch (error) {
        return fail(reply, error);
      }
    }
  );
}

async function exists(abs: string): Promise<boolean> {
  try {
    await stat(abs);
    return true;
  } catch {
    return false;
  }
}
