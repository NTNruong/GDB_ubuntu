import { describe, expect, it } from "vitest";
import { isCompilerDiagnosticContext, parseCompilerDiagnostics } from "./diagnostics";

describe("compiler diagnostics", () => {
  it("parses GCC warnings with file, line, and column", () => {
    expect(
      parseCompilerDiagnostics(
        "/workspace/main.c:3:14: warning: unused parameter 'argc' [-Wunused-parameter]\n"
      )
    ).toEqual([
      {
        severity: "warning",
        file: "/workspace/main.c",
        line: 3,
        column: 14,
        message: "unused parameter 'argc' [-Wunused-parameter]",
        raw: "/workspace/main.c:3:14: warning: unused parameter 'argc' [-Wunused-parameter]"
      }
    ]);
  });

  it("parses errors and fatal errors as errors", () => {
    expect(
      parseCompilerDiagnostics(
        [
          "/workspace/main.cpp:5:2: error: expected ';' before '}' token",
          "/workspace/main.cpp:1:10: fatal error: missing.h: No such file or directory"
        ].join("\n")
      )
    ).toMatchObject([
      { severity: "error", line: 5, column: 2, message: "expected ';' before '}' token" },
      { severity: "error", line: 1, column: 10, message: "missing.h: No such file or directory" }
    ]);
  });

  it("surfaces linker errors (missing / duplicate main) as Error List diagnostics", () => {
    const missingMain = parseCompilerDiagnostics(
      [
        "/usr/bin/ld: /usr/lib/x86_64-linux-gnu/Scrt1.o: in function `_start':",
        "(.text+0x1b): undefined reference to `main'",
        "collect2: error: ld returned 1 exit status"
      ].join("\n")
    );
    expect(missingMain).toEqual([
      { severity: "error", message: "undefined reference to `main'", raw: "(.text+0x1b): undefined reference to `main'" }
    ]);

    const duplicateMain = parseCompilerDiagnostics(
      "/usr/bin/ld: /tmp/ccB.o:(.text+0x0): multiple definition of `main'; /tmp/ccA.o:(.text+0x0): first defined here\n"
    );
    expect(duplicateMain).toHaveLength(1);
    expect(duplicateMain[0]).toMatchObject({ severity: "error", message: "multiple definition of `main'" });
  });

  it("does not treat a normal GCC warning as a linker error", () => {
    const parsed = parseCompilerDiagnostics(
      "/workspace/util.c:2:5: warning: unused variable 'x' [-Wunused-variable]\n"
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ severity: "warning", line: 2 });
  });

  it("identifies GCC context lines that should stay out of terminal output", () => {
    expect(
      isCompilerDiagnosticContext(
        [
          "/workspace/main.c: In function 'main':",
          "3 | int main(int argc, char** argv) {",
          "|              ^~~~",
          "compilation terminated."
        ].join("\n")
      )
    ).toBe(true);
  });
});
