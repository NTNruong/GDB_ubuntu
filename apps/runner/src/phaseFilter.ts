import { findMetricMarker, parseRunMetricMarker, type RunMetric } from "./runMetrics.js";

type PhaseMarker = {
  phase: "compile" | "run";
  status: "start" | "done";
};

const MARKER_PREFIX = "__RUNNER_PHASE__:";

export class PhaseFilter {
  private buffer = "";

  constructor(
    private readonly onData: (data: string) => void,
    private readonly onMarker: (marker: PhaseMarker) => void,
    private readonly onMetric?: (metric: RunMetric) => void
  ) {}

  write(data: string): void {
    this.buffer += data;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline + 1);
      this.buffer = this.buffer.slice(newline + 1);
      this.processLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  flush(): void {
    if (this.buffer.length > 0) {
      this.processLine(this.buffer);
      this.buffer = "";
    }
  }

  private processLine(line: string): void {
    if (this.onMetric) {
      const metricIndex = findMetricMarker(line);
      if (metricIndex >= 0) {
        const metric = parseRunMetricMarker(line.slice(metricIndex));
        if (metric) {
          const preceding = line.slice(0, metricIndex);
          if (preceding.length > 0) {
            this.onData(preceding);
          }
          this.onMetric(metric);
          return;
        }
      }
    }

    const trimmed = line.trim();
    if (trimmed.startsWith(MARKER_PREFIX)) {
      const [, phase, status] = trimmed.split(":");
      if ((phase === "compile" || phase === "run") && (status === "start" || status === "done")) {
        this.onMarker({ phase, status });
        return;
      }
    }

    this.onData(line);
  }
}
