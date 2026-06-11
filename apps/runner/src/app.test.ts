import { describe, expect, it } from "vitest";
import { createRunnerServer } from "./app.js";
import type { RunnerConfig } from "./config.js";
import type { DockerRunner } from "./dockerRunner.js";

describe("runner app", () => {
  const config: RunnerConfig = {
    host: "127.0.0.1",
    port: 0,
    cppImage: "internal-code-runner-cpp:test",
    pythonImage: "internal-code-runner-python:test",
    maxConcurrentJobs: 6,
    runTimeoutMs: 1_000,
    debugMaxMs: 1_000,
    debugIdleMs: 1_000,
    memoryBytes: 64 * 1024 * 1024,
    nanoCpus: 100_000_000,
    dockerSocketPath: "/var/run/docker.sock",
    workspaceContainerRoot: "/tmp",
    workspaceHostRoot: "/tmp",
    debugEngine: "dap"
  };

  it("opens debug websocket routes and reports missing sessions", async () => {
    const app = createRunnerServer(config);
    await app.ready();

    let resolveMessage: (message: Buffer) => void = () => {};
    const messagePromise = new Promise<Buffer>((resolve) => {
      resolveMessage = resolve;
    });
    const socket = await app.injectWS("/debug/missing-session", {}, {
      onInit: (ws) => ws.once("message", (message) => resolveMessage(message as Buffer))
    });
    const message = await messagePromise;
    socket.close();
    await app.close();

    expect(JSON.parse(message.toString())).toEqual({
      type: "error",
      message: "Debug session not found"
    });
  });

  it("cancels a run job (aborts the runner signal) and 404s an unknown job", async () => {
    let capturedSignal: AbortSignal | undefined;
    const runner = {
      // Resolve only when cancelled, so the job stays active until /cancel.
      run: (_request: unknown, _events: unknown, signal?: AbortSignal) => {
        capturedSignal = signal;
        return new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
      },
      readiness: async () => ({ ok: true, docker: true, images: { cpp: true, python: true } })
    } as unknown as DockerRunner;

    const app = createRunnerServer(config, runner);
    await app.ready();

    const unknown = await app.inject({ method: "POST", url: "/run/does-not-exist/cancel" });
    expect(unknown.statusCode).toBe(404);

    const created = await app.inject({
      method: "POST",
      url: "/run",
      payload: { language: "python", files: [{ path: "main.py", content: "print(1)" }] }
    });
    expect(created.statusCode).toBe(202);
    const { id } = created.json() as { id: string };

    const cancelled = await app.inject({ method: "POST", url: `/run/${id}/cancel` });
    expect(cancelled.statusCode).toBe(202);
    expect(capturedSignal?.aborted).toBe(true);

    await app.close();
  });
});
