import { describe, expect, it } from "vitest";
import { PhaseFilter } from "./phaseFilter.js";

describe("PhaseFilter", () => {
  it("removes runner markers and emits phase events", () => {
    const data: string[] = [];
    const markers: string[] = [];
    const filter = new PhaseFilter(
      (chunk) => data.push(chunk),
      (marker) => markers.push(`${marker.phase}:${marker.status}`)
    );

    filter.write("__RUNNER_PHASE__:compile:start\nwarning\n__RUNNER_PHASE__:compile:done\n");
    filter.flush();

    expect(data).toEqual(["warning\n"]);
    expect(markers).toEqual(["compile:start", "compile:done"]);
  });

  it("emits run metric markers without forwarding them as stderr", () => {
    const data: string[] = [];
    const metrics: string[] = [];
    const filter = new PhaseFilter(
      (chunk) => data.push(chunk),
      () => undefined,
      (metric) => metrics.push(`${metric.elapsedMs}:${metric.memoryBytes}`)
    );

    filter.write("partial stderr__RUNNER_METRIC__:run:elapsed_seconds=0.123:max_rss_kb=4\n");

    expect(data).toEqual(["partial stderr"]);
    expect(metrics).toEqual([`123:${4 * 1024}`]);
  });
});
