export type RunMetric = {
  phase: "run";
  elapsedMs: number;
  memoryBytes: number;
};

const METRIC_PREFIX = "__RUNNER_METRIC__:";
const RUN_METRIC_PATTERN = /^__RUNNER_METRIC__:run:elapsed_seconds=([0-9]+(?:\.[0-9]+)?):max_rss_kb=(\d+)$/;

export function findMetricMarker(line: string): number {
  return line.indexOf(METRIC_PREFIX);
}

export function parseRunMetricMarker(text: string): RunMetric | null {
  const match = RUN_METRIC_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }

  const elapsedSeconds = Number.parseFloat(match[1]!);
  const maxRssKb = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(elapsedSeconds) || !Number.isFinite(maxRssKb)) {
    return null;
  }

  return {
    phase: "run",
    elapsedMs: Math.max(0, Math.round(elapsedSeconds * 1000)),
    memoryBytes: Math.max(0, maxRssKb * 1024)
  };
}
