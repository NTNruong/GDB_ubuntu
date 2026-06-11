import { describe, expect, it } from "vitest";
import { remapKeys, remapPath, resolveStopped, type DebugFileMap } from "./serverPaths";

describe("remapPath", () => {
  it("remaps the exact renamed path", () => {
    expect(remapPath("old", "old", "new")).toBe("new");
    expect(remapPath("dir/old.c", "dir/old.c", "dir/new.c")).toBe("dir/new.c");
  });

  it("remaps descendants under a renamed folder, preserving the suffix", () => {
    expect(remapPath("old/child.c", "old", "new")).toBe("new/child.c");
    expect(remapPath("old/a/b.c", "old", "new")).toBe("new/a/b.c");
    expect(remapPath("proj/old/util.c", "proj/old", "proj/renamed")).toBe("proj/renamed/util.c");
  });

  it("leaves unrelated paths unchanged", () => {
    expect(remapPath("other.c", "old", "new")).toBe("other.c");
    expect(remapPath("oldish/x.c", "old", "new")).toBe("oldish/x.c"); // prefix but not a path segment
    expect(remapPath("older.c", "old", "new")).toBe("older.c");
  });
});

describe("remapKeys", () => {
  it("rebuilds a record with remapped keys, preserving values", () => {
    const record = { "old/a.c": 1, "old/b.c": 2, "keep.c": 3 };
    const next = remapKeys(record, (k) => remapPath(k, "old", "new"));
    expect(next).toEqual({ "new/a.c": 1, "new/b.c": 2, "keep.c": 3 });
  });

  it("handles the exact-path key", () => {
    const record = { old: { savedContent: "x" }, "other.c": { savedContent: "y" } };
    const next = remapKeys(record, (k) => remapPath(k, "old", "new"));
    expect(next).toEqual({ new: { savedContent: "x" }, "other.c": { savedContent: "y" } });
  });
});

describe("resolveStopped", () => {
  const map: DebugFileMap = new Map([
    ["util.c", { serverPath: "proj/util.c", content: "int u;" }],
    ["main.c", { serverPath: "proj/main.c", content: "int main(){}" }]
  ]);

  it("maps a stopped basename to its server path when the tab is already open", () => {
    expect(resolveStopped("util.c", map, ["proj/main.c", "proj/util.c"])).toEqual({ path: "proj/util.c" });
  });

  it("returns content to open a stopped file whose tab is not open (step-into)", () => {
    expect(resolveStopped("util.c", map, ["proj/main.c"])).toEqual({ path: "proj/util.c", content: "int u;" });
  });

  it("falls back to a bare basename that is open (anonymous multi-file)", () => {
    expect(resolveStopped("helper.c", new Map(), ["main.c", "helper.c"])).toEqual({ path: "helper.c" });
  });

  it("returns undefined when nothing matches or base is missing", () => {
    expect(resolveStopped("ghost.c", map, ["proj/main.c"])).toBeUndefined();
    expect(resolveStopped(undefined, map, ["proj/main.c"])).toBeUndefined();
  });
});
