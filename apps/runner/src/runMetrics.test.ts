import { describe, expect, it } from "vitest";
import { findMetricMarker, parseRunMetricMarker } from "./runMetrics.js";

describe("run metric markers", () => {
  it("parses cpu seconds, max RSS and the user-code scope", () => {
    expect(parseRunMetricMarker("__RUNNER_METRIC__:run:cpu_seconds=0.123:max_rss_kb=4567:scope=user-code")).toEqual({
      phase: "run",
      cpuMs: 123,
      cpuScope: "user-code",
      memoryBytes: 4567 * 1024
    });
  });

  it("parses the whole-process scope", () => {
    expect(parseRunMetricMarker("__RUNNER_METRIC__:run:cpu_seconds=0.5:max_rss_kb=10:scope=process")).toEqual({
      phase: "run",
      cpuMs: 500,
      cpuScope: "process",
      memoryBytes: 10 * 1024
    });
  });

  it("rejects malformed markers", () => {
    expect(parseRunMetricMarker("__RUNNER_METRIC__:run:cpu_seconds=nope:max_rss_kb=4567:scope=process")).toBeNull();
    expect(parseRunMetricMarker("__RUNNER_METRIC__:run:cpu_seconds=0.1:max_rss_kb=1:scope=bogus")).toBeNull();
    expect(parseRunMetricMarker("__RUNNER_METRIC__:compile:cpu_seconds=0.1:max_rss_kb=1:scope=process")).toBeNull();
  });

  it("finds marker position in mixed stderr lines", () => {
    expect(findMetricMarker("stderr without marker")).toBe(-1);
    expect(findMetricMarker("partial stderr__RUNNER_METRIC__:run:cpu_seconds=0.01:max_rss_kb=12:scope=process")).toBe(14);
  });
});
