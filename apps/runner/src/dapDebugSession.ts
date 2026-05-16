import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import {
  MAX_OUTPUT_BYTES,
  type DebugCommand,
  type DebugEvent,
  type DebugFrame,
  type DebugRequest,
  type DebugVariable,
  type Language
} from "@internal/shared";
import { DapClient, type DapEvent } from "./dapClient.js";
import type { RunnerConfig } from "./config.js";
import type { EventBuffer } from "./eventBuffer.js";
import { PhaseFilter } from "./phaseFilter.js";
import { createWorkspacePaths, type WorkspacePaths } from "./workspace.js";

type DapSource = {
  path?: string;
  name?: string;
};

type DapStackFrame = {
  id: number;
  name: string;
  source?: DapSource;
  line?: number;
};

type DapScope = {
  name: string;
  variablesReference: number;
  expensive?: boolean;
};

type DapVariable = {
  name: string;
  value?: string;
  variablesReference?: number;
};

export class DapDebugSession {
  readonly id = randomUUID();
  readonly events: EventBuffer<DebugEvent>;
  private container: Docker.Container | undefined;
  private stdin: NodeJS.WritableStream | undefined;
  private dap: DapClient | undefined;
  private workspace: WorkspacePaths | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private maxTimer: NodeJS.Timeout | undefined;
  private initialized = false;
  private resolveInitialized: (() => void) | undefined;
  private currentThreadId: number | undefined;
  private currentFrameId: number | undefined;
  private autoContinueOnInitialStop = true;
  private outputBytes = 0;
  private exitEmitted = false;
  private pendingExitCode: number | null = null;
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
      Image: imageForLanguage(this.request.language, this.config),
      Cmd: commandForLanguage(this.request.language, this.request.argv),
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

    stderr.on("data", (chunk: Buffer) => {
      stderrFilter.write(chunk.toString("utf8"));
    });

    this.dap = new DapClient(stdout, stream);
    this.dap.onEvent((event) => {
      void this.handleDapEvent(event).catch((error) => this.emitError(error));
    });
    this.dap.onError((error) => this.emitError(error));

    await this.container.start();
    this.resetTimers();

    await this.initializeDap();
    this.events.emit({ type: "ready", id: this.id });

    void this.container.wait().then((result) => {
      if (this.closed) {
        return;
      }
      stderrFilter.flush();
      this.emitExit(typeof result.StatusCode === "number" ? result.StatusCode : this.pendingExitCode, false);
      void this.close(false);
    });
  }

  handleCommand(command: DebugCommand): void {
    this.resetTimers();
    void this.handleCommandAsync(command).catch((error) => this.emitError(error));
  }

  async close(manual: boolean): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    await this.dap?.request("disconnect", { terminateDebuggee: true }).catch(() => undefined);
    this.dap?.close();
    await this.container?.remove({ force: true }).catch(() => undefined);
    if (this.workspace) {
      await rm(this.workspace.containerPath, { recursive: true, force: true }).catch(() => undefined);
    }
    if (manual) {
      this.emitExit(null, false, "SIGTERM");
    }
    this.onClose();
  }

  private async initializeDap(): Promise<void> {
    if (!this.dap) {
      throw new Error("DAP client was not started");
    }

    await this.dap.request("initialize", {
      clientID: "gdb-ubuntu-runner",
      clientName: "GDB Ubuntu Runner",
      adapterID: this.request.language === "python" ? "debugpy" : "gdb",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
      supportsVariableType: false,
      supportsVariablePaging: true
    });

    const attach = this.dap.request("attach", this.attachArguments());
    await this.waitForInitialized(10_000);
    await this.applyBreakpoints(this.request.breakpoints);
    await this.dap.request("configurationDone");
    await attach.catch((error) => {
      throw error instanceof Error ? error : new Error("DAP attach failed");
    });
  }

  private attachArguments(): Record<string, unknown> {
    if (this.request.language === "python") {
      return {
        name: "Python",
        type: "python",
        request: "attach",
        connect: {
          host: "127.0.0.1",
          port: 5678
        },
        pathMappings: [
          {
            localRoot: "/workspace",
            remoteRoot: "/workspace"
          }
        ],
        justMyCode: false,
        subProcess: false,
        redirectOutput: true
      };
    }

    return {
      name: this.request.language === "c" ? "C" : "C++",
      type: "gdb",
      request: "attach",
      program: "/workspace/program",
      cwd: "/workspace",
      target: "127.0.0.1:2345"
    };
  }

  private waitForInitialized(timeoutMs: number): Promise<void> {
    if (this.initialized) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.resolveInitialized === resolveInitialized) {
          this.resolveInitialized = undefined;
        }
        reject(new Error("Timed out waiting for DAP initialized event"));
      }, timeoutMs);

      const resolveInitialized = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.resolveInitialized = resolveInitialized;
    });
  }

  private async handleCommandAsync(command: DebugCommand): Promise<void> {
    if (!this.dap) {
      return;
    }

    if (command.type === "continue") {
      const threadId = await this.requireThreadId();
      await this.dap.request("continue", { threadId });
      this.events.emit({ type: "running" });
      return;
    }

    if (command.type === "pause") {
      const threadId = await this.requireThreadId();
      await this.dap.request("pause", { threadId });
      return;
    }

    if (command.type === "stepOver") {
      const threadId = await this.requireThreadId();
      await this.dap.request("next", { threadId });
      this.events.emit({ type: "running" });
      return;
    }

    if (command.type === "stepInto") {
      const threadId = await this.requireThreadId();
      await this.dap.request("stepIn", { threadId });
      this.events.emit({ type: "running" });
      return;
    }

    if (command.type === "stepOut") {
      const threadId = await this.requireThreadId();
      await this.dap.request("stepOut", { threadId });
      this.events.emit({ type: "running" });
      return;
    }

    if (command.type === "stop") {
      await this.close(true);
      return;
    }

    if (command.type === "setBreakpoints") {
      await this.applyBreakpoints(command.breakpoints);
      return;
    }

    if (command.type === "variables") {
      await this.refreshVariables();
      return;
    }

    if (command.type === "stack") {
      await this.refreshStackAndVariables(await this.requireThreadId(), undefined);
      return;
    }

    if (command.type === "evaluate") {
      await this.evaluateWatch(command.expression);
      return;
    }

    if (command.type === "raw") {
      await this.evaluateRepl(command.command);
    }
  }

  private async handleDapEvent(event: DapEvent): Promise<void> {
    const body = asRecord(event.body);

    if (event.event === "initialized") {
      this.initialized = true;
      this.resolveInitialized?.();
      this.resolveInitialized = undefined;
      return;
    }

    if (event.event === "output") {
      const output = asString(body.output);
      if (output) {
        const category = asString(body.category);
        await this.emitLimitedOutput(category === "stderr" ? "stderr" : category === "stdout" ? "stdout" : "console", output);
      }
      return;
    }

    if (event.event === "continued") {
      this.events.emit({ type: "running" });
      return;
    }

    if (event.event === "stopped") {
      const threadId = asNumber(body.threadId) ?? (await this.requireThreadId());
      const reason = asString(body.reason);
      this.currentThreadId = threadId;

      if (this.autoContinueOnInitialStop && reason !== "breakpoint") {
        this.autoContinueOnInitialStop = false;
        await this.dap?.request("continue", { threadId }).catch((error) => this.emitError(error));
        this.events.emit({ type: "running" });
        return;
      }

      this.autoContinueOnInitialStop = false;
      await this.refreshStackAndVariables(threadId, reason);
      return;
    }

    if (event.event === "exited") {
      this.pendingExitCode = asNumber(body.exitCode) ?? null;
      return;
    }

    if (event.event === "terminated") {
      this.emitExit(this.pendingExitCode, false);
      await this.close(false);
    }
  }

  private async refreshStackAndVariables(threadId: number, reason: string | undefined): Promise<void> {
    if (!this.dap) {
      return;
    }

    const response = await this.dap.request("stackTrace", {
      threadId,
      startFrame: 0,
      levels: 20
    });
    const frames = asArray(asRecord(response.body).stackFrames)
      .map(toStackFrame)
      .filter((frame): frame is DapStackFrame => Boolean(frame));

    const topFrame = frames[0];
    this.currentFrameId = topFrame?.id;
    this.events.emit({
      type: "stopped",
      reason,
      file: topFrame?.source?.path ?? topFrame?.source?.name,
      line: topFrame?.line,
      func: topFrame?.name
    });
    this.events.emit({ type: "stack", frames: frames.map(toDebugFrame) });
    await this.refreshVariables();
  }

  private async refreshVariables(): Promise<void> {
    if (!this.dap || this.currentFrameId === undefined) {
      this.events.emit({ type: "variables", variables: [] });
      return;
    }

    const scopesResponse = await this.dap.request("scopes", { frameId: this.currentFrameId });
    const scopes = asArray(asRecord(scopesResponse.body).scopes)
      .map(toScope)
      .filter((scope): scope is DapScope => Boolean(scope && scope.variablesReference > 0 && !scope.expensive));
    const variables: DebugVariable[] = [];

    for (const scope of scopes.slice(0, 3)) {
      const response = await this.dap.request("variables", {
        variablesReference: scope.variablesReference,
        start: 0,
        count: 100
      });
      const scopedVariables = asArray(asRecord(response.body).variables)
        .map(toVariable)
        .filter((variable): variable is DapVariable => Boolean(variable))
        .map((variable) => ({
          name: variable.name,
          value: variable.value
        }));
      variables.push(...scopedVariables);
    }

    this.events.emit({ type: "variables", variables });
  }

  private async evaluateWatch(expression: string): Promise<void> {
    if (!this.dap) {
      return;
    }

    try {
      const response = await this.dap.request("evaluate", {
        expression,
        frameId: this.currentFrameId,
        context: "watch"
      });
      this.events.emit({
        type: "watch",
        expression,
        value: asString(asRecord(response.body).result) ?? ""
      });
    } catch (error) {
      this.events.emit({
        type: "watch",
        expression,
        error: error instanceof Error ? error.message : "Evaluation failed"
      });
    }
  }

  private async evaluateRepl(command: string): Promise<void> {
    if (!this.dap) {
      return;
    }

    try {
      const response = await this.dap.request("evaluate", {
        expression: command,
        frameId: this.currentFrameId,
        context: "repl"
      });
      const result = asString(asRecord(response.body).result);
      if (result) {
        await this.emitLimitedOutput("console", `${result}\n`);
      }
    } catch (error) {
      this.emitError(error);
    }
  }

  private async applyBreakpoints(lines: number[]): Promise<void> {
    await this.dap?.request("setBreakpoints", {
      source: {
        path: sourcePath(this.request.language)
      },
      breakpoints: lines.map((line) => ({ line })),
      sourceModified: false
    });
  }

  private async requireThreadId(): Promise<number> {
    if (this.currentThreadId !== undefined) {
      return this.currentThreadId;
    }

    if (!this.dap) {
      throw new Error("DAP client was not started");
    }

    const response = await this.dap.request("threads");
    const thread = asArray(asRecord(response.body).threads)
      .map((item) => asRecord(item))
      .find((item) => asNumber(item.id) !== undefined);
    const id = asNumber(thread?.id);
    if (id === undefined) {
      throw new Error("No debug thread is available");
    }

    this.currentThreadId = id;
    return id;
  }

  private async createWorkspace(): Promise<WorkspacePaths> {
    const workspace = await createWorkspacePaths(this.config, `internal-code-dap-debug-${this.id}-`);
    const root = workspace.containerPath;
    await mkdir(path.join(root, "tmp"), { recursive: true });
    await writeFile(path.join(root, sourceFileName(this.request.language)), this.request.source, { mode: 0o600 });
    await writeFile(path.join(root, "stdin.txt"), this.request.stdin, { mode: 0o600 });
    return workspace;
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

  private emitError(error: unknown): void {
    this.events.emit({ type: "error", message: error instanceof Error ? error.message : "Debug adapter failed" });
  }

  private emitExit(code: number | null, timedOut: boolean, signal?: string): void {
    if (this.exitEmitted) {
      return;
    }

    this.exitEmitted = true;
    this.events.emit({ type: "exit", code, signal, timedOut });
  }
}

function commandForLanguage(language: Language, argv: string[]): string[] {
  if (language === "c") {
    return ["/usr/local/bin/debug-dap-c", ...argv];
  }

  if (language === "cpp") {
    return ["/usr/local/bin/debug-dap-cpp", ...argv];
  }

  return ["/usr/local/bin/debug-dap-python", ...argv];
}

function imageForLanguage(language: Language, config: RunnerConfig): string {
  return language === "python" ? config.pythonImage : config.cppImage;
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

function sourcePath(language: Language): string {
  return `/workspace/${sourceFileName(language)}`;
}

function toStackFrame(value: unknown): DapStackFrame | null {
  const frame = asRecord(value);
  const id = asNumber(frame.id);
  const name = asString(frame.name);
  if (id === undefined || !name) {
    return null;
  }

  const source = asRecord(frame.source);
  return {
    id,
    name,
    source: Object.keys(source).length > 0 ? { path: asString(source.path), name: asString(source.name) } : undefined,
    line: asNumber(frame.line)
  };
}

function toDebugFrame(frame: DapStackFrame, index: number): DebugFrame {
  return {
    level: index,
    func: frame.name,
    file: frame.source?.path ?? frame.source?.name,
    line: frame.line
  };
}

function toScope(value: unknown): DapScope | null {
  const scope = asRecord(value);
  const name = asString(scope.name);
  const variablesReference = asNumber(scope.variablesReference);
  if (!name || variablesReference === undefined) {
    return null;
  }

  return {
    name,
    variablesReference,
    expensive: Boolean(scope.expensive)
  };
}

function toVariable(value: unknown): DapVariable | null {
  const variable = asRecord(value);
  const name = asString(variable.name);
  if (!name) {
    return null;
  }

  return {
    name,
    value: asString(variable.value),
    variablesReference: asNumber(variable.variablesReference)
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
