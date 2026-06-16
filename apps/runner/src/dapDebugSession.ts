import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import {
  MAX_OUTPUT_BYTES,
  resolveToolchainVersion,
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
  // Startup-failure detection (ISSUE-058): a debug container that exits before the
  // adapter ever produced a DAP message — and before `ready` — is a startup failure
  // (e.g. the Go socat/Delve bridge never came up), not a clean run. Surface an error
  // instead of a silent exit. gdb/Delve always emit an entry stop before exiting, so a
  // legitimate run-to-completion (ISSUE-041) always sets adapterSpoke first.
  private adapterSpoke = false;
  private startupComplete = false;
  private outputBytes = 0;
  // Incremental capture of the inferior's stdout/stderr (redirected to
  // /workspace/tmp/program.out by the C/C++ debug exec-wrapper). We track how many
  // bytes were already streamed and pump the new tail at every stop so printf output
  // appears as the user steps — not only once at exit. `pumpChain` serializes reads
  // because DAP events are dispatched without awaiting (handleDapEvent is fire-and-
  // forget), so two pumps could otherwise read the same offset concurrently.
  private programOutputOffset = 0;
  private pumpChain: Promise<void> = Promise.resolve();
  private exitEmitted = false;
  private pendingExitCode: number | null = null;
  private closed = false;
  private readonly watchExpressions = new Set<string>();
  private breakpointFiles = new Set<string>();
  private watchRefreshSeq = 0;
  // Flips at the compile:done phase marker; after it, a Java debug container's raw stderr is
  // pure jdt.ls/java-debug/bridge infra noise (ISSUE-061) — gated out of the user console.
  private compileFinished = false;
  private readonly verbose = process.env.DEBUG_VERBOSE === "1";
  // One-time gdb/debugpy startup handshake under a loaded (rootless) host can
  // exceed the 10s steady-state DAP request timeout; give startup its own,
  // larger budget. Interactive requests keep the default. (ISSUE-041)
  private readonly startupTimeoutMs = Number.parseInt(process.env.DAP_STARTUP_TIMEOUT_MS ?? "30000", 10);

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

    // Java debug picks the JDK from JAVA_VERSION (like the run path does in
    // dockerRunner) — for other languages resolveToolchainVersion returns undefined.
    const toolchainVersion = resolveToolchainVersion(this.request.language, this.request.toolchainVersion);
    // Java debug runs TWO JVMs (jdt.ls + the debuggee), each with many threads; the
    // cgroup pids controller counts threads as tasks, so 128 is too low. Give Java a
    // larger budget; other languages keep the tight default.
    const pidsLimit = this.request.language === "java" ? 512 : 128;
    // Java debug cold-starts jdt.ls (OSGi) whose ServiceReady is CPU-bound on workspace
    // import; the tight 1-CPU/1-GiB run budget makes it take ~20s. Give the Java debug
    // container a larger CPU/memory budget (other languages keep the tight defaults).
    const isJava = this.request.language === "java";
    const nanoCpus = isJava ? this.config.debugJavaNanoCpus : this.config.nanoCpus;
    const memoryBytes = isJava ? this.config.debugJavaMemoryBytes : this.config.memoryBytes;

    this.container = await withTimeout(
      this.docker.createContainer({
        Image: imageForLanguage(this.request.language, this.config),
        Cmd: commandForLanguage(this.request.language, this.request.argv),
        WorkingDir: "/workspace",
        Env: toolchainVersion ? [`JAVA_VERSION=${toolchainVersion}`] : [],
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
          Memory: memoryBytes,
          MemorySwap: memoryBytes,
          NanoCpus: nanoCpus,
          NetworkMode: "none",
          PidsLimit: pidsLimit,
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
        // Drop Java debugger infra noise (jdt.ls/java-debug/bridge) once compilation is done;
        // the user's program output arrives via DAP `output` events, not this stream. Returning
        // early also keeps the noise off the 5MB output budget. (ISSUE-061)
        if (shouldSuppressDebuggerStderr(this.request.language, this.compileFinished, this.verbose)) {
          return;
        }
        void this.emitLimitedOutput("stderr", data);
      },
      (marker) => {
        if (marker.phase === "compile") {
          this.events.emit({ type: "compile", status: marker.status });
          if (marker.status === "done") {
            this.compileFinished = true;
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
      this.adapterSpoke = true;
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
      // Container died before the adapter ever spoke and before `ready`: the debugger
      // failed to launch (e.g. the Delve/socat bridge never came up). Report it as an
      // error rather than a silent clean exit. (ISSUE-058)
      if (!this.startupComplete && !this.adapterSpoke && !this.exitEmitted) {
        this.events.emit({
          type: "error",
          message: "Debug adapter exited during startup before it was ready (the debugger failed to launch)"
        });
      }
      this.emitExit(typeof result.StatusCode === "number" ? result.StatusCode : this.pendingExitCode, false);
      void this.close(false);
    });

    try {
      await this.initializeDap(compileDone, firstAdapterEvent);
    } catch (error) {
      // If the program already finished during the startup handshake (a very
      // short program that ran to exit), the exit path has already reported the
      // result — don't surface a spurious startup error on top of it. (ISSUE-041)
      if (this.exitEmitted || this.closed) {
        return;
      }
      throw error;
    }
    this.startupComplete = true;
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
    await this.pumpProgramOutput();
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

    const startup = this.startupTimeoutMs;

    await this.startupStep("initialize", () =>
      this.dap!.request(
        "initialize",
        {
          clientID: "gdb-ubuntu-runner",
          clientName: "GDB Ubuntu Runner",
          adapterID:
            this.request.language === "python"
              ? "debugpy"
              : this.request.language === "go"
                ? "go"
                : this.request.language === "java"
                  ? "java"
                  : "gdb",
          pathFormat: "path",
          linesStartAt1: true,
          columnsStartAt1: true,
          supportsRunInTerminalRequest: false,
          supportsVariableType: false
        },
        startup
      )
    );

    const connect = this.dap.request("launch", this.attachArguments(), startup);
    void connect.catch(() => {}); // prevent unhandled rejection if waitForInitialized throws first
    await this.startupStep("waitForInitialized", () => this.waitForInitialized(startup));
    await this.startupStep("setBreakpoints", () => this.applyBreakpoints(this.request.breakpoints, startup));
    await this.startupStep("configurationDone", () =>
      this.dap!.request("configurationDone", undefined, startup).then(
        () => undefined,
        (error: unknown) => {
          if (this.request.language !== "python" && error instanceof Error && error.message === "notStopped") {
            return;
          }
          throw error;
        }
      )
    );
    await this.startupStep("launch", () =>
      connect.then(
        () => undefined,
        (error: unknown) => {
          throw error instanceof Error ? error : new Error("DAP connect failed");
        }
      )
    );
  }

  /** Rethrow a startup-handshake failure tagged with the exact step (ISSUE-041). */
  private async startupStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`debug startup failed [${label}]: ${message}`, { cause: error });
    }
  }

  private attachArguments(): Record<string, unknown> {
    return launchArgumentsFor(this.request);
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
    if (this.request.language === "go") {
      // Delve starts only after the build; give it a moment to bind the loopback DAP
      // port and let the in-container socat bridge connect before the handshake.
      await delay(1_000);
      return;
    }
    if (this.request.language === "java") {
      // The entrypoint must boot jdt.ls, import /workspace, run the startDebugSession
      // command, then bridge the java-debug DAP port with socat — far slower than gdb.
      // Give it a generous, tunable budget before the DAP handshake.
      await delay(Number.parseInt(process.env.DAP_JAVA_STARTUP_MS ?? "8000", 10));
      return;
    }
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

      if (this.autoContinueOnInitialStop) {
        this.autoContinueOnInitialStop = false;
        // Delve's stopOnEntry stop sits in the Go runtime before the main goroutine's
        // stack exists, so stackTrace there fails with "Unable to produce stack trace"
        // (ISSUE-058). An unframeable initial stop IS the entry stop by definition, so
        // fall through to the re-apply-breakpoints + continue path below instead of
        // letting the throw abort the handler (which left the inferior paused → no
        // breakpoint stop → timeout). gdb/debugpy/java-debug produce frames at entry.
        const initialFrames = await this.fetchFrames(threadId).catch((error) => {
          if (this.verbose) {
            this.events.emit({
              type: "console",
              data: `[entry] stackTrace unavailable at initial stop: ${error instanceof Error ? error.message : String(error)}\n`
            });
          }
          return [] as DapStackFrame[];
        });
        // The first stop is the entry stop (stopAtBeginningOfMainSubprogram for
        // C/C++, or the debugpy bootstrap for Python) unless it already landed on
        // a user breakpoint. Decide by LOCATION, not reason: gdb reports the entry
        // stop as a temporary "breakpoint". Auto-continue past a non-user-breakpoint
        // entry stop so the run proceeds with the user breakpoints installed. (ISSUE-041)
        if (!this.isAtUserBreakpoint(initialFrames[0])) {
          if (this.request.language !== "python") {
            // Re-apply user breakpoints while the inferior is provably paused before
            // any user code: setBreakpoints is replace-all/idempotent, and doing it
            // here is correct regardless of how gdb sequences launch vs
            // configurationDone — the remaining startup free-run window. (ISSUE-041)
            await this.applyBreakpoints(this.request.breakpoints).catch((error) => this.emitError(error));
          }
          this.stopped = false;
          await this.dap?.request("continue", { threadId }).catch((error) => this.emitError(error));
          this.events.emit({ type: "running" });
          return;
        }
        this.stopped = true;
        await this.refreshStackAndVariables(threadId, reason, initialFrames);
        return;
      }

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
      await this.pumpProgramOutput();
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

  /** True if the frame sits on one of the user's requested breakpoints (basename + line). */
  private isAtUserBreakpoint(frame: DapStackFrame | undefined): boolean {
    return frameMatchesBreakpoint(frame, this.request.breakpoints);
  }

  private async refreshStackAndVariables(
    threadId: number,
    reason: string | undefined,
    prefetchedFrames?: DapStackFrame[]
  ): Promise<void> {
    if (!this.dap) {
      return;
    }

    // Stream inferior stdout produced since the previous stop so program output shows up
    // as the user steps. C/C++/Rust use the gdb exec-wrapper → program.out file; Python/Go
    // deliver output via DAP `output` events instead. (step-time output)
    if (this.request.language === "c" || this.request.language === "cpp" || this.request.language === "rust") {
      await this.pumpProgramOutput();
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

  private async applyBreakpoints(breakpoints: Breakpoint[], timeoutMs?: number): Promise<void> {
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
      await this.dap.request(
        "setBreakpoints",
        {
          source: { path: `/workspace/${file}` },
          breakpoints: lines.map((line) => ({ line })),
          sourceModified: false
        },
        timeoutMs
      );
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

  /**
   * Stream any new bytes appended to program.out since the last pump. Safe to call
   * repeatedly: at every stop (so output appears while stepping) and at exit/close
   * (to drain the final tail). Reads are serialized through `pumpChain` so concurrent
   * DAP events can't read the same offset twice.
   */
  private pumpProgramOutput(): Promise<void> {
    this.pumpChain = this.pumpChain.then(() => this.drainProgramOutput());
    return this.pumpChain;
  }

  private async drainProgramOutput(): Promise<void> {
    if (!this.workspace) {
      return;
    }

    const file = path.join(this.workspace.containerPath, "tmp", "program.out");
    try {
      const handle = await open(file, "r");
      try {
        const { size } = await handle.stat();
        const available = size - this.programOutputOffset;
        if (available <= 0) {
          return;
        }
        const length = Math.min(available, MAX_OUTPUT_BYTES);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, this.programOutputOffset);
        if (bytesRead > 0) {
          this.programOutputOffset += bytesRead;
          await this.emitLimitedOutput("stdout", buffer.subarray(0, bytesRead).toString("utf8"));
        }
      } finally {
        await handle.close();
      }
    } catch {
      // file may not exist yet (program never launched) or was removed on close
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

/**
 * DAP `launch` request arguments per language. Exported so unit tests can pin the
 * exact parameter names — gdb's DAP silently ignores unknown launch parameters
 * (they land in the handler's `**extra`), so a misnamed flag is an invisible no-op.
 */
/**
 * java-debug deserializes launch `args` as a single command-line STRING (unlike gdb/
 * debugpy/Delve, which take a string[]); it tokenizes the string on whitespace, honoring
 * double-quoted spans. Wrap any token with whitespace (or an empty token) in double quotes;
 * leave bare tokens as-is. (Tokens containing embedded double quotes/newlines are a known
 * edge this parser cannot round-trip — out of scope for judging argv.)
 */
function javaDebugArgsString(argv: readonly string[]): string {
  return argv.map((a) => (a === "" || /\s/.test(a) ? `"${a}"` : a)).join(" ");
}

export function launchArgumentsFor(
  request: Pick<DebugRequest, "language" | "argv" | "toolchainVersion">
): Record<string, unknown> {
  if (request.language === "python") {
    return {
      name: "Python",
      type: "python",
      request: "launch",
      program: "/workspace/__debugpy_runner.py",
      args: ["/workspace/main.py", ...request.argv],
      cwd: "/workspace",
      console: "internalConsole",
      // -u: unbuffered stdout/stderr so print() output reaches the DAP output events (and
      // the client) as the user steps, instead of sitting in the block buffer until exit.
      python: ["python3", "-I", "-u"],
      justMyCode: false,
      subProcess: false,
      redirectOutput: true
    };
  }

  if (request.language === "go") {
    // Delve DAP launches a prebuilt binary (mode "exec"); stopOnEntry halts so user
    // breakpoints install before any code runs (the entry stop auto-continues).
    return {
      name: "Go",
      type: "go",
      request: "launch",
      mode: "exec",
      program: "/exec/program",
      args: request.argv,
      cwd: "/workspace",
      stopOnEntry: true
    };
  }

  if (request.language === "java") {
    // java-debug launch. jdt.ls itself runs under Java >=21 (the entrypoint pins
    // /opt/java/21), but the debuggee runs under the requested JDK via `javaExec`.
    // `_DebugMain` redirects System.in from stdin.txt then calls Main.main, so the
    // debuggee reads stdin and breakpoints in Main.java still resolve (sourcePaths).
    // stopOnEntry installs breakpoints before user code runs (the entry stop
    // auto-continues, like Go/gdb).
    const version = resolveToolchainVersion("java", request.toolchainVersion) ?? "21";
    return {
      name: "Java",
      type: "java",
      request: "launch",
      mainClass: "_DebugMain",
      classPaths: ["/workspace/classes", "/opt/runner"],
      sourcePaths: ["/workspace"],
      javaExec: `/opt/java/${version}/bin/java`,
      // Unlike gdb/debugpy/Delve (which take a string[]), java-debug deserializes `args`
      // as a single command-line STRING and tokenizes it itself — sending an array makes
      // it reject the launch (`Expected STRING but was BEGIN_ARRAY at path $.args`,
      // ISSUE-059). Omit `args` entirely when there are none.
      ...(request.argv.length > 0 ? { args: javaDebugArgsString(request.argv) } : {}),
      cwd: "/workspace",
      console: "internalConsole",
      stopOnEntry: true
    };
  }

  return {
    name: request.language === "c" ? "C" : request.language === "rust" ? "Rust" : "C++",
    type: "gdb",
    program: "/exec/program",
    args: request.argv,
    cwd: "/workspace",
    // Stop at the beginning of main (gdb `start` semantics) so user breakpoints
    // are installed into the inferior before any user code runs. Without this, a
    // fast program can run to completion before the breakpoint binds, which
    // surfaced as an intermittent "[configurationDone]: DAP session closed"
    // startup error. NOTE: the parameter name must be exactly
    // `stopAtBeginningOfMainSubprogram` (GDB manual, DAP launch request, GDB ≥ 14)
    // — `stopAtEntry` is the VS Code cppdbg name and gdb ignores it silently.
    // The initial entry stop is auto-continued by the stopped handler. (ISSUE-041)
    stopAtBeginningOfMainSubprogram: true
  };
}

/**
 * Java debug floods the container's raw stderr with jdt.ls/java-debug/bridge startup logs once
 * compilation is done (ISSUE-061); the user's own program output comes via DAP `output` events,
 * not this stream. Hide that infra noise from the user console unless DEBUG_VERBOSE is set.
 * Compile-phase stderr (javac errors, before compile:done) and non-Java languages are unaffected.
 */
export function shouldSuppressDebuggerStderr(
  language: Language,
  compileFinished: boolean,
  verbose: boolean
): boolean {
  return language === "java" && compileFinished && !verbose;
}

/**
 * True if a stack frame sits on one of the user's requested breakpoints, matched
 * by file basename + line (frame source paths are absolute `/workspace/<file>`).
 * Used to decide whether an initial stop is the entry stop (auto-continue) or an
 * actual user breakpoint (stop), independent of the adapter's `reason` string.
 */
export function frameMatchesBreakpoint(
  frame: { source?: { path?: string; name?: string }; line?: number } | undefined,
  breakpoints: readonly { path: string; line: number }[]
): boolean {
  if (!frame || frame.line === undefined) {
    return false;
  }
  const src = frame.source?.path ?? frame.source?.name ?? "";
  const base = src.replace(/^.*[\\/]/, "");
  return breakpoints.some((bp) => bp.path === base && bp.line === frame.line);
}

function commandForLanguage(language: Language, argv: string[]): string[] {
  if (language === "c") {
    return ["/usr/local/bin/debug-dap-c", ...argv];
  }

  if (language === "cpp") {
    return ["/usr/local/bin/debug-dap-cpp", ...argv];
  }

  if (language === "rust") {
    return ["/usr/local/bin/debug-dap-rust", ...argv];
  }

  if (language === "go") {
    return ["/usr/local/bin/debug-dap-go", ...argv];
  }

  if (language === "java") {
    return ["/usr/local/bin/debug-dap-java", ...argv];
  }

  return ["/usr/local/bin/debug-dap-python", ...argv];
}

function imageForLanguage(language: Language, config: RunnerConfig): string {
  if (language === "python") {
    return config.pythonImage;
  }
  if (language === "rust") {
    return config.rustImage;
  }
  if (language === "go") {
    return config.goImage;
  }
  if (language === "java") {
    return config.javaImage;
  }
  return config.cppImage;
}


function pythonDebugRunnerSource(): string {
  return [
    "import runpy",
    "import sys",
    "",
    "target = sys.argv[1]",
    "sys.argv = [target, *sys.argv[2:]]",
    // Restore /workspace on sys.path so the debuggee can import sibling modules;
    // launched under `python3 -I`, which otherwise strips the script dir (ISSUE-051).
    "sys.path.insert(0, '/workspace')",
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
