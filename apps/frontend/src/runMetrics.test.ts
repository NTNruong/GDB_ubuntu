import { describe, expect, it } from "vitest";
import { formatCpu, formatMemory, formatRunMetric } from "./runMetrics";

describe("run metric formatting", () => {
  it("formats CPU times below one second as milliseconds", () => {
    expect(formatCpu(12.4)).toBe("12 ms");
    expect(formatCpu(999)).toBe("999 ms");
  });

  it("formats CPU times from one second as seconds", () => {
    expect(formatCpu(1234)).toBe("1.23 s");
  });

  it("formats memory in MB", () => {
    expect(formatMemory(3.4 * 1024 * 1024)).toBe("3.4 MB");
  });

  it("formats the full output line with the user-code scope note", () => {
    expect(formatRunMetric({ cpuMs: 12, cpuScope: "user-code", memoryBytes: 3.4 * 1024 * 1024 })).toBe(
      "CPU time: 12 ms (code only), Memory: 3.4 MB"
    );
  });

  it("omits the scope note for whole-process CPU", () => {
    expect(formatRunMetric({ cpuMs: 12, cpuScope: "process", memoryBytes: 3.4 * 1024 * 1024 })).toBe(
      "CPU time: 12 ms, Memory: 3.4 MB"
    );
  });
});
