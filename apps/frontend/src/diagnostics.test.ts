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
