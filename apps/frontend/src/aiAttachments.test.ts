import { describe, expect, it } from "vitest";
import type { TreeNode } from "@internal/shared";
import { flattenFiles } from "./aiAttachments.js";

describe("flattenFiles", () => {
  it("returns files only, depth-first, dropping directories", () => {
    const tree: TreeNode[] = [
      { name: "main.py", path: "main.py", type: "file" },
      {
        name: "pkg",
        path: "pkg",
        type: "dir",
        children: [
          { name: "util.py", path: "pkg/util.py", type: "file" },
          {
            name: "sub",
            path: "pkg/sub",
            type: "dir",
            children: [{ name: "tool.py", path: "pkg/sub/tool.py", type: "file" }]
          }
        ]
      }
    ];
    expect(flattenFiles(tree).map((n) => n.path)).toEqual(["main.py", "pkg/util.py", "pkg/sub/tool.py"]);
  });

  it("handles empty trees and empty directories", () => {
    expect(flattenFiles([])).toEqual([]);
    expect(flattenFiles([{ name: "empty", path: "empty", type: "dir", children: [] }])).toEqual([]);
  });
});
