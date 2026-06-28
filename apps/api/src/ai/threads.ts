import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AI_THREAD_ID_PATTERN,
  type AiAgentStep,
  type AiThread,
  type AiThreadNode,
  type AiThreadSummary
} from "@internal/shared";
import { PathError } from "../pathSafety.js";

/** Soft cap on nodes per thread; oldest off-branch leaves are pruned past this. */
const MAX_THREAD_NODES = 600;

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

export function generateNodeId(): string {
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

type LegacyThread = AiThread & { messages?: { role: string; content: string; at?: number }[] };

/**
 * Normalize a parsed thread to the node-tree shape. Legacy threads stored a
 * linear `messages[]`; convert those to a single chain (parent = previous) once,
 * on read, so older conversations keep working after the tree upgrade.
 */
export function migrateThread(parsed: LegacyThread): AiThread {
  if (Array.isArray(parsed.nodes)) {
    return {
      ...parsed,
      nodes: parsed.nodes,
      currentLeafId: parsed.currentLeafId ?? parsed.nodes[parsed.nodes.length - 1]?.id ?? null
    };
  }
  const nodes: AiThreadNode[] = [];
  let parentId: string | null = null;
  for (const message of parsed.messages ?? []) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    const node: AiThreadNode = {
      id: generateNodeId(),
      parentId,
      role: message.role,
      content: message.content,
      at: message.at ?? Date.now()
    };
    nodes.push(node);
    parentId = node.id;
  }
  return {
    id: parsed.id,
    title: parsed.title,
    model: parsed.model,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    nodes,
    currentLeafId: nodes[nodes.length - 1]?.id ?? null,
    interactionId: parsed.interactionId,
    environmentId: parsed.environmentId
  };
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
    return migrateThread(JSON.parse(await readFile(abs, "utf8")) as LegacyThread);
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
    nodes: [],
    currentLeafId: null
  };
  await writeThread(userDir, thread);
  return thread;
}

/** Root→leaf node chain for the active (or any) branch. */
export function pathToLeaf(thread: AiThread, leafId: string | null): AiThreadNode[] {
  const byId = new Map(thread.nodes.map((node) => [node.id, node]));
  const out: AiThreadNode[] = [];
  const seen = new Set<string>();
  let cursor = leafId ? byId.get(leafId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    out.push(cursor);
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return out.reverse();
}

export function childrenOf(thread: AiThread, parentId: string | null): AiThreadNode[] {
  return thread.nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.at - b.at);
}

/** Drop oldest off-branch leaves until under the cap, keeping the tree valid. */
function pruneNodes(thread: AiThread): void {
  while (thread.nodes.length > MAX_THREAD_NODES) {
    const onPath = new Set(pathToLeaf(thread, thread.currentLeafId).map((node) => node.id));
    const parents = new Set(thread.nodes.map((node) => node.parentId).filter((id): id is string => id !== null));
    const victim = thread.nodes
      .filter((node) => !parents.has(node.id) && !onPath.has(node.id))
      .sort((a, b) => a.at - b.at)[0];
    if (!victim) {
      break;
    }
    thread.nodes = thread.nodes.filter((node) => node.id !== victim.id);
  }
}

export type NewNode = {
  parentId: string | null;
  role: "user" | "assistant";
  content: string;
  steps?: AiAgentStep[];
  model?: string;
};

/** Append a node, make it the current leaf, and persist. Returns the new node. */
export async function addNode(userDir: string, id: string, input: NewNode): Promise<AiThreadNode> {
  const thread = await readThread(userDir, id);
  const node: AiThreadNode = {
    id: generateNodeId(),
    parentId: input.parentId,
    role: input.role,
    content: input.content,
    at: Date.now(),
    ...(input.steps && input.steps.length > 0 ? { steps: input.steps } : {}),
    ...(input.model ? { model: input.model } : {})
  };
  thread.nodes.push(node);
  thread.currentLeafId = node.id;
  thread.updatedAt = Date.now();
  pruneNodes(thread);
  await writeThread(userDir, thread);
  return node;
}

/** Delete a node and its whole subtree; repoint the current leaf if it was removed. */
export async function deleteSubtree(userDir: string, id: string, nodeId: string): Promise<void> {
  const thread = await readThread(userDir, id);
  const target = thread.nodes.find((node) => node.id === nodeId);
  if (!target) {
    throw new PathError("Node not found", 404);
  }
  const removed = new Set<string>([nodeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of thread.nodes) {
      if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) {
        removed.add(node.id);
        grew = true;
      }
    }
  }
  thread.nodes = thread.nodes.filter((node) => !removed.has(node.id));
  if (thread.currentLeafId && removed.has(thread.currentLeafId)) {
    // Fall back to the deleted node's parent (or the most recent remaining node).
    thread.currentLeafId =
      target.parentId ?? thread.nodes[thread.nodes.length - 1]?.id ?? null;
  }
  thread.updatedAt = Date.now();
  await writeThread(userDir, thread);
}

/** Switch the active branch to `leafId`. */
export async function setCurrentLeaf(userDir: string, id: string, leafId: string): Promise<void> {
  const thread = await readThread(userDir, id);
  if (!thread.nodes.some((node) => node.id === leafId)) {
    throw new PathError("Node not found", 404);
  }
  thread.currentLeafId = leafId;
  thread.updatedAt = Date.now();
  await writeThread(userDir, thread);
}

/** Persist Antigravity continuation ids on a thread (after an agent turn). */
export async function updateThreadMeta(
  userDir: string,
  id: string,
  meta: { interactionId?: string; environmentId?: string }
): Promise<void> {
  const thread = await readThread(userDir, id);
  if (meta.interactionId !== undefined) {
    thread.interactionId = meta.interactionId;
  }
  if (meta.environmentId !== undefined) {
    thread.environmentId = meta.environmentId;
  }
  thread.updatedAt = Date.now();
  await writeThread(userDir, thread);
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
