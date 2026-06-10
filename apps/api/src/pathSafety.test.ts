import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PathError,
  assertNotSymlink,
  countEntries,
  resolveUserPath,
  walkTree
} from "./pathSafety.js";

describe("pathSafety", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "gdb-pathsafety-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("resolveUserPath", () => {
    it("resolves a simple relative path under the root", () => {
      const resolved = resolveUserPath(root, "main.c");
      expect(resolved).toBe(path.join(root, "main.c"));
    });

    it("resolves a nested path", () => {
      const resolved = resolveUserPath(root, "algos/sort/quick.c");
      expect(resolved).toBe(path.join(root, "algos", "sort", "quick.c"));
    });

    it.each([
      ["..", ".."],
      ["parent escape", "../escape.c"],
      ["nested escape", "a/../../escape.c"],
      ["absolute", "/etc/passwd"],
      ["backslash", "a\\b.c"],
      ["leading dot", ".gdbinit"],
      ["nested leading dot", "a/.secret"],
      ["empty", ""],
      ["too deep", "a/b/c/d/e/f/g/h/i.c"]
    ])("rejects %s", (_label, bad) => {
      expect(() => resolveUserPath(root, bad)).toThrow(PathError);
    });

    it("rejects a 65-char segment", () => {
      expect(() => resolveUserPath(root, `${"a".repeat(65)}.c`)).toThrow(PathError);
    });
  });

  describe("assertNotSymlink", () => {
    it("passes for a missing path (create target)", async () => {
      await expect(assertNotSymlink(path.join(root, "new.c"))).resolves.toBeUndefined();
    });

    it("passes for a regular file", async () => {
      const file = path.join(root, "real.c");
      await writeFile(file, "int main(){}");
      await expect(assertNotSymlink(file)).resolves.toBeUndefined();
    });

    it("rejects a symlink", async ({ skip }) => {
      const target = path.join(root, "target.c");
      const link = path.join(root, "link.c");
      await writeFile(target, "x");
      try {
        await symlink(target, link);
      } catch {
        // Windows without the symlink privilege — nothing to assert here.
        skip();
        return;
      }
      await expect(assertNotSymlink(link)).rejects.toThrow(PathError);
    });
  });

  describe("walkTree", () => {
    it("returns folders before files, alphabetically, with sizes", async () => {
      await writeFile(path.join(root, "b.c"), "bb");
      await writeFile(path.join(root, "a.c"), "a");
      await mkdir(path.join(root, "sub"));
      await writeFile(path.join(root, "sub", "inner.c"), "inner");

      const tree = await walkTree(root);
      expect(tree.map((n) => n.name)).toEqual(["sub", "a.c", "b.c"]);
      expect(tree[0]?.type).toBe("dir");
      expect(tree[0]?.children?.[0]?.name).toBe("inner.c");
      const aNode = tree.find((n) => n.name === "a.c");
      expect(aNode?.size).toBe(1);
    });

    it("skips symlinks during the walk", async ({ skip }) => {
      await writeFile(path.join(root, "real.c"), "x");
      try {
        await symlink(path.join(root, "real.c"), path.join(root, "link.c"));
      } catch {
        skip();
        return;
      }
      const tree = await walkTree(root);
      expect(tree.map((n) => n.name)).toEqual(["real.c"]);
    });
  });

  describe("countEntries", () => {
    it("counts files and directories recursively", async () => {
      await writeFile(path.join(root, "a.c"), "a");
      await mkdir(path.join(root, "sub"));
      await writeFile(path.join(root, "sub", "b.c"), "b");
      expect(await countEntries(root)).toBe(3);
    });
  });
});
