import { describe, expect, it } from "vitest";
import { findMetricMarker, parseRunMetricMarker } from "./runMetrics.js";

describe("run metric markers", () => {
  it("parses elapsed seconds and max RSS", () => {
    expect(parseRunMetricMarker("__RUNNER_METRIC__:run:elapsed_seconds=0.123:max_rss_kb=4567")).toEqual({
      phase: "run",
      elapsedMs: 123,
      memoryBytes: 4567 * 1024
    });
  });

  it("rejects malformed markers", () => {
    expect(parseRunMetricMarker("__RUNNER_METRIC__:run:elapsed_seconds=nope:max_rss_kb=4567")).toBeNull();
    expect(parseRunMetricMarker("__RUNNER_METRIC__:compile:elapsed_seconds=0.1:max_rss_kb=1")).toBeNull();
  });

  it("finds marker position in mixed stderr lines", () => {
    expect(findMetricMarker("stderr without marker")).toBe(-1);
    expect(findMetricMarker("partial stderr__RUNNER_METRIC__:run:elapsed_seconds=0.01:max_rss_kb=12")).toBe(14);
  });
});
