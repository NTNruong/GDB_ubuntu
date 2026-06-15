export type RunMetric = {
  phase: "run";
  cpuMs: number;
  cpuScope: "user-code" | "process";
  memoryBytes: number;
};

const METRIC_PREFIX = "__RUNNER_METRIC__:";
const RUN_METRIC_PATTERN =
  /^__RUNNER_METRIC__:run:cpu_seconds=([0-9]+(?:\.[0-9]+)?):max_rss_kb=(\d+):scope=(user-code|process)$/;

export function findMetricMarker(line: string): number {
  return line.indexOf(METRIC_PREFIX);
}

export function parseRunMetricMarker(text: string): RunMetric | null {
  const match = RUN_METRIC_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }

  const cpuSeconds = Number.parseFloat(match[1]!);
  const maxRssKb = Number.parseInt(match[2]!, 10);
  // The regex pins group 3 to one of the two literals; narrow the type.
  const cpuScope = match[3] === "user-code" ? "user-code" : "process";
  if (!Number.isFinite(cpuSeconds) || !Number.isFinite(maxRssKb)) {
    return null;
  }

  return {
    phase: "run",
    cpuMs: Math.max(0, Math.round(cpuSeconds * 1000)),
    cpuScope,
    memoryBytes: Math.max(0, maxRssKb * 1024)
  };
}
