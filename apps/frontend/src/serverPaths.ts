// Path-state utilities for server-backed (explorer) tabs. Kept separate from
// runGather.ts (which owns the run-the-folder domain) because these helpers are
// about editor/tab path bookkeeping, not building run payloads.

/**
 * Remap a "/"-separated relative path when `oldPath` is renamed to `newPath`.
 * Handles both the renamed entry itself and any descendant under it (folder
 * rename), preserving the suffix. Unrelated paths are returned unchanged.
 */
export function remapPath(p: string, oldPath: string, newPath: string): string {
  if (p === oldPath) {
    return newPath;
  }
  if (p.startsWith(`${oldPath}/`)) {
    return newPath + p.slice(oldPath.length);
  }
  return p;
}

/**
 * Rebuild a path-keyed record with each key passed through `remap`. The mapping
 * is injective for a single rename (distinct paths stay distinct), so no key
 * collisions occur.
 */
export function remapKeys<T>(record: Record<string, T>, remap: (key: string) => string): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    next[remap(key)] = value;
  }
  return next;
}
