import type { TreeNode } from "@internal/shared";

/**
 * Flatten the Explorer tree to a depth-first list of files only (dirs dropped),
 * so the AI "Attach file" picker can show every workspace file as a flat list.
 */
export function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      out.push(node);
    } else if (node.children) {
      out.push(...flattenFiles(node.children));
    }
  }
  return out;
}
