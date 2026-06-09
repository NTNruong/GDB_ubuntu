import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import {
  MAX_OUTPUT_BYTES,
  type Breakpoint,
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
import { createWorkspacePaths, writeProjectFiles, type WorkspacePaths } from "./workspace.js";

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

const VAR_SUMMARY_MAX_ITEMS = 10;
const VAR_SUMMARY_MAX_CHARS = 200;
const VAR_SUMMARY_MAX_AGGREGATES = 50;
const VAR_EXPAND_MAX_CHILDREN = 200;

export class DapDebugSession {
  readonly id = randomUUID();
  readonly events: EventBuffer<DebugEvent>;
  private container: Docker.Container | undefined;
  private dap: DapClient | undefined;
  private workspace: WorkspacePaths | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private maxTimer: NodeJS.Timeout | undefined;
  private initialized = false;
  private resolveInitialized: (() => void) | undefined;
  private currentThreadId: number | undefined;
  private currentFrameId: number | undefined;
  private stopped = false;
  private autoContinueOnInitialStop = true;
  private outputBytes = 0;
  private programOutputFlushed = false;
  private exitEmitted = false;
  private pendingExitCode: number | null = null;
  private closed = false;
  private readonly watchExpressions = new Set<string>();
  private breakpointFiles = new Set<string>();
  private watchRefreshSeq = 0;
  private readonly verbose = process.env.DEBUG_VERBOSE === "1";

  constructor(
    private readonly docker: Docker,
    private readonly config: RunnerConfig,
    private readonly request: DebugRequest,
    events: EventBuffer<DebugEvent>,
    private readonly onCloseStart: () => void,
    private readonly onClose: () => void
  ) {
    this.events = events;
  }

  async start(): Promise<void> {
    this.workspace = await this.createWorkspace();
    let resolveCompileDone: (() => void) | undefined;
    const compileDone = new Promise<void>((resolve) => {
      resolveCompileDone = resolve;
    });
    let resolveFirstAdapterEvent: (() => void) | undefined;
    const firstAdapterEvent = new Promise<void>((resolve) => {
      resolveFirstAdapterEvent = resolve;
    });

    this.container = await withTimeout(
      this.docker.createContainer({
        Image: imageForLanguage(this.request.language, this.config),
        Cmd: commandForLanguage(this.request.language, this.request.argv),
        WorkingDir: "/workspace",
        OpenStdin: true,
        StdinOnce: false,
        Tty: false,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        HostConfig: {
          AutoRemove: false,
          Binds: [`${this.workspace.hostPath}:/workspace:rw`],
          CapDrop: ["ALL"],
          CapAdd: ["SYS_PTRACE"],
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
      }),
      10_000,
      "Timed out creating debug container"
    );

    const stream = await withTimeout(
      this.container.attach({
        stream: true,
        hijack: true,
        stdin: true,
        stdout: true,
        stderr: true
      }),
      10_000,
      "Timed out attaching debug container"
    );
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
          if (marker.status === "done") {
            resolveCompileDone?.();
            resolveCompileDone = undefined;
          }
        }
      }
    );

    stderr.on("data", (chunk: Buffer) => {
      stderrFilter.write(chunk.toString("utf8"));
    });

    this.dap = new DapClient(stdout, stream);
    this.dap.onEvent((event) => {
      resolveFirstAdapterEvent?.();
      resolveFirstAdapterEvent = undefined;
      void this.handleDapEvent(event).catch((error) => this.emitError(error));
    });
    this.dap.onError((error) => this.emitError(error));

    await withTimeout(this.container.start(), 10_000, "Timed out starting debug container");
    this.resetTimers();

    void this.container.wait().then((result) => {
      if (this.closed) {
        return;
      }
      stderrFilter.flush();
      this.emitExit(typeof result.StatusCode === "number" ? result.StatusCode : this.pendingExitCode, false);
      void this.close(false);
    });

    await this.initializeDap(compileDone, firstAdapterEvent);
    this.events.emit({ type: "ready", id: this.id });
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
    this.onCloseStart();
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    await this.flushProgramOutput();
    await this.dap?.request("disconnect", { terminateDebuggee: true }).catch(() => undefined);
    this.dap?.close();
    this.dap = undefined;
    await this.container?.remove({ force: true }).catch(() => undefined);
    if (this.workspace) {
      await rm(this.workspace.containerPath, { recursive: true, force: true }).catch(() => undefined);
    }
    if (manual) {
      this.emitExit(null, false, "SIGTERM");
    }
    this.onClose();
  }

  private async initializeDap(compileDone: Promise<void>, firstAdapterEvent: Promise<void>): Promise<void> {
    if (!this.dap) {
      throw new Error("DAP client was not started");
    }

    await this.waitForDebugAdapterReady(compileDone, firstAdapterEvent);

    await this.dap.request("initialize", {
      clientID: "gdb-ubuntu-runner",
      clientName: "GDB Ubuntu Runner",
      adapterID: this.request.language === "python" ? "debugpy" : "gdb",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
      supportsVariableType: false
    });

    const dapCommand = "launch";
    const connect = this.dap.request(dapCommand, this.attachArguments());
    void connect.catch(() => {}); // prevent unhandled rejection if waitForInitialized throws first
    await this.waitForInitialized(10_000);
    await this.applyBreakpoints(this.request.breakpoints);
    await this.dap.request("configurationDone").catch((error) => {
      if (this.request.language !== "python" && error instanceof Error && error.message === "notStopped") {
        return;
      }

      throw error;
    });
    await connect.catch((error) => {
      throw error instanceof Error ? error : new Error("DAP connect failed");
    });
  }

  private attachArguments(): Record<string, unknown> {
    if (this.request.language === "python") {
      return {
        name: "Python",
        type: "python",
        request: "launch",
        program: "/workspace/__debugpy_runner.py",
        args: ["/workspace/main.py", ...this.request.argv],
        cwd: "/workspace",
        console: "internalConsole",
        python: ["python3", "-I"],
        justMyCode: false,
        subProcess: false,
        redirectOutput: true
      };
    }

    return {
      name: this.request.language === "c" ? "C" : "C++",
      type: "gdb",
      program: "/exec/program",
      args: this.request.argv,
      cwd: "/workspace",
      stopAtEntry: false
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

  private async waitForDebugAdapterReady(compileDone: Promise<void>, firstAdapterEvent: Promise<void>): Promise<void> {
    if (this.request.language === "python") {
      const pythonStartupMs = Number.parseInt(process.env.DAP_PYTHON_STARTUP_MS ?? "5000", 10);
      await withTimeout(firstAdapterEvent, pythonStartupMs, "Timed out waiting for Python debug adapter to start");
      await delay(1_000);
      return;
    }

    await withTimeout(compileDone, 30_000, "Timed out compiling debug program");
    await delay(100);
  }

  private async handleCommandAsync(command: DebugCommand): Promise<void> {
    if (!this.dap) {
      return;
    }

    if (command.type === "continue") {
      const threadId = await this.requireThreadId();
      this.stopped = false;
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
      this.stopped = false;
      await this.dap.request("next", { threadId });
      this.events.emit({ type: "running" });
      return;
    }

    if (command.type === "stepInto") {
      const threadId = await this.requireThreadId();
      this.stopped = false;
      await this.dap.request("stepIn", { threadId });
      this.events.emit({ type: "running" });
      return;
    }

    if (command.type === "stepOut") {
      const threadId = await this.requireThreadId();
      this.stopped = false;
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
      this.watchExpressions.add(command.expression);
      await this.evaluateWatch(command.expression);
      return;
    }

    if (command.type === "removeWatch") {
      this.watchExpressions.delete(command.expression);
      return;
    }

    if (command.type === "expand") {
      await this.expandVariable(command.variablesReference);
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
      this.stopped = false;
      this.events.emit({ type: "running" });
      return;
    }

    if (event.event === "stopped") {
      const threadId = asNumber(body.threadId) ?? (await this.requireThreadId());
      const reason = asString(body.reason);
      this.currentThreadId = threadId;

      if (this.autoContinueOnInitialStop && reason !== "breakpoint") {
        this.autoContinueOnInitialStop = false;
        this.stopped = false;
        await this.dap?.request("continue", { threadId }).catch((error) => this.emitError(error));
        this.events.emit({ type: "running" });
        return;
      }

      this.autoContinueOnInitialStop = false;

      const frames = await this.fetchFrames(threadId);
      if (reason !== "pause" && reason !== "breakpoint" && !this.hasUserFrame(frames)) {
        // Stepped out of all user code (e.g. past main's return) — running to exit
        // routes into the proven exited→flush→terminated path instead of hanging.
        this.stopped = false;
        await this.dap?.request("continue", { threadId }).catch((error) => this.emitError(error));
        this.events.emit({ type: "running" });
        return;
      }

      this.stopped = true;
      await this.refreshStackAndVariables(threadId, reason, frames);
      return;
    }

    if (event.event === "exited") {
      this.pendingExitCode = asNumber(body.exitCode) ?? null;
      await this.flushProgramOutput();
      return;
    }

    if (event.event === "terminated") {
      this.emitExit(this.pendingExitCode, false);
      await this.close(false);
    }
  }

  private async fetchFrames(threadId: number): Promise<DapStackFrame[]> {
    if (!this.dap) {
      return [];
    }

    const response = await this.dap.request("stackTrace", {
      threadId,
      startFrame: 0,
      levels: 20
    });
    return asArray(asRecord(response.body).stackFrames)
      .map(toStackFrame)
      .filter((frame): frame is DapStackFrame => {
        if (!frame) return false;
        if (this.request.language !== "python") return true;
        const src = frame.source?.path ?? frame.source?.name ?? "";
        return src.startsWith("/workspace/") && !src.endsWith("__debugpy_runner.py");
      });
  }

  private hasUserFrame(frames: DapStackFrame[]): boolean {
    return frames.some((frame) => {
      const src = frame.source?.path ?? frame.source?.name ?? "";
      return src.startsWith("/workspace/") && !src.endsWith("__debugpy_runner.py");
    });
  }

  private async refreshStackAndVariables(
    threadId: number,
    reason: string | undefined,
    prefetchedFrames?: DapStackFrame[]
  ): Promise<void> {
    if (!this.dap) {
      return;
    }

    const frames = prefetchedFrames ?? (await this.fetchFrames(threadId));

    const topFrame = frames[0];
    this.currentFrameId = topFrame?.id;
    if (!topFrame && this.verbose) {
      this.events.emit({ type: "console", data: "[stack] No frames in stackTrace response\n" });
    }
    this.events.emit({
      type: "stopped",
      reason,
      file: topFrame?.source?.path ?? topFrame?.source?.name,
      line: topFrame?.line,
      func: topFrame?.name
    });
    this.events.emit({ type: "stack", frames: frames.map(toDebugFrame) });
    await this.refreshVariables();
    await this.refreshWatches();
  }

  private async refreshVariables(): Promise<void> {
    if (!this.dap || this.currentFrameId === undefined || !this.stopped) {
      this.events.emit({ type: "variables", variables: [] });
      return;
    }

    const frameId = this.currentFrameId;
    const variables: DebugVariable[] = [];
    let scopes: DapScope[] = [];

    try {
      const scopesResponse = await this.dap.request("scopes", { frameId });
      scopes = asArray(asRecord(scopesResponse.body).scopes)
        .map(toScope)
        .filter((scope): scope is DapScope => Boolean(
          scope &&
          scope.variablesReference > 0 &&
          (this.request.language === "python"
            ? !scope.expensive && /^(local|argument)/i.test(scope.name)
            : !/^register/i.test(scope.name))
        ));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.events.emit({ type: "console", data: `[variables] scopes frame=${frameId} error="${msg}"\n` });
    }

    if (scopes.length === 0 && this.request.language !== "python" && this.verbose) {
      this.events.emit({ type: "console", data: `[variables] no scopes for frame ${frameId}\n` });
    }

    let summaryBudget = VAR_SUMMARY_MAX_AGGREGATES;
    for (const scope of scopes) {
      try {
        const response = await this.dap.request("variables", {
          variablesReference: scope.variablesReference
        });
        const scopedRaw = asArray(asRecord(response.body).variables)
          .map(toVariable)
          .filter((variable): variable is DapVariable =>
            variable !== null &&
            !/^(special variables|function variables|class variables)$/i.test(variable.name)
          );
        for (const raw of scopedRaw) {
          const mapped = mapVariable(raw);
          if (
            this.request.language !== "python" &&
            mapped.variablesReference !== undefined &&
            (mapped.value ?? "").trim().length === 0 &&
            summaryBudget > 0
          ) {
            summaryBudget--;
            mapped.value = await this.fetchBoundedSummary(mapped.variablesReference);
          }
          variables.push(mapped);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.events.emit({
          type: "console",
          data: `[variables] scope="${scope.name}" ref=${scope.variablesReference} error="${msg}"\n`
        });
      }
    }

    if (variables.length === 0 && this.request.language !== "python") {
      const fallback = await this.fetchVariablesViaInfoLocals(frameId);
      variables.push(...fallback);
    }

    this.events.emit({ type: "variables", variables });
  }

  private async fetchBoundedSummary(variablesReference: number): Promise<string> {
    if (!this.dap) {
      return "";
    }

    try {
      const response = await this.dap.request("variables", {
        variablesReference,
        start: 0,
        count: VAR_SUMMARY_MAX_ITEMS + 1
      });
      const children = normalizeChildNames(
        asArray(asRecord(response.body).variables)
          .map(toVariable)
          .filter((variable): variable is DapVariable => variable !== null)
      );
      const hasMore = children.length > VAR_SUMMARY_MAX_ITEMS;
      const shown = children
        .slice(0, VAR_SUMMARY_MAX_ITEMS)
        .map((child) => ({ name: child.name, value: child.value ?? "" }));
      return summarizeChildren(shown, hasMore);
    } catch {
      return "";
    }
  }

  private async expandVariable(variablesReference: number): Promise<void> {
    if (!this.dap || !this.stopped) {
      this.events.emit({ type: "variableChildren", variablesReference, variables: [] });
      return;
    }

    try {
      const response = await this.dap.request("variables", {
        variablesReference,
        start: 0,
        count: VAR_EXPAND_MAX_CHILDREN + 1
      });
      const raw = normalizeChildNames(
        asArray(asRecord(response.body).variables)
          .map(toVariable)
          .filter((variable): variable is DapVariable =>
            variable !== null &&
            !/^(special variables|function variables|class variables)$/i.test(variable.name)
          )
      );
      const truncated = raw.length > VAR_EXPAND_MAX_CHILDREN;
      const variables = raw.slice(0, VAR_EXPAND_MAX_CHILDREN).map(mapVariable);
      if (truncated) {
        variables.push({ name: "…", value: `(only first ${VAR_EXPAND_MAX_CHILDREN} shown)` });
      }
      this.events.emit({ type: "variableChildren", variablesReference, variables });
    } catch (error) {
      this.emitError(error);
      this.events.emit({ type: "variableChildren", variablesReference, variables: [] });
    }
  }

  private async refreshWatches(): Promise<void> {
    if (this.watchExpressions.size === 0) {
      return;
    }

    const seq = ++this.watchRefreshSeq;
    for (const expression of this.watchExpressions) {
      if (seq !== this.watchRefreshSeq || !this.stopped || !this.dap) {
        return;
      }
      await this.evaluateWatch(expression);
    }
  }

  private async fetchVariablesViaInfoLocals(frameId: number): Promise<DebugVariable[]> {
    if (!this.dap) {
      return [];
    }

    const collected: DebugVariable[] = [];
    const seen = new Set<string>();

    for (const expression of ["info args", "info locals"]) {
      try {
        const response = await this.dap.request("evaluate", {
          expression,
          frameId,
          context: "repl"
        });
        const text = asString(asRecord(response.body).result) ?? "";
        for (const variable of parseInfoLocals(text)) {
          if (seen.has(variable.name)) continue;
          seen.add(variable.name);
          collected.push(variable);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.events.emit({
          type: "console",
          data: `[variables] fallback "${expression}" frame=${frameId} error="${msg}"\n`
        });
      }
    }

    return collected;
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

  private async applyBreakpoints(breakpoints: Breakpoint[]): Promise<void> {
    if (!this.dap) {
      return;
    }

    const byFile = new Map<string, number[]>();
    for (const bp of breakpoints) {
      const lines = byFile.get(bp.path) ?? [];
      lines.push(bp.line);
      byFile.set(bp.path, lines);
    }

    // DAP setBreakpoints is replace-all per source: clear files that previously
    // had breakpoints but no longer do by sending them an empty list.
    for (const previous of this.breakpointFiles) {
      if (!byFile.has(previous)) {
        byFile.set(previous, []);
      }
    }

    for (const [file, lines] of byFile) {
      await this.dap.request("setBreakpoints", {
        source: { path: `/workspace/${file}` },
        breakpoints: lines.map((line) => ({ line })),
        sourceModified: false
      });
    }

    this.breakpointFiles = new Set(
      [...byFile.entries()].filter(([, lines]) => lines.length > 0).map(([file]) => file)
    );
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
    await writeFile(path.join(root, "tmp", "program.out"), "", { mode: 0o666 });
    await writeProjectFiles(root, this.request.files, this.request.language);
    await writeFile(path.join(root, "stdin.txt"), this.request.stdin, { mode: 0o600 });
    if (this.request.language === "python") {
      await writeFile(path.join(root, "__debugpy_runner.py"), pythonDebugRunnerSource(), { mode: 0o600 });
    }

    // Docker-gated integration tests run this code on the host (uid 1000) while child
    // debug containers drop ALL caps — so their root has no DAC_OVERRIDE and can only use
    // "other" perms. A 0700/0600 host workspace is therefore unreadable to them. Open the
    // perms only when the test harness asks; production never sets this flag, so the
    // default tight modes above are unchanged.
    if (process.env.DEBUG_TEST_OPEN_WORKSPACE === "1") {
      await chmod(root, 0o777);
      await chmod(path.join(root, "tmp"), 0o777);
      await chmod(path.join(root, "tmp", "program.out"), 0o666);
      for (const file of this.request.files) {
        await chmod(path.join(root, file.path), 0o644);
      }
      await chmod(path.join(root, "stdin.txt"), 0o644);
      if (this.request.language === "python") {
        await chmod(path.join(root, "__debugpy_runner.py"), 0o644);
      }
    }

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

  private async flushProgramOutput(): Promise<void> {
    if (this.programOutputFlushed || !this.workspace) {
      return;
    }

    this.programOutputFlushed = true;
    const file = path.join(this.workspace.containerPath, "tmp", "program.out");
    try {
      const handle = await open(file, "r");
      try {
        const buffer = Buffer.alloc(MAX_OUTPUT_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, MAX_OUTPUT_BYTES, 0);
        if (bytesRead > 0) {
          await this.emitLimitedOutput("stdout", buffer.subarray(0, bytesRead).toString("utf8"));
        }
      } finally {
        await handle.close();
      }
    } catch {
      // file may not exist (program never launched) — nothing to flush
    }
  }

  private async emitLimitedOutput(type: "stdout" | "stderr" | "console", data: string): Promise<void> {
    const bytes = Buffer.from(data);
    if (this.outputBytes >= MAX_OUTPUT_BYTES) {
      this.events.emit({ type: "error", message: "Debug output exceeded the 5MB limit" });
      await this.close(false);
      return;
    }

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


function pythonDebugRunnerSource(): string {
  return [
    "import runpy",
    "import sys",
    "",
    "target = sys.argv[1]",
    "sys.argv = [target, *sys.argv[2:]]",
    "stdin = open('/workspace/stdin.txt', 'r', encoding='utf-8', errors='replace')",
    "try:",
    "    sys.stdin = stdin",
    "    runpy.run_path(target, run_name='__main__')",
    "finally:",
    "    stdin.close()",
    ""
  ].join("\n");
}

export function parseInfoLocals(output: string): DebugVariable[] {
  const variables: DebugVariable[] = [];
  if (!output) return variables;

  const lines = output.split(/\r?\n/);
  let current: { name: string; value: string } | null = null;
  let depth = 0;
  const flush = () => {
    if (!current) return;
    const name = current.name.trim();
    const value = current.value.trim();
    if (name) variables.push({ name, value });
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(No locals\.|No arguments\.|No symbol .* in current context\.)$/.test(trimmed)) continue;

    const match = depth === 0 ? /^\s*([A-Za-z_][\w]*)\s*=\s*(.*)$/.exec(line) : null;
    if (match) {
      flush();
      current = { name: match[1] ?? "", value: match[2] ?? "" };
    } else if (current) {
      current.value += `\n${trimmed}`;
    }

    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  flush();
  return variables;
}

function mapVariable(variable: DapVariable): DebugVariable {
  const ref =
    variable.variablesReference !== undefined && variable.variablesReference > 0
      ? variable.variablesReference
      : undefined;
  return {
    name: variable.name,
    value: boundSummary(variable.value ?? ""),
    variablesReference: ref
  };
}

export function normalizeChildNames<T extends { name: string }>(children: T[]): T[] {
  if (children.length === 0) {
    return children;
  }
  if (!children.every((child) => /^\d+$/.test(child.name))) {
    return children;
  }
  return children.map((child) => ({ ...child, name: `[${child.name}]` }));
}

export function summarizeChildren(children: { name: string; value: string }[], hasMore: boolean): string {
  const isArray = children.length > 0 && children.every((child) => /^\[\d+\]$/.test(child.name));
  const parts = children.map((child) => (isArray ? child.value : `${child.name} = ${child.value}`));
  if (hasMore) {
    parts.push("…");
  }
  return boundSummary(`{${parts.join(", ")}}`);
}

export function boundSummary(value: string): string {
  if (value.length <= VAR_SUMMARY_MAX_CHARS) {
    return value;
  }
  return `${value.slice(0, VAR_SUMMARY_MAX_CHARS - 1)}…`;
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
