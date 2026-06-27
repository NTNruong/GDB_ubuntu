import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AI_THREAD_ID_PATTERN,
  MAX_AI_THREAD_MESSAGES,
  type AiThread,
  type AiThreadMessage,
  type AiThreadSummary
} from "@internal/shared";
import { PathError } from "../pathSafety.js";

/**
 * Resolve `<userDir>/<id>.json`, re-checking the id shape and that the result
 * stays inside the user's thread dir. The id pattern already forbids "/", "."
 * and "..", so this is belt-and-braces against a future looser pattern.
 */
function threadFile(userDir: string, id: string): string {
  if (!AI_THREAD_ID_PATTERN.test(id)) {
    throw new PathError(`Invalid thread id: ${id}`);
  }
  const root = path.resolve(userDir);
  const abs = path.resolve(root, `${id}.json`);
  if (!abs.startsWith(root + path.sep)) {
    throw new PathError(`Thread id escapes root: ${id}`);
  }
  return abs;
}

export function generateThreadId(): string {
  return randomBytes(9).toString("base64url");
}

/** First ~60 chars of the opening message, used as the auto-title for new threads. */
export function titleFromMessage(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return "New chat";
  }
  return trimmed.length <= 60 ? trimmed : `${trimmed.slice(0, 57)}...`;
}

async function writeThread(userDir: string, thread: AiThread): Promise<void> {
  await mkdir(userDir, { recursive: true, mode: 0o700 });
  const abs = threadFile(userDir, thread.id);
  const tmp = `${abs}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(thread, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, abs);
}

export async function readThread(userDir: string, id: string): Promise<AiThread> {
  const abs = threadFile(userDir, id);
  try {
    return JSON.parse(await readFile(abs, "utf8")) as AiThread;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PathError("Thread not found", 404);
    }
    throw error;
  }
}

export async function listThreads(userDir: string): Promise<AiThreadSummary[]> {
  let names: string[];
  try {
    names = await readdir(userDir);
  } catch {
    return [];
  }
  const summaries: AiThreadSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const thread = JSON.parse(await readFile(path.join(userDir, name), "utf8")) as AiThread;
      summaries.push({
        id: thread.id,
        title: thread.title,
        model: thread.model,
        updatedAt: thread.updatedAt
      });
    } catch {
      // Skip unreadable/corrupt thread files rather than failing the whole list.
    }
  }
  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

export async function createThread(userDir: string, model: string, title: string): Promise<AiThread> {
  const now = Date.now();
  const thread: AiThread = {
    id: generateThreadId(),
    title,
    model,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  await writeThread(userDir, thread);
  return thread;
}

export async function appendMessages(
  userDir: string,
  id: string,
  messages: AiThreadMessage[]
): Promise<AiThread> {
  const thread = await readThread(userDir, id);
  thread.messages.push(...messages);
  if (thread.messages.length > MAX_AI_THREAD_MESSAGES) {
    thread.messages = thread.messages.slice(-MAX_AI_THREAD_MESSAGES);
  }
  thread.updatedAt = Date.now();
  await writeThread(userDir, thread);
  return thread;
}

export async function renameThread(userDir: string, id: string, title: string): Promise<void> {
  const thread = await readThread(userDir, id);
  thread.title = title;
  thread.updatedAt = Date.now();
  await writeThread(userDir, thread);
}

export async function deleteThread(userDir: string, id: string): Promise<void> {
  const abs = threadFile(userDir, id);
  try {
    await rm(abs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PathError("Thread not found", 404);
    }
    throw error;
  }
}
