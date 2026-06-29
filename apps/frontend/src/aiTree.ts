import type { AiThreadNode } from "@internal/shared";

/** Index nodes by id. */
export function nodeMap(nodes: AiThreadNode[]): Map<string, AiThreadNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/** Root→leaf chain for the active branch (what the transcript renders). */
export function activePath(nodes: AiThreadNode[], leafId: string | null): AiThreadNode[] {
  const byId = nodeMap(nodes);
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

/** Sibling variants (same parent) in chronological order. */
export function siblings(nodes: AiThreadNode[], node: AiThreadNode): AiThreadNode[] {
  return nodes.filter((other) => other.parentId === node.parentId).sort((a, b) => a.at - b.at);
}

/**
 * Map of nodeId → model id for each assistant node whose model differs from the
 * previous assistant node on the path. Drives the "switched model" dividers
 * (ISSUE-081); the first model on the path never gets a divider.
 */
export function modelSwitchPoints(path: AiThreadNode[]): Map<string, string> {
  const map = new Map<string, string>();
  let last: string | undefined;
  for (const node of path) {
    if (node.role === "assistant" && node.model) {
      if (last !== undefined && node.model !== last) {
        map.set(node.id, node.model);
      }
      last = node.model;
    }
  }
  return map;
}

/** Deepest leaf under `nodeId`, always following the most recent child. */
export function descendToLeaf(nodes: AiThreadNode[], nodeId: string): string {
  let current = nodeId;
  for (;;) {
    const kids = nodes.filter((node) => node.parentId === current).sort((a, b) => a.at - b.at);
    const last = kids[kids.length - 1];
    if (!last) {
      return current;
    }
    current = last.id;
  }
}
