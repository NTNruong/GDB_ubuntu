import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import { MAX_OUTPUT_BYTES, type Language, type RunEvent, type RunRequest } from "@internal/shared";
import type { RunnerConfig } from "./config.js";
import type { EventBuffer } from "./eventBuffer.js";
import { PhaseFilter } from "./phaseFilter.js";
import { createWorkspacePaths, type WorkspacePaths } from "./workspace.js";

export class DockerRunner {
  readonly docker: Docker;

  constructor(private readonly config: RunnerConfig) {
    this.docker = new Docker({ socketPath: config.dockerSocketPath });
  }

  async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  async readiness(): Promise<{ ok: boolean; docker: boolean; images: { cpp: boolean; python: boolean } }> {
    const docker = await this.ping();
    const images = docker
      ? {
          cpp: await this.imageExists(this.config.cppImage),
          python: await this.imageExists(this.config.pythonImage)
        }
      : { cpp: false, python: false };

    return {
      ok: docker && images.cpp && images.python,
      docker,
      images
    };
  }

  async run(request: RunRequest, events: EventBuffer<RunEvent>): Promise<void> {
    const id = randomUUID();
    const workspace = await createWorkspace(id, request, this.config);
    let outputBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let container: Docker.Container | undefined;

    const emitLimited = async (type: "stdout" | "stderr", data: string) => {
      const bytes = Buffer.from(data);
      if (outputBytes >= MAX_OUTPUT_BYTES) {
        outputTruncated = true;
        await container?.kill().catch(() => undefined);
        return;
      }

      const remaining = MAX_OUTPUT_BYTES - outputBytes;
      const chunk = bytes.length > remaining ? bytes.subarray(0, remaining).toString("utf8") : data;
      outputBytes += Buffer.byteLength(chunk);

      if (bytes.length > remaining) {
        outputTruncated = true;
        events.emit({ type, data: chunk });
        await container?.kill().catch(() => undefined);
        return;
      }

      events.emit({ type, data: chunk });
    };

    try {
      const image = imageForLanguage(request.language, this.config);
      container = await this.docker.createContainer({
        Image: image,
        Cmd: commandForLanguage(request.language, request.argv),
        WorkingDir: "/workspace",
        OpenStdin: false,
        Tty: false,
        AttachStdout: true,
        AttachStderr: true,
        NetworkDisabled: true,
        Env: [`RUN_TIMEOUT_SECONDS=${Math.ceil(this.config.runTimeoutMs / 1000)}`],
        HostConfig: {
          AutoRemove: false,
          Binds: [`${workspace.hostPath}:/workspace:rw`],
          CapDrop: ["ALL"],
          Memory: this.config.memoryBytes,
          MemorySwap: this.config.memoryBytes,
          NanoCpus: this.config.nanoCpus,
          NetworkMode: "none",
          PidsLimit: 128,
          ReadonlyRootfs: true,
          SecurityOpt: ["no-new-privileges"],
          Tmpfs: {
            "/exec": "rw,exec,nosuid,nodev,size=64m",
            "/tmp": "rw,nosuid,nodev,size=64m"
          }
        }
      });

      const stream = await container.attach({ stream: true, stdout: true, stderr: true });
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      this.docker.modem.demuxStream(stream, stdout, stderr);

      const stderrFilter = new PhaseFilter(
        (data) => {
          void emitLimited("stderr", data);
        },
        (marker) => {
          if (marker.phase === "compile") {
            events.emit({ type: "compile", status: marker.status });
          } else {
            events.emit({ type: "run", status: "start" });
          }
        },
        (metric) => {
          events.emit({ type: "metric", phase: metric.phase, elapsedMs: metric.elapsedMs, memoryBytes: metric.memoryBytes });
        }
      );

      stdout.on("data", (chunk: Buffer) => {
        void emitLimited("stdout", chunk.toString("utf8"));
      });
      stderr.on("data", (chunk: Buffer) => {
        stderrFilter.write(chunk.toString("utf8"));
      });

      await container.start();

      const timeout = setTimeout(() => {
        timedOut = true;
        void container?.kill().catch(() => undefined);
      }, this.config.runTimeoutMs + 1_000);

      const result = await container.wait();
      clearTimeout(timeout);
      stderrFilter.flush();

      events.emit({
        type: "exit",
        code: typeof result.StatusCode === "number" ? result.StatusCode : null,
        signal: timedOut ? "SIGKILL" : null,
        timedOut,
        outputTruncated
      });
    } catch (error) {
      events.emit({ type: "error", message: error instanceof Error ? error.message : "Runner failed" });
    } finally {
      await container?.remove({ force: true }).catch(() => undefined);
      await rm(workspace.containerPath, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async imageExists(image: string): Promise<boolean> {
    try {
      await this.docker.getImage(image).inspect();
      return true;
    } catch {
      return false;
    }
  }
}

function imageForLanguage(language: Language, config: RunnerConfig): string {
  return language === "python" ? config.pythonImage : config.cppImage;
}

function commandForLanguage(language: Language, argv: string[]): string[] {
  if (language === "c") {
    return ["/usr/local/bin/run-c", ...argv];
  }

  if (language === "cpp") {
    return ["/usr/local/bin/run-cpp", ...argv];
  }

  return ["/usr/local/bin/run-python", ...argv];
}

async function createWorkspace(id: string, request: RunRequest, config: RunnerConfig): Promise<WorkspacePaths> {
  const workspace = await createWorkspacePaths(config, `internal-code-runner-${id}-`);
  const root = workspace.containerPath;
  await mkdir(path.join(root, "tmp"), { recursive: true });
  await writeFile(path.join(root, sourceFileName(request.language)), request.source, { mode: 0o600 });
  await writeFile(path.join(root, "stdin.txt"), request.stdin, { mode: 0o600 });

  // Keep an empty writable file available for programs that expect a local output target.
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(path.join(root, "scratch.txt"), { mode: 0o600 });
    stream.on("finish", resolve);
    stream.on("error", reject);
    stream.end("");
  });

  return workspace;
}

function sourceFileName(language: Language): string {
  if (language === "c") {
    return "main.c";
  }

  if (language === "cpp") {
    return "main.cpp";
  }

  return "main.py";
}
