import { describe, expect, it } from "vitest";
import {
  boundSummary,
  frameMatchesBreakpoint,
  launchArgumentsFor,
  normalizeChildNames,
  parseInfoLocals,
  shouldSuppressDebuggerStderr,
  summarizeChildren
} from "./dapDebugSession.js";

describe("parseInfoLocals", () => {
  it("parses simple name = value pairs", () => {
    const result = parseInfoLocals("n = 6\nresult = 36\n");
    expect(result).toEqual([
      { name: "n", value: "6" },
      { name: "result", value: "36" }
    ]);
  });

  it("returns empty list for 'No locals.'", () => {
    expect(parseInfoLocals("No locals.\n")).toEqual([]);
  });

  it("returns empty list for 'No arguments.'", () => {
    expect(parseInfoLocals("No arguments.\n")).toEqual([]);
  });

  it("returns empty list for empty input", () => {
    expect(parseInfoLocals("")).toEqual([]);
  });

  it("handles multi-line values (struct/aggregate)", () => {
    const result = parseInfoLocals("p = {\n  x = 1,\n  y = 2\n}\nq = 7\n");
    expect(result).toEqual([
      { name: "p", value: "{\nx = 1,\ny = 2\n}" },
      { name: "q", value: "7" }
    ]);
  });

  it("handles pointer values with addresses", () => {
    const result = parseInfoLocals('s = 0x7fff1234 "hello"\nn = 42\n');
    expect(result).toEqual([
      { name: "s", value: '0x7fff1234 "hello"' },
      { name: "n", value: "42" }
    ]);
  });

  it("ignores blank lines and trailing whitespace", () => {
    const result = parseInfoLocals("\n  n = 6   \n\nresult = 36\n\n");
    expect(result).toEqual([
      { name: "n", value: "6" },
      { name: "result", value: "36" }
    ]);
  });
});

describe("summarizeChildren", () => {
  it("renders array children as a brace-wrapped value list", () => {
    const result = summarizeChildren(
      [
        { name: "[0]", value: "1" },
        { name: "[1]", value: "3" },
        { name: "[2]", value: "5" }
      ],
      false
    );
    expect(result).toBe("{1, 3, 5}");
  });

  it("renders struct children as name = value pairs", () => {
    const result = summarizeChildren(
      [
        { name: "x", value: "1" },
        { name: "y", value: "2" }
      ],
      false
    );
    expect(result).toBe("{x = 1, y = 2}");
  });

  it("appends an ellipsis item when more children exist", () => {
    const result = summarizeChildren([{ name: "[0]", value: "1" }], true);
    expect(result).toBe("{1, …}");
  });

  it("returns empty braces for no children", () => {
    expect(summarizeChildren([], false)).toBe("{}");
  });
});

describe("normalizeChildNames", () => {
  it("rewrites all-numeric child names to bracketed array indices", () => {
    const result = normalizeChildNames([
      { name: "0", value: "1" },
      { name: "1", value: "3" },
      { name: "2", value: "5" }
    ]);
    expect(result.map((c) => c.name)).toEqual(["[0]", "[1]", "[2]"]);
  });

  it("leaves named (struct) children untouched", () => {
    const children = [
      { name: "x", value: "1" },
      { name: "y", value: "2" }
    ];
    expect(normalizeChildNames(children)).toEqual(children);
  });

  it("leaves mixed children untouched", () => {
    const children = [
      { name: "0", value: "1" },
      { name: "len", value: "5" }
    ];
    expect(normalizeChildNames(children)).toEqual(children);
  });

  it("returns empty input unchanged", () => {
    expect(normalizeChildNames([])).toEqual([]);
  });
});

describe("frameMatchesBreakpoint", () => {
  const breakpoints = [
    { path: "main.c", line: 6 },
    { path: "util.c", line: 3 }
  ];

  it("matches an absolute /workspace path by basename + line", () => {
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/main.c" }, line: 6 }, breakpoints)).toBe(true);
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/util.c" }, line: 3 }, breakpoints)).toBe(true);
  });

  it("does not match the entry stop (different line / file)", () => {
    // main()'s opening line, not a user breakpoint → treated as the entry stop.
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/main.c" }, line: 3 }, breakpoints)).toBe(false);
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/other.c" }, line: 6 }, breakpoints)).toBe(false);
  });

  it("falls back to source.name when path is absent", () => {
    expect(frameMatchesBreakpoint({ source: { name: "util.c" }, line: 3 }, breakpoints)).toBe(true);
  });

  it("matches a nested Python file by its full workspace-relative path", () => {
    const nested = [{ path: "pkg/util.py", line: 4 }];
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/pkg/util.py" }, line: 4 }, nested)).toBe(true);
    // A bare basename must NOT match a nested breakpoint (no path collision).
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/util.py" }, line: 4 }, nested)).toBe(false);
  });

  it("returns false for missing frame or missing line", () => {
    expect(frameMatchesBreakpoint(undefined, breakpoints)).toBe(false);
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/main.c" } }, breakpoints)).toBe(false);
  });

  it("returns false when there are no breakpoints", () => {
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/main.c" }, line: 6 }, [])).toBe(false);
  });
});

describe("launchArgumentsFor", () => {
  it("uses gdb's documented stop-at-main parameter for C, not cppdbg's stopAtEntry", () => {
    const args = launchArgumentsFor({ language: "c", argv: [] });
    // gdb -i dap silently ignores unknown launch parameters, so the exact
    // documented name matters: stopAtBeginningOfMainSubprogram (GDB ≥ 14).
    expect(args.stopAtBeginningOfMainSubprogram).toBe(true);
    expect(args).not.toHaveProperty("stopAtEntry");
    expect(args.type).toBe("gdb");
    expect(args.program).toBe("/exec/program");
  });

  it("uses the same stop-at-main parameter for C++ and forwards argv", () => {
    const args = launchArgumentsFor({ language: "cpp", argv: ["a", "b"] });
    expect(args.stopAtBeginningOfMainSubprogram).toBe(true);
    expect(args).not.toHaveProperty("stopAtEntry");
    expect(args.args).toEqual(["a", "b"]);
  });

  it("debugs Rust through the same gdb launch shape as C/C++", () => {
    const args = launchArgumentsFor({ language: "rust", argv: ["x"] });
    expect(args.type).toBe("gdb");
    expect(args.program).toBe("/exec/program");
    expect(args.stopAtBeginningOfMainSubprogram).toBe(true);
    expect(args).not.toHaveProperty("stopAtEntry");
    expect(args.args).toEqual(["x"]);
  });

  it("debugs Go through Delve's exec launch with stopOnEntry", () => {
    const args = launchArgumentsFor({ language: "go", argv: ["x"] });
    expect(args.type).toBe("go");
    expect(args.mode).toBe("exec");
    expect(args.program).toBe("/exec/program");
    expect(args.stopOnEntry).toBe(true);
    expect(args).not.toHaveProperty("stopAtBeginningOfMainSubprogram");
    expect(args.args).toEqual(["x"]);
  });

  it("does not send any stop-on-entry flag to debugpy (Python)", () => {
    const args = launchArgumentsFor({ language: "python", argv: ["x"] });
    expect(args).not.toHaveProperty("stopAtBeginningOfMainSubprogram");
    expect(args).not.toHaveProperty("stopAtEntry");
    expect(args).not.toHaveProperty("stopOnEntry");
    expect(args.type).toBe("python");
    expect(args.args).toEqual(["/workspace/main.py", "x"]);
    // -u keeps debuggee stdout unbuffered so print() streams while stepping.
    expect(args.python).toContain("-u");
  });

  it("debugs an explicit Python entrypoint instead of main.py", () => {
    const args = launchArgumentsFor({ language: "python", argv: ["x"], entrypoint: "tool.py" });
    expect(args.args).toEqual(["/workspace/tool.py", "x"]);
  });

  it("debugs Java through java-debug with _DebugMain, sourcePaths and versioned javaExec", () => {
    const args = launchArgumentsFor({ language: "java", argv: ["x"], toolchainVersion: "17" });
    expect(args.type).toBe("java");
    expect(args.mainClass).toBe("_DebugMain");
    expect(args.classPaths).toEqual(["/workspace/classes", "/opt/runner"]);
    expect(args.sourcePaths).toEqual(["/workspace"]);
    // Debuggee runs under the requested JDK (jdt.ls itself runs under Java >=21).
    expect(args.javaExec).toBe("/opt/java/17/bin/java");
    expect(args.stopOnEntry).toBe(true);
    // java-debug wants `args` as a command-line STRING, not an array (ISSUE-059).
    expect(args.args).toBe("x");
  });

  it("joins Java debuggee argv into a quoted command-line string", () => {
    const args = launchArgumentsFor({ language: "java", argv: ["a b", "c"] });
    expect(args.args).toBe('"a b" c');
  });

  it("defaults Java debuggee to JDK 21 and omits args when none are requested", () => {
    const args = launchArgumentsFor({ language: "java", argv: [] });
    expect(args.javaExec).toBe("/opt/java/21/bin/java");
    // Empty argv → omit `args` entirely (java-debug rejects an array; empty string is moot).
    expect(args).not.toHaveProperty("args");
  });
});

describe("boundSummary", () => {
  it("returns short values unchanged", () => {
    expect(boundSummary("{1, 2, 3}")).toBe("{1, 2, 3}");
  });

  it("truncates over-long values to the char cap with an ellipsis", () => {
    const result = boundSummary("x".repeat(250));
    expect(result.length).toBe(200);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("shouldSuppressDebuggerStderr", () => {
  it("suppresses Java infra stderr once compilation is done (ISSUE-061)", () => {
    expect(shouldSuppressDebuggerStderr("java", true, false)).toBe(true);
  });

  it("keeps Java compile-phase stderr (javac errors) visible", () => {
    expect(shouldSuppressDebuggerStderr("java", false, false)).toBe(false);
  });

  it("shows the infra logs under DEBUG_VERBOSE", () => {
    expect(shouldSuppressDebuggerStderr("java", true, true)).toBe(false);
  });

  it("does not touch other languages' stderr", () => {
    expect(shouldSuppressDebuggerStderr("cpp", true, false)).toBe(false);
  });
});
