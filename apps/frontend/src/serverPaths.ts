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

/**
 * Scratch (non-server) buffers worth offering to save into the user's home on
 * login: not already a server tab, non-empty, and not an untouched language
 * default template (EXPLORER-008). Pristine defaults stay as labeled scratch.
 */
export function savableScratch<T extends { path: string; content: string }>(
  files: readonly T[],
  serverTabs: Record<string, unknown>,
  defaultSources: ReadonlySet<string>
): T[] {
  return files.filter(
    (file) => !(file.path in serverTabs) && file.content.trim() !== "" && !defaultSources.has(file.content)
  );
}

/** Basename → original server path + content for the active folder's run/debug. */
export type DebugFileMap = Map<string, { serverPath: string; content: string }>;

/**
 * Resolve a debug "stopped" file (a flat workspace basename like "util.c") back to
 * the editor tab to activate. For a server folder run, the map carries every
 * gathered file's original path + content, so a stop in a secondary file — even one
 * whose tab was never opened (step-into) — resolves correctly; `content` is returned
 * only when the tab still needs opening. Falls back to a bare basename that is
 * already open (the anonymous multi-file case). `undefined` ⇒ keep the current tab.
 */
export function resolveStopped(
  base: string | undefined,
  fileMap: DebugFileMap,
  openPaths: readonly string[]
): { path: string; content?: string } | undefined {
  if (!base) {
    return undefined;
  }
  const mapped = fileMap.get(base);
  if (mapped) {
    return openPaths.includes(mapped.serverPath)
      ? { path: mapped.serverPath }
      : { path: mapped.serverPath, content: mapped.content };
  }
  if (openPaths.includes(base)) {
    return { path: base };
  }
  return undefined;
}
