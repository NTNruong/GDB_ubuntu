export type RunMetricView = {
  elapsedMs: number;
  memoryBytes: number;
};

export function formatRunMetric(metric: RunMetricView): string {
  return `Runtime: ${formatRuntime(metric.elapsedMs)}, Memory: ${formatMemory(metric.memoryBytes)}`;
}

export function formatRuntime(elapsedMs: number): string {
  if (elapsedMs < 1000) {
    return `${Math.max(0, Math.round(elapsedMs))} ms`;
  }

  return `${(elapsedMs / 1000).toFixed(2)} s`;
}

export function formatMemory(memoryBytes: number): string {
  return `${(Math.max(0, memoryBytes) / 1024 / 1024).toFixed(1)} MB`;
}
