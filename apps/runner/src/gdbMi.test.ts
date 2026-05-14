import { describe, expect, it } from "vitest";
import { parseStack, parseStopped, parseVariables } from "./gdbMi.js";

describe("gdb mi parsing", () => {
  it("parses stopped locations", () => {
    expect(parseStopped('*stopped,reason="breakpoint-hit",frame={func="main",fullname="/workspace/main.cpp",line="7"}')).toEqual({
      reason: "breakpoint-hit",
      file: "/workspace/main.cpp",
      line: 7,
      func: "main"
    });
  });

  it("parses stack frames", () => {
    const frames = parseStack('2^done,stack=[frame={level="0",func="main",fullname="/workspace/main.cpp",line="8"}]');
    expect(frames).toEqual([{ level: 0, func: "main", file: "/workspace/main.cpp", line: 8 }]);
  });

  it("parses variables", () => {
    const variables = parseVariables('3^done,variables=[{name="x",value="42"},{name="name",value="\\"Ada\\""}]');
    expect(variables).toEqual([
      { name: "x", value: "42" },
      { name: "name", value: "\"Ada\"" }
    ]);
  });
});
