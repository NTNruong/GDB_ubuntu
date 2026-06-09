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
