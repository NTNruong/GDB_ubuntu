export type RunMetricView = {
  cpuMs: number;
  cpuScope: "user-code" | "process";
  memoryBytes: number;
};

export function formatRunMetric(metric: RunMetricView): string {
  // "code only" flags that interpreter/JVM startup was excluded (Java/Python/JS);
  // compiled languages report whole-process CPU (no warmup to exclude).
  const scopeNote = metric.cpuScope === "user-code" ? " (code only)" : "";
  return `CPU time: ${formatCpu(metric.cpuMs)}${scopeNote}, Memory: ${formatMemory(metric.memoryBytes)}`;
}

export function formatCpu(cpuMs: number): string {
  if (cpuMs < 1000) {
    return `${Math.max(0, Math.round(cpuMs))} ms`;
  }

  return `${(cpuMs / 1000).toFixed(2)} s`;
}

export function formatMemory(memoryBytes: number): string {
  return `${(Math.max(0, memoryBytes) / 1024 / 1024).toFixed(1)} MB`;
}
