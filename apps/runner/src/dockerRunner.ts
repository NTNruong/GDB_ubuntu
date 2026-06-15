import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import { MAX_OUTPUT_BYTES, resolveToolchainVersion, type Language, type RunEvent, type RunRequest } from "@internal/shared";
import type { RunnerConfig } from "./config.js";
import type { EventBuffer } from "./eventBuffer.js";
import { PhaseFilter } from "./phaseFilter.js";
import { createWorkspacePaths, writeProjectFiles, type WorkspacePaths } from "./workspace.js";

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

  async readiness(): Promise<{
    ok: boolean;
    docker: boolean;
    images: { cpp: boolean; python: boolean; javascript: boolean; java: boolean; go: boolean; rust: boolean };
  }> {
    const docker = await this.ping();
    const images = docker
      ? {
          cpp: await this.imageExists(this.config.cppImage),
          python: await this.imageExists(this.config.pythonImage),
          javascript: await this.imageExists(this.config.javascriptImage),
          java: await this.imageExists(this.config.javaImage),
          go: await this.imageExists(this.config.goImage),
          rust: await this.imageExists(this.config.rustImage)
        }
      : { cpp: false, python: false, javascript: false, java: false, go: false, rust: false };

    return {
      ok: docker && images.cpp && images.python && images.javascript && images.java && images.go && images.rust,
      docker,
      images
    };
  }

  async run(request: RunRequest, events: EventBuffer<RunEvent>, signal?: AbortSignal): Promise<void> {
    const id = randomUUID();
    const workspace = await createWorkspace(id, request, this.config);
    let outputBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let cancelled = false;
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

    const emitCancelledExit = () => {
      cancelled = true;
      events.emit({ type: "exit", code: null, signal: "SIGKILL", timedOut: false, outputTruncated, cancelled: true });
    };

    try {
      // Stop pressed before the container even existed.
      if (signal?.aborted) {
        emitCancelledExit();
        return;
      }

      const image = imageForLanguage(request.language, this.config);
      const env = [`RUN_TIMEOUT_SECONDS=${Math.ceil(this.config.runTimeoutMs / 1000)}`];
      const toolchainVersion = resolveToolchainVersion(request.language, request.toolchainVersion);
      if (toolchainVersion) {
        // e.g. Java: the entrypoint reads JAVA_VERSION to pick the JDK.
        env.push(`JAVA_VERSION=${toolchainVersion}`);
      }
      container = await this.docker.createContainer({
        Image: image,
        Cmd: commandForLanguage(request.language, request.argv),
        WorkingDir: "/workspace",
        OpenStdin: false,
        Tty: false,
        AttachStdout: true,
        AttachStderr: true,
        NetworkDisabled: true,
        Env: env,
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
          events.emit({
            type: "metric",
            phase: metric.phase,
            cpuMs: metric.cpuMs,
            cpuScope: metric.cpuScope,
            memoryBytes: metric.memoryBytes
          });
        }
      );

      stdout.on("data", (chunk: Buffer) => {
        void emitLimited("stdout", chunk.toString("utf8"));
      });
      stderr.on("data", (chunk: Buffer) => {
        stderrFilter.write(chunk.toString("utf8"));
      });

      // Stop pressed during create/attach, before we start the program.
      if (signal?.aborted) {
        emitCancelledExit();
        return;
      }

      await container.start();

      // From here a cancel must kill the running container.
      signal?.addEventListener(
        "abort",
        () => {
          cancelled = true;
          void container?.kill().catch(() => undefined);
        },
        { once: true }
      );

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
        signal: timedOut || cancelled ? "SIGKILL" : null,
        timedOut,
        outputTruncated,
        cancelled
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
  if (language === "python") {
    return config.pythonImage;
  }
  if (language === "javascript") {
    return config.javascriptImage;
  }
  if (language === "java") {
    return config.javaImage;
  }
  if (language === "go") {
    return config.goImage;
  }
  if (language === "rust") {
    return config.rustImage;
  }
  return config.cppImage;
}

function commandForLanguage(language: Language, argv: string[]): string[] {
  if (language === "c") {
    return ["/usr/local/bin/run-c", ...argv];
  }

  if (language === "cpp") {
    return ["/usr/local/bin/run-cpp", ...argv];
  }

  if (language === "javascript") {
    return ["/usr/local/bin/run-javascript", ...argv];
  }

  if (language === "java") {
    return ["/usr/local/bin/run-java", ...argv];
  }

  if (language === "go") {
    return ["/usr/local/bin/run-go", ...argv];
  }

  if (language === "rust") {
    return ["/usr/local/bin/run-rust", ...argv];
  }

  return ["/usr/local/bin/run-python", ...argv];
}

async function createWorkspace(id: string, request: RunRequest, config: RunnerConfig): Promise<WorkspacePaths> {
  const workspace = await createWorkspacePaths(config, `internal-code-runner-${id}-`);
  const root = workspace.containerPath;
  await mkdir(path.join(root, "tmp"), { recursive: true });
  await writeProjectFiles(root, request.files, request.language);
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
