// CPU-time instrumentation preloaded via `node --require`. The baseline is taken
// after Node has finished booting (the preload runs before the user's main
// module), so the delta on exit is the CPU consumed by the user code, excluding
// Node startup. process.cpuUsage() returns microseconds {user, system}.
const fs = require("fs");

const baseline = process.cpuUsage();

process.on("exit", () => {
  try {
    const delta = process.cpuUsage(baseline);
    const seconds = (delta.user + delta.system) / 1e6;
    fs.writeFileSync("/workspace/tmp/run-cpu.txt", seconds.toFixed(6));
  } catch {
    // Best-effort: if we cannot write the metric, the runner falls back to %U+%S.
  }
});
