import { describe, expect, it } from "vitest";
import { formatMemory, formatRunMetric, formatRuntime } from "./runMetrics";

describe("run metric formatting", () => {
  it("formats runtimes below one second as milliseconds", () => {
    expect(formatRuntime(12.4)).toBe("12 ms");
    expect(formatRuntime(999)).toBe("999 ms");
  });

  it("formats runtimes from one second as seconds", () => {
    expect(formatRuntime(1234)).toBe("1.23 s");
  });

  it("formats memory in MB", () => {
    expect(formatMemory(3.4 * 1024 * 1024)).toBe("3.4 MB");
  });

  it("formats the full output line", () => {
    expect(formatRunMetric({ elapsedMs: 12, memoryBytes: 3.4 * 1024 * 1024 })).toBe(
      "Runtime: 12 ms, Memory: 3.4 MB"
    );
  });
});
