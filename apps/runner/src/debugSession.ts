import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import { MAX_OUTPUT_BYTES, type DebugCommand, type DebugEvent, type DebugRequest } from "@internal/shared";
import type { RunnerConfig } from "./config.js";
import type { EventBuffer } from "./eventBuffer.js";
import { escapeMiString, parseDoneValue, parseStack, parseStopped, parseVariables, decodeMiString } from "./gdbMi.js";
import { PhaseFilter } from "./phaseFilter.js";
import { createWorkspacePaths, type WorkspacePaths } from "./workspace.js";

type TokenMeta = {
  kind: "watch";
  expression: string;
};

export class DebugSession {
  readonly id = randomUUID();
  readonly events: EventBuffer<DebugEvent>;
  private container: Docker.Container | undefined;
  private stdin: NodeJS.WritableStream | undefined;
  private workspace: WorkspacePaths | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private maxTimer: NodeJS.Timeout | undefined;
  private token = 1;
  private readonly tokenMeta = new Map<number, TokenMeta>();
  private miBuffer = "";
  private outputBytes = 0;
  private startedProgram = false;
  private closed = false;

  constructor(
    private readonly docker: Docker,
    private readonly config: RunnerConfig,
    private readonly request: DebugRequest,
    events: EventBuffer<DebugEvent>,
    private readonly onClose: () => void
  ) {
    this.events = events;
  }

  async start(): Promise<void> {
    this.workspace = await this.createWorkspace();
    this.container = await this.docker.createContainer({
      Image: this.config.cppImage,
      Cmd: [this.request.language === "c" ? "/usr/local/bin/debug-c" : "/usr/local/bin/debug-cpp", ...this.request.argv],
      WorkingDir: "/workspace",
      OpenStdin: true,
      StdinOnce: false,
      Tty: false,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      NetworkDisabled: true,
      HostConfig: {
        AutoRemove: false,
        Binds: [`${this.workspace.hostPath}:/workspace:rw`],
        CapDrop: ["ALL"],
        Memory: this.config.memoryBytes,
        NanoCpus: this.config.nanoCpus,
        NetworkMode: "none",
        PidsLimit: 128,
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges"],
        Tmpfs: {
          "/tmp": "rw,nosuid,nodev,size=64m"
        }
      }
    });

    const stream = await this.container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true
    });
    this.stdin = stream;

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    this.docker.modem.demuxStream(stream, stdout, stderr);

    const stderrFilter = new PhaseFilter(
      (data) => {
        void this.emitLimitedOutput("stderr", data);
      },
      (marker) => {
        if (marker.phase === "compile") {
          this.events.emit({ type: "compile", status: marker.status });
        }
      }
    );

    stdout.on("data", (chunk: Buffer) => {
      this.handleMiChunk(chunk.toString("utf8"));
    });
    stderr.on("data", (chunk: Buffer) => {
      stderrFilter.write(chunk.toString("utf8"));
    });

    await this.container.start();
    this.events.emit({ type: "ready", id: this.id });

    this.resetTimers();

    setTimeout(() => {
      this.setBreakpoints(this.request.breakpoints);
    }, 500);

    void this.container.wait().then((result) => {
      if (this.closed) {
        return;
      }
      stderrFilter.flush();
      this.events.emit({
        type: "exit",
        code: typeof result.StatusCode === "number" ? result.StatusCode : null,
        signal: null,
        timedOut: false
      });
      void this.close(false);
    });
  }

  handleCommand(command: DebugCommand): void {
    this.resetTimers();

    if (command.type === "continue") {
      if (this.startedProgram) {
        this.sendMi("-exec-continue");
      } else {
        this.startedProgram = true;
        this.sendMi('-interpreter-exec console "run < /workspace/stdin.txt"');
      }
      return;
    }

    if (command.type === "pause") {
      this.stdin?.write("\x03");
      return;
    }

    if (command.type === "stepOver") {
      this.sendMi("-exec-next");
      return;
    }

    if (command.type === "stepInto") {
      this.sendMi("-exec-step");
      return;
    }

    if (command.type === "stepOut") {
      this.sendMi("-exec-finish");
      return;
    }

    if (command.type === "stop") {
      void this.close(true);
      return;
    }

    if (command.type === "setBreakpoints") {
      this.setBreakpoints(command.breakpoints);
      return;
    }

    if (command.type === "variables") {
      this.sendMi("-stack-list-variables --simple-values");
      return;
    }

    if (command.type === "stack") {
      this.sendMi("-stack-list-frames");
      return;
    }

    if (command.type === "evaluate") {
      this.sendMi(`-data-evaluate-expression "${escapeMiString(command.expression)}"`, {
        kind: "watch",
        expression: command.expression
      });
      return;
    }

    if (command.type === "raw") {
      if (command.command.startsWith("-")) {
        this.sendMi(command.command);
      } else {
        this.sendMi(`-interpreter-exec console "${escapeMiString(command.command)}"`);
      }
    }
  }

  async close(manual: boolean): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    await this.container?.remove({ force: true }).catch(() => undefined);
    if (this.workspace) {
      await rm(this.workspace.containerPath, { recursive: true, force: true }).catch(() => undefined);
    }
    if (manual) {
      this.events.emit({ type: "exit", code: null, signal: "SIGTERM", timedOut: false });
    }
    this.onClose();
  }

  private async createWorkspace(): Promise<WorkspacePaths> {
    const workspace = await createWorkspacePaths(this.config, `internal-code-debug-${this.id}-`);
    const root = workspace.containerPath;
    await mkdir(path.join(root, "tmp"), { recursive: true });
    await writeFile(path.join(root, this.request.language === "c" ? "main.c" : "main.cpp"), this.request.source, { mode: 0o600 });
    await writeFile(path.join(root, "stdin.txt"), this.request.stdin, { mode: 0o600 });
    return workspace;
  }

  private setBreakpoints(lines: number[]): void {
    this.sendMi("-break-delete");
    for (const line of lines) {
      const file = this.request.language === "c" ? "/workspace/main.c" : "/workspace/main.cpp";
      this.sendMi(`-break-insert ${file}:${line}`);
    }
  }

  private resetTimers(): void {
    clearTimeout(this.idleTimer);
    if (!this.maxTimer) {
      this.maxTimer = setTimeout(() => {
        this.events.emit({ type: "error", message: "Debug session exceeded the 15 minute limit" });
        void this.close(false);
      }, this.config.debugMaxMs);
    }

    this.idleTimer = setTimeout(() => {
      this.events.emit({ type: "error", message: "Debug session closed after 5 minutes of inactivity" });
      void this.close(false);
    }, this.config.debugIdleMs);
  }

  private sendMi(command: string, meta?: TokenMeta): number {
    const token = this.token++;
    if (meta) {
      this.tokenMeta.set(token, meta);
    }
    this.stdin?.write(`${token}${command}\n`);
    return token;
  }

  private handleMiChunk(data: string): void {
    this.miBuffer += data;
    let newline = this.miBuffer.indexOf("\n");
    while (newline >= 0) {
      const rawLine = this.miBuffer.slice(0, newline);
      this.miBuffer = this.miBuffer.slice(newline + 1);
      this.handleMiLine(rawLine);
      newline = this.miBuffer.indexOf("\n");
    }
  }

  private handleMiLine(rawLine: string): void {
    const line = rawLine.trim();
    if (!line || line === "(gdb)") {
      return;
    }

    const streamPrefix = line[0];
    if (streamPrefix === "~" || streamPrefix === "@" || streamPrefix === "&") {
      const decoded = decodeMiString(line.slice(1));
      void this.emitLimitedOutput(streamPrefix === "@" ? "stdout" : "console", decoded);
      return;
    }

    this.events.emit({ type: "mi", data: line });

    if (line.includes("*running")) {
      this.events.emit({ type: "running" });
      return;
    }

    const stopped = parseStopped(line);
    if (stopped) {
      this.events.emit({ type: "stopped", ...stopped });
      this.sendMi("-stack-list-frames");
      this.sendMi("-stack-list-variables --simple-values");
      return;
    }

    const stack = parseStack(line);
    if (stack) {
      this.events.emit({ type: "stack", frames: stack });
      return;
    }

    const variables = parseVariables(line);
    if (variables) {
      this.events.emit({ type: "variables", variables });
      return;
    }

    const tokenMatch = /^(\d+)\^(done|error)/.exec(line);
    if (tokenMatch?.[1]) {
      const token = Number.parseInt(tokenMatch[1], 10);
      const meta = this.tokenMeta.get(token);
      if (meta?.kind === "watch") {
        this.tokenMeta.delete(token);
        this.events.emit({
          type: "watch",
          expression: meta.expression,
          value: parseDoneValue(line),
          error: tokenMatch[2] === "error" ? parseDoneValue(line) ?? "Evaluation failed" : undefined
        });
      }
    }

    if (line.includes("^error")) {
      this.events.emit({ type: "error", message: parseDoneValue(line) ?? "GDB command failed" });
    }
  }

  private async emitLimitedOutput(type: "stdout" | "stderr" | "console", data: string): Promise<void> {
    if (this.outputBytes >= MAX_OUTPUT_BYTES) {
      return;
    }

    const bytes = Buffer.from(data);
    const remaining = MAX_OUTPUT_BYTES - this.outputBytes;
    const chunk = bytes.length > remaining ? bytes.subarray(0, remaining).toString("utf8") : data;
    this.outputBytes += Buffer.byteLength(chunk);
    this.events.emit({ type, data: chunk });

    if (bytes.length > remaining) {
      this.events.emit({ type: "error", message: "Debug output exceeded the 5MB limit" });
      await this.close(false);
    }
  }
}
