import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import {
  MAX_TREE_DEPTH,
  MAX_TREE_ENTRIES,
  parseUserPath,
  type TreeNode
} from "@internal/shared";

/**
 * Thrown for any unsafe / not-found path operation. `status` maps to the HTTP
 * code the file routes return so callers don't re-classify errors.
 */
export class PathError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400
  ) {
    super(message);
    this.name = "PathError";
  }
}

/**
 * Validate a relative user path and resolve it inside `userRoot`. Belt-and-
 * braces: the shape is re-checked here (not just at the zod boundary) and the
 * resolved absolute path must stay under `userRoot`, so `..`/absolute inputs
 * can never escape even if a caller forgets to validate.
 */
export function resolveUserPath(userRoot: string, relPath: string): string {
  if (parseUserPath(relPath) === null) {
    throw new PathError(`Invalid path: ${relPath}`);
  }
  const root = path.resolve(userRoot);
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new PathError(`Path escapes user root: ${relPath}`);
  }
  return resolved;
}

/**
 * Reject symlinks at `absPath`. Only the file API writes the user tree, so any
 * symlink is foreign (admin- or attacker-planted) and could point outside the
 * jail — refuse to follow it. Missing target is fine (create/overwrite cases).
 */
export async function assertNotSymlink(absPath: string): Promise<void> {
  let stat;
  try {
    stat = await lstat(absPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new PathError(`Refusing to follow symlink: ${absPath}`);
  }
}

/**
 * Resolve `relPath` inside `userRoot` and reject if any path component (the leaf
 * or an ancestor) is a symlink — closes the "symlinked intermediate directory"
 * escape that a purely lexical resolve would miss. Returns the absolute path.
 */
export async function assertSafePath(userRoot: string, relPath: string): Promise<string> {
  const abs = resolveUserPath(userRoot, relPath);
  const root = path.resolve(userRoot);
  let current = root;
  for (const segment of relPath.split("/")) {
    current = path.join(current, segment);
    await assertNotSymlink(current);
  }
  return abs;
}

/**
 * Walk the user's home tree into a nested TreeNode[] (dirs first, then alpha).
 * Symlinks and special files are skipped; depth and total-entry caps bound the
 * cost so the whole tree can be returned in one response.
 */
export async function walkTree(userRoot: string): Promise<TreeNode[]> {
  const counter = { count: 0 };
  return walkDir(userRoot, "", 1, counter);
}

async function walkDir(
  userRoot: string,
  relDir: string,
  depth: number,
  counter: { count: number }
): Promise<TreeNode[]> {
  const absDir = relDir === "" ? userRoot : path.join(userRoot, relDir);
  let dirents;
  try {
    dirents = await readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: TreeNode[] = [];
  // Stable, VSCode-like ordering: folders first, then files, each alphabetical.
  dirents.sort((a, b) => {
    const aDir = a.isDirectory();
    const bDir = b.isDirectory();
    if (aDir !== bDir) {
      return aDir ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  for (const dirent of dirents) {
    if (counter.count >= MAX_TREE_ENTRIES) {
      break;
    }
    // Skip anything that isn't a plain file or directory (symlinks, sockets…).
    if (dirent.isSymbolicLink() || (!dirent.isDirectory() && !dirent.isFile())) {
      continue;
    }
    const relPath = relDir === "" ? dirent.name : `${relDir}/${dirent.name}`;

    if (dirent.isDirectory()) {
      counter.count += 1;
      const children =
        depth < MAX_TREE_DEPTH ? await walkDir(userRoot, relPath, depth + 1, counter) : [];
      nodes.push({ name: dirent.name, path: relPath, type: "dir", children });
    } else {
      counter.count += 1;
      let size = 0;
      try {
        size = (await lstat(path.join(userRoot, relPath))).size;
      } catch {
        size = 0;
      }
      nodes.push({ name: dirent.name, path: relPath, type: "file", size });
    }
  }

  return nodes;
}

/** Count existing entries (files + dirs) anywhere under the user's home. */
export async function countEntries(userRoot: string): Promise<number> {
  const counter = { count: 0 };
  await walkDir(userRoot, "", 1, counter);
  return counter.count;
}
