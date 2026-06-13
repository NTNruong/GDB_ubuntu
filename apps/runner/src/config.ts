import { tmpdir } from "node:os";

export type RunnerConfig = {
  host: string;
  port: number;
  cppImage: string;
  pythonImage: string;
  javascriptImage: string;
  javaImage: string;
  goImage: string;
  rustImage: string;
  maxConcurrentJobs: number;
  runTimeoutMs: number;
  debugMaxMs: number;
  debugIdleMs: number;
  memoryBytes: number;
  nanoCpus: number;
  dockerSocketPath: string;
  workspaceContainerRoot: string;
  workspaceHostRoot: string;
  debugEngine: "dap" | "mi";
};

/**
 * Resolve the Docker socket path. Explicit `DOCKER_SOCKET_PATH` wins; otherwise a
 * `unix://` `DOCKER_HOST` (which rootless Docker sets, e.g.
 * `unix:///run/user/1001/docker.sock`) is honored so host-side tests and tooling
 * target the rootless daemon without extra config. Falls back to the conventional
 * root socket. (ISSUE-045: integration tests previously always defaulted to
 * `/var/run/docker.sock` under a rootless service user.)
 */
export function resolveDockerSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DOCKER_SOCKET_PATH) {
    return env.DOCKER_SOCKET_PATH;
  }
  const host = env.DOCKER_HOST;
  if (host?.startsWith("unix://")) {
    return host.slice("unix://".length);
  }
  return "/var/run/docker.sock";
}

export function readConfig(): RunnerConfig {
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number.parseInt(process.env.PORT ?? "4001", 10),
    cppImage: process.env.CPP_IMAGE ?? "internal-code-runner-cpp:0.1.0",
    pythonImage: process.env.PYTHON_IMAGE ?? "internal-code-runner-python:0.1.0",
    javascriptImage: process.env.JAVASCRIPT_IMAGE ?? "internal-code-runner-javascript:0.1.0",
    javaImage: process.env.JAVA_IMAGE ?? "internal-code-runner-java:0.1.0",
    goImage: process.env.GO_IMAGE ?? "internal-code-runner-go:0.1.0",
    rustImage: process.env.RUST_IMAGE ?? "internal-code-runner-rust:0.1.0",
    maxConcurrentJobs: Number.parseInt(process.env.MAX_CONCURRENT_JOBS ?? "6", 10),
    runTimeoutMs: Number.parseInt(process.env.RUN_TIMEOUT_MS ?? "15000", 10),
    debugMaxMs: Number.parseInt(process.env.DEBUG_MAX_MS ?? "900000", 10),
    debugIdleMs: Number.parseInt(process.env.DEBUG_IDLE_MS ?? "300000", 10),
    memoryBytes: Number.parseInt(process.env.MEMORY_BYTES ?? String(1024 * 1024 * 1024), 10),
    nanoCpus: Number.parseInt(process.env.NANO_CPUS ?? "1000000000", 10),
    dockerSocketPath: resolveDockerSocketPath(),
    workspaceContainerRoot: process.env.WORKSPACE_CONTAINER_ROOT ?? tmpdir(),
    workspaceHostRoot: process.env.WORKSPACE_HOST_ROOT ?? process.env.WORKSPACE_CONTAINER_ROOT ?? tmpdir(),
    debugEngine: process.env.DEBUG_ENGINE === "mi" ? "mi" : "dap"
  };
}
