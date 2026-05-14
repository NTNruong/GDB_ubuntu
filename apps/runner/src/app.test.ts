import { describe, expect, it } from "vitest";
import { createRunnerServer } from "./app.js";
import type { RunnerConfig } from "./config.js";

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
    workspaceHostRoot: "/tmp"
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
});
