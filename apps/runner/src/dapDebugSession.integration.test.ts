import { describe, expect, it } from "vitest";
import type { DebugEvent, DebugRequest } from "@internal/shared";
import { readConfig } from "./config.js";
import { DapDebugSession } from "./dapDebugSession.js";
import { DockerRunner } from "./dockerRunner.js";
import { EventBuffer } from "./eventBuffer.js";

const maybeDescribe = process.env.RUN_DOCKER_TESTS === "1" ? describe : describe.skip;

maybeDescribe("DapDebugSession integration", () => {
  const config = {
    ...readConfig(),
    debugMaxMs: 15_000,
    debugIdleMs: 15_000
  };

  it("stops C++ at a breakpoint", async () => {
    const events = await debugUntilStopped({
      language: "cpp",
      source: '#include <iostream>\nint main(){\n  int x = 41;\n  x++;\n  std::cout << x << "\\n";\n  return 0;\n}',
      stdin: "",
      argv: [],
      breakpoints: [4],
      clientId: "test-cpp"
    });

    expect(events.some((event) => event.type === "compile" && event.status === "done")).toBe(true);
    expect(events.find((event): event is Extract<DebugEvent, { type: "stopped" }> => event.type === "stopped")?.line).toBe(4);
    expect(events.some((event) => event.type === "variables")).toBe(true);
  });

  it("populates C++ Variables with stdin-derived locals (ISSUE-006 regression)", async () => {
    const events = await debugUntilStopped({
      language: "cpp",
      source:
        '#include <iostream>\nint main(){\n  int n;\n  std::cin >> n;\n  int result = n * n;\n  std::cout << result << "\\n";\n  return 0;\n}',
      stdin: "6\n",
      argv: [],
      breakpoints: [6],
      clientId: "test-cpp-vars"
    });

    const lastVariables = [...events].reverse().find(
      (event): event is Extract<DebugEvent, { type: "variables" }> => event.type === "variables"
    );
    expect(lastVariables, "expected a variables event").toBeDefined();
    const vars = lastVariables!.variables;
    expect(vars.find((v) => v.name === "n")?.value).toBe("6");
    expect(vars.find((v) => v.name === "result")?.value).toBe("36");
  });

  it("populates C Variables with stdin-derived locals (ISSUE-006 regression)", async () => {
    const events = await debugUntilStopped({
      language: "c",
      source:
        '#include <stdio.h>\nint main(){\n  int n;\n  if (scanf("%d", &n) != 1) return 1;\n  int result = n * n;\n  printf("%d\\n", result);\n  return 0;\n}',
      stdin: "6\n",
      argv: [],
      breakpoints: [7],
      clientId: "test-c-vars"
    });

    const lastVariables = [...events].reverse().find(
      (event): event is Extract<DebugEvent, { type: "variables" }> => event.type === "variables"
    );
    expect(lastVariables, "expected a variables event").toBeDefined();
    const vars = lastVariables!.variables;
    expect(vars.find((v) => v.name === "n")?.value).toBe("6");
    expect(vars.find((v) => v.name === "result")?.value).toBe("36");
  });

  it("stops Python at a breakpoint", async () => {
    const events = await debugUntilStopped({
      language: "python",
      source: 'name = input().strip()\nvalue = len(name)\nprint(value)',
      stdin: "ada\n",
      argv: [],
      breakpoints: [2],
      clientId: "test-python"
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
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for breakpoint variables")), 12_000);
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
          reject(new Error(event.message));
        }
      });
    });
    const session = new DapDebugSession(runner.docker, config, request, events, () => undefined);

    try {
      await session.start();
      await stopped;
      return collected;
    } finally {
      await session.close(false);
    }
  }
});
