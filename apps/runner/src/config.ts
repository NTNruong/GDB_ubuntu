export type RunnerConfig = {
  host: string;
  port: number;
  cppImage: string;
  pythonImage: string;
  maxConcurrentJobs: number;
  runTimeoutMs: number;
  debugMaxMs: number;
  debugIdleMs: number;
  memoryBytes: number;
  nanoCpus: number;
  dockerSocketPath: string;
};

export function readConfig(): RunnerConfig {
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number.parseInt(process.env.PORT ?? "4001", 10),
    cppImage: process.env.CPP_IMAGE ?? "internal-code-runner-cpp:0.1.0",
    pythonImage: process.env.PYTHON_IMAGE ?? "internal-code-runner-python:0.1.0",
    maxConcurrentJobs: Number.parseInt(process.env.MAX_CONCURRENT_JOBS ?? "6", 10),
    runTimeoutMs: Number.parseInt(process.env.RUN_TIMEOUT_MS ?? "30000", 10),
    debugMaxMs: Number.parseInt(process.env.DEBUG_MAX_MS ?? "900000", 10),
    debugIdleMs: Number.parseInt(process.env.DEBUG_IDLE_MS ?? "300000", 10),
    memoryBytes: Number.parseInt(process.env.MEMORY_BYTES ?? String(1024 * 1024 * 1024), 10),
    nanoCpus: Number.parseInt(process.env.NANO_CPUS ?? "1000000000", 10),
    dockerSocketPath: process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock"
  };
}
