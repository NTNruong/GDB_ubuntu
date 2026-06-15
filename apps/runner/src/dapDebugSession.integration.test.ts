import { beforeAll, describe, expect, it } from "vitest";
import type { DebugEvent, DebugRequest } from "@internal/shared";
import { readConfig } from "./config.js";
import { DapDebugSession } from "./dapDebugSession.js";
import { DockerRunner } from "./dockerRunner.js";
import { EventBuffer } from "./eventBuffer.js";

const maybeDescribe = process.env.RUN_DOCKER_TESTS === "1" ? describe : describe.skip;

const PER_TEST_TIMEOUT_MS = 45_000;
const INTERNAL_WAIT_MS = 25_000;
const CLEANUP_TIMEOUT_MS = 10_000;

maybeDescribe("DapDebugSession integration", () => {
  // This suite runs on the host (uid 1000); child debug containers drop ALL caps, so make
  // the per-session workspace world-accessible (createWorkspace honours this flag). Without
  // it, the capability-stripped container root cannot read main.* / stdin.txt and the
  // compile / adapter-start steps time out (ISSUE-016).
  beforeAll(() => {
    process.env.DEBUG_TEST_OPEN_WORKSPACE = "1";
  });

  const config = {
    ...readConfig(),
    debugMaxMs: 30_000,
    debugIdleMs: 30_000
  };

  it("stops C++ at a breakpoint", { timeout: PER_TEST_TIMEOUT_MS }, async () => {
    const events = await debugUntilStopped({
      language: "cpp",
      files: [{ path: "main.cpp", content: '#include <iostream>\nint main(){\n  int x = 41;\n  x++;\n  std::cout << x << "\\n";\n  return 0;\n}' }],
      stdin: "",
      argv: [],
      breakpoints: [{ path: "main.cpp", line: 4 }],
      clientId: `test-cpp-${Date.now()}`
    });

    expect(events.some((event) => event.type === "compile" && event.status === "done")).toBe(true);
    expect(events.find((event): event is Extract<DebugEvent, { type: "stopped" }> => event.type === "stopped")?.line).toBe(4);
    expect(events.some((event) => event.type === "variables")).toBe(true);
  });

  it("populates C++ Variables with stdin-derived locals (ISSUE-006 regression)", { timeout: PER_TEST_TIMEOUT_MS }, async () => {
    const events = await debugUntilStopped({
      language: "cpp",
      files: [{
        path: "main.cpp",
        content:
          '#include <iostream>\nint main(){\n  int n;\n  std::cin >> n;\n  int result = n * n;\n  std::cout << result << "\\n";\n  return 0;\n}'
      }],
      stdin: "6\n",
      argv: [],
      breakpoints: [{ path: "main.cpp", line: 6 }],
      clientId: `test-cpp-vars-${Date.now()}`
    });

    const lastVariables = [...events].reverse().find(
      (event): event is Extract<DebugEvent, { type: "variables" }> => event.type === "variables"
    );
    expect(lastVariables, "expected a variables event").toBeDefined();
    const vars = lastVariables!.variables;
    expect(vars.find((v) => v.name === "n")?.value).toBe("6");
    expect(vars.find((v) => v.name === "result")?.value).toBe("36");
  });

  it("populates C Variables with stdin-derived locals (ISSUE-006 regression)", { timeout: PER_TEST_TIMEOUT_MS }, async () => {
    const events = await debugUntilStopped({
      language: "c",
      files: [{
        path: "main.c",
        content:
          '#include <stdio.h>\nint main(){\n  int n;\n  if (scanf("%d", &n) != 1) return 1;\n  int result = n * n;\n  printf("%d\\n", result);\n  return 0;\n}'
      }],
      stdin: "6\n",
      argv: [],
      breakpoints: [{ path: "main.c", line: 7 }],
      clientId: `test-c-vars-${Date.now()}`
    });

    const lastVariables = [...events].reverse().find(
      (event): event is Extract<DebugEvent, { type: "variables" }> => event.type === "variables"
    );
    expect(lastVariables, "expected a variables event").toBeDefined();
    const vars = lastVariables!.variables;
    expect(vars.find((v) => v.name === "n")?.value).toBe("6");
    expect(vars.find((v) => v.name === "result")?.value).toBe("36");
  });

  // ISSUE-060 regression: unbuffering the inferior must NOT break the stop, and program
  // stdout printed before the breakpoint must reach the client BEFORE exit (proves both
  // the LD_PRELOAD unbuffer and the incremental pump — a buffered fallback would fail the
  // stdout assertion even though the stop assertion still passes).
  it("streams C stdout before exit and still stops (ISSUE-060)", { timeout: PER_TEST_TIMEOUT_MS }, async () => {
    const events = await debugUntilStopped({
      language: "c",
      files: [{
        path: "main.c",
        content:
          '#include <stdio.h>\nint main(){\n  printf("hello\\n");\n  int x = 1;\n  x = x + 1;\n  return 0;\n}'
      }],
      stdin: "",
      argv: [],
      breakpoints: [{ path: "main.c", line: 5 }],
      clientId: `test-c-unbuffer-${Date.now()}`
    });

    expect(events.find((event): event is Extract<DebugEvent, { type: "stopped" }> => event.type === "stopped")?.line).toBe(5);
    expect(events.some((event) => event.type === "stdout" && event.data.includes("hello"))).toBe(true);
  });

  it("streams C++ stdout before exit and still stops (ISSUE-060)", { timeout: PER_TEST_TIMEOUT_MS }, async () => {
    const events = await debugUntilStopped({
      language: "cpp",
      files: [{
        path: "main.cpp",
        content:
          '#include <iostream>\nint main(){\n  std::cout << "hello\\n";\n  int x = 1;\n  x = x + 1;\n  return 0;\n}'
      }],
      stdin: "",
      argv: [],
      breakpoints: [{ path: "main.cpp", line: 5 }],
      clientId: `test-cpp-unbuffer-${Date.now()}`
    });

    expect(events.find((event): event is Extract<DebugEvent, { type: "stopped" }> => event.type === "stopped")?.line).toBe(5);
    expect(events.some((event) => event.type === "stdout" && event.data.includes("hello"))).toBe(true);
  });

  it("stops Python at a breakpoint", { timeout: PER_TEST_TIMEOUT_MS }, async () => {
    const events = await debugUntilStopped({
      language: "python",
      files: [{ path: "main.py", content: 'name = input().strip()\nvalue = len(name)\nprint(value)' }],
      stdin: "ada\n",
      argv: [],
      breakpoints: [{ path: "main.py", line: 2 }],
      clientId: `test-python-${Date.now()}`
    });

    expect(events.find((event): event is Extract<DebugEvent, { type: "stopped" }> => event.type === "stopped")?.line).toBe(2);
    expect(events.some((event) => event.type === "variables")).toBe(true);
  });

  it("imports sibling modules in a python folder debug (ISSUE-051)", { timeout: PER_TEST_TIMEOUT_MS }, async () => {
    const events = await debugUntilStopped({
      language: "python",
      files: [
        { path: "main.py", content: "from helper import value\nresult = value()\nprint(result)" },
        { path: "helper.py", content: "def value():\n    return 88" }
      ],
      stdin: "",
      argv: [],
      breakpoints: [{ path: "main.py", line: 3 }],
      clientId: `test-python-import-${Date.now()}`
    });

    expect(events.find((event): event is Extract<DebugEvent, { type: "stopped" }> => event.type === "stopped")?.line).toBe(3);
    const lastVariables = [...events].reverse().find(
      (event): event is Extract<DebugEvent, { type: "variables" }> => event.type === "variables"
    );
    expect(lastVariables?.variables.find((variable) => variable.name === "result")?.value).toBe("88");
  });

  // Java debug end-to-end (jdt.ls + java-debug): stop at a breakpoint and read locals
  // derived from stdin. Proves the whole bridge works (LSP handshake → DAP port → relay,
  // _DebugMain stdin redirect, source lookup). jdt.ls boots slowly, so this may need a
  // larger INTERNAL_WAIT_MS than the gdb/debugpy cases when validated on the host.
  it("populates Java Variables with stdin-derived locals", { timeout: PER_TEST_TIMEOUT_MS }, async () => {
    const events = await debugUntilStopped({
      language: "java",
      files: [{
        path: "Main.java",
        content:
          "import java.util.Scanner;\npublic class Main {\n  public static void main(String[] args) {\n    Scanner sc = new Scanner(System.in);\n    int n = sc.nextInt();\n    int result = n * n;\n    System.out.println(result);\n  }\n}"
      }],
      stdin: "6\n",
      argv: [],
      breakpoints: [{ path: "Main.java", line: 7 }],
      clientId: `test-java-${Date.now()}`
    });

    expect(events.find((event): event is Extract<DebugEvent, { type: "stopped" }> => event.type === "stopped")?.line).toBe(7);
    const lastVariables = [...events].reverse().find(
      (event): event is Extract<DebugEvent, { type: "variables" }> => event.type === "variables"
    );
    expect(lastVariables, "expected a variables event").toBeDefined();
    const vars = lastVariables!.variables;
    expect(vars.find((v) => v.name === "n")?.value).toBe("6");
    expect(vars.find((v) => v.name === "result")?.value).toBe("36");
  });

  // Step-time output (Rust): breakpoint ON the println! line, step over it, and the
  // program output must reach the client BETWEEN that stop and the next — proving the
  // gdb→program.out pump fires per step. This is a blocker for the Rust line-buffering
  // assumption: if Rust didn't flush to program.out while stopped, the stdout never lands
  // between the two stops.
  it("streams Rust stdout right after stepping over println! (step-time)", { timeout: PER_TEST_TIMEOUT_MS }, async () => {
    const events = await debugAcrossStepOver({
      language: "rust",
      files: [{
        path: "main.rs",
        content: 'fn main() {\n    let x = 1;\n    println!("hello");\n    let y = x + 1;\n    println!("{}", y);\n}'
      }],
      stdin: "",
      argv: [],
      breakpoints: [{ path: "main.rs", line: 3 }],
      clientId: `test-rust-step-${Date.now()}`
    });
    assertStdoutBetweenStops(events, "hello");
  });

  // Step-time output (Python): breakpoint ON the print() line, step over it, and the
  // output must appear between the two stops — proving `-u` keeps the debuggee unbuffered
  // so debugpy forwards it promptly via DAP output events.
  it("streams Python stdout right after stepping over print() (step-time)", { timeout: PER_TEST_TIMEOUT_MS }, async () => {
    const events = await debugAcrossStepOver({
      language: "python",
      files: [{ path: "main.py", content: 'x = 1\nprint("hello")\ny = x + 1\nprint(y)' }],
      stdin: "",
      argv: [],
      breakpoints: [{ path: "main.py", line: 2 }],
      clientId: `test-python-step-${Date.now()}`
    });
    assertStdoutBetweenStops(events, "hello");
  });

  async function debugUntilStopped(request: DebugRequest): Promise<DebugEvent[]> {
    const runner = new DockerRunner(config);
    const events = new EventBuffer<DebugEvent>();
    const collected: DebugEvent[] = [];
    const stopped = new Promise<void>((resolve, reject) => {
      let sawStopped = false;
      let sawVariables = false;
      const timeout = setTimeout(() => {
        const summary = collected.length === 0
          ? "(no events)"
          : collected.map(summarizeEvent).join(" | ");
        reject(new Error(`Timed out waiting for breakpoint variables after ${INTERNAL_WAIT_MS}ms. Collected events: ${summary}`));
      }, INTERNAL_WAIT_MS);
      events.subscribe((event) => {
        collected.push(event);
        if (event.type === "stopped") {
          sawStopped = true;
        }
        if (event.type === "variables") {
          sawVariables = true;
        }
        if (sawStopped && sawVariables) {
          clearTimeout(timeout);
          resolve();
        }
        if (event.type === "error") {
          clearTimeout(timeout);
          const summary = collected.length === 0
            ? "(no events)"
            : collected.map(summarizeEvent).join(" | ");
          reject(new Error(`Session emitted error: ${event.message}. Collected events: ${summary}`));
        }
      });
    });
    const session = new DapDebugSession(runner.docker, config, request, events, () => undefined, () => undefined);

    try {
      await session.start();
      await stopped;
      return collected;
    } catch (error) {
      // The real C/C++ failure paths surface as session.start() rejections from
      // dap.close() / failAll() (not session-emitted "error" events), so attach the
      // collected events here too — otherwise QC sees only the bare "DAP session closed".
      const summary = collected.length === 0
        ? "(no events)"
        : collected.map(summarizeEvent).join(" | ");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}. Collected events: ${summary}`);
    } finally {
      // Race close with a hard cap so a hung close() never leaves vitest holding the worker.
      await Promise.race([
        session.close(false),
        new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS))
      ]);
    }
  }

  // Start a session, wait for the first user stop (breakpoint), issue one stepOver, and
  // collect events through the second stop. Lets a test assert what the inferior printed
  // as a direct result of stepping over a print line.
  async function debugAcrossStepOver(request: DebugRequest): Promise<DebugEvent[]> {
    const runner = new DockerRunner(config);
    const events = new EventBuffer<DebugEvent>();
    const collected: DebugEvent[] = [];
    const session = new DapDebugSession(runner.docker, config, request, events, () => undefined, () => undefined);
    const done = new Promise<void>((resolve, reject) => {
      let stoppedCount = 0;
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out across stepOver after ${INTERNAL_WAIT_MS}ms. Collected events: ${collected.map(summarizeEvent).join(" | ")}`));
      }, INTERNAL_WAIT_MS);
      events.subscribe((event) => {
        collected.push(event);
        if (event.type === "stopped") {
          stoppedCount += 1;
          if (stoppedCount === 1) {
            session.handleCommand({ type: "stepOver" });
          } else if (stoppedCount >= 2) {
            clearTimeout(timeout);
            resolve();
          }
        }
        if (event.type === "error") {
          clearTimeout(timeout);
          reject(new Error(`Session emitted error: ${event.message}. Collected events: ${collected.map(summarizeEvent).join(" | ")}`));
        }
        if (event.type === "exit") {
          // Exited before a second stop — resolve and let the assertion report what landed.
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    try {
      await session.start();
      await done;
      return collected;
    } finally {
      await Promise.race([
        session.close(false),
        new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS))
      ]);
    }
  }

  // Assert `needle` appears on a stdout event positioned strictly between the first and
  // second stop — i.e. produced by the stepOver, not merely present somewhere in the run.
  function assertStdoutBetweenStops(collected: DebugEvent[], needle: string): void {
    const stops = collected
      .map((event, index) => ({ event, index }))
      .filter((entry) => entry.event.type === "stopped");
    expect(stops.length, `expected two stops (breakpoint + after stepOver); collected: ${collected.map(summarizeEvent).join(" | ")}`).toBeGreaterThanOrEqual(2);
    const idx1 = stops[0]!.index;
    const idx2 = stops[1]!.index;
    const out = collected.findIndex(
      (event, index) => index > idx1 && index < idx2 && event.type === "stdout" && event.data.includes(needle)
    );
    expect(out, `expected "${needle}" stdout between the two stops; collected: ${collected.map(summarizeEvent).join(" | ")}`).toBeGreaterThan(-1);
  }

  function summarizeEvent(event: DebugEvent): string {
    if (event.type === "stopped") {
      return `stopped@${event.line ?? "?"}(${event.reason ?? "?"})`;
    }
    if (event.type === "compile") {
      return `compile:${event.status}`;
    }
    if (event.type === "variables") {
      return `variables(${event.variables.length})`;
    }
    if (event.type === "stdout" || event.type === "stderr" || event.type === "console") {
      const data = event.data.length > 300 ? `${event.data.slice(0, 300)}…` : event.data;
      return `${event.type}:${JSON.stringify(data)}`;
    }
    if (event.type === "exit") {
      return `exit:code=${event.code ?? "?"}${event.timedOut ? ":timedOut" : ""}`;
    }
    if (event.type === "error") {
      return `error:${event.message}`;
    }
    return event.type;
  }
});
