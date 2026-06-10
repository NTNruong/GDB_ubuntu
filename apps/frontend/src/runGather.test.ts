import { describe, expect, it } from "vitest";
import { baseOf, dirOf, gatherFolderRun } from "./runGather";

describe("dirOf / baseOf", () => {
  it("splits top-level and nested paths", () => {
    expect(dirOf("main.c")).toBe("");
    expect(baseOf("main.c")).toBe("main.c");
    expect(dirOf("algos/sort.c")).toBe("algos");
    expect(baseOf("algos/sort.c")).toBe("sort.c");
  });
});

describe("gatherFolderRun", () => {
  it("gathers C sources, orders entry first, and remaps breakpoints", () => {
    const result = gatherFolderRun({
      language: "c",
      folderDir: "proj",
      folderFiles: [
        { name: "util.c", content: "// util" },
        { name: "main.c", content: "int main(){}" },
        { name: "util.h", content: "// header" }
      ],
      activeName: "util.c",
      allBreakpoints: [
        { path: "proj/main.c", line: 1 },
        { path: "other/x.c", line: 9 }
      ]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.path)).toEqual(["main.c", "util.c", "util.h"]);
    expect(result.breakpoints).toEqual([{ path: "main.c", line: 1 }]);
  });

  it("rejects a python folder without main.py", () => {
    const result = gatherFolderRun({
      language: "python",
      folderDir: "",
      folderFiles: [{ name: "helper.py", content: "x=1" }],
      activeName: "helper.py",
      allBreakpoints: []
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("main.py") });
  });

  it("accepts a python folder with main.py", () => {
    const result = gatherFolderRun({
      language: "python",
      folderDir: "",
      folderFiles: [
        { name: "main.py", content: "print(1)" },
        { name: "helper.py", content: "x=1" }
      ],
      activeName: "main.py",
      allBreakpoints: []
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a folder with no source for the language", () => {
    const result = gatherFolderRun({
      language: "c",
      folderDir: "",
      folderFiles: [{ name: "notes.py", content: "" }],
      activeName: "notes.py",
      allBreakpoints: []
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a C folder with only headers", () => {
    const result = gatherFolderRun({
      language: "c",
      folderDir: "",
      folderFiles: [{ name: "api.h", content: "// only header" }],
      activeName: "api.h",
      allBreakpoints: []
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("compilable") });
  });

  it("rejects more than MAX_FILES runnable files", () => {
    const folderFiles = Array.from({ length: 21 }, (_, i) => ({ name: `f${i}.c`, content: "" }));
    const result = gatherFolderRun({
      language: "c",
      folderDir: "",
      folderFiles,
      activeName: "f0.c",
      allBreakpoints: []
    });
    expect(result.ok).toBe(false);
  });
});
