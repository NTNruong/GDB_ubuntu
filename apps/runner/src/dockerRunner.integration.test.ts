import { describe, expect, it } from "vitest";
import type { RunEvent, RunRequest } from "@internal/shared";
import { readConfig } from "./config.js";
import { DockerRunner } from "./dockerRunner.js";
import { EventBuffer } from "./eventBuffer.js";

const maybeDescribe = process.env.RUN_DOCKER_TESTS === "1" ? describe : describe.skip;

maybeDescribe("DockerRunner integration", () => {
  const config = {
    ...readConfig(),
    runTimeoutMs: 5_000
  };

  it("runs C code", async () => {
    const events = await run({
      language: "c",
      files: [{ path: "main.c", content: '#include <stdio.h>\nint main(){ char s[32]; scanf("%31s", s); printf("hi %s\\n", s); }' }],
      stdin: "ada\n",
      argv: []
    });

    expect(text(events, "stdout")).toContain("hi ada");
    expect(exit(events)?.code).toBe(0);
    expect(metric(events)).toBeDefined();
  });

  it("runs C++ code with bits/stdc++.h", async () => {
    const events = await run({
      language: "cpp",
      files: [{ path: "main.cpp", content: '#include <bits/stdc++.h>\nusing namespace std; int main(){ cout << vector<int>{1,2,3}.size() << "\\n"; }' }],
      stdin: "",
      argv: []
    });

    expect(text(events, "stdout")).toContain("3");
    expect(exit(events)?.code).toBe(0);
    expect(metric(events)).toBeDefined();
  });

  it("runs Python with practical packages", async () => {
    const events = await run({
      language: "python",
      files: [{ path: "main.py", content: "import numpy, pandas, requests\nprint(numpy.array([1,2,3]).sum())" }],
      stdin: "",
      argv: []
    });

    expect(text(events, "stdout")).toContain("6");
    expect(exit(events)?.code).toBe(0);
    expect(metric(events)).toBeDefined();
  });

  it("emits run metrics for non-zero exits after execution starts", async () => {
    const events = await run({
      language: "c",
      files: [{ path: "main.c", content: '#include <stdio.h>\nint main(){ puts("before exit"); return 7; }' }],
      stdin: "",
      argv: []
    });

    expect(text(events, "stdout")).toContain("before exit");
    expect(exit(events)?.code).toBe(7);
    expect(metric(events)).toBeDefined();
  });

  it("times out infinite loops", async () => {
    const events = await run({
      language: "cpp",
      files: [{ path: "main.cpp", content: "#include <bits/stdc++.h>\nint main(){ while(true){} }" }],
      stdin: "",
      argv: []
    });

    expect(exit(events)?.timedOut).toBe(true);
  });

  it("truncates oversized output", async () => {
    const events = await run({
      language: "python",
      files: [{ path: "main.py", content: "print('x' * (6 * 1024 * 1024))" }],
      stdin: "",
      argv: []
    });

    expect(exit(events)?.outputTruncated).toBe(true);
  });

  async function run(request: RunRequest): Promise<RunEvent[]> {
    const runner = new DockerRunner(config);
    const events = new EventBuffer<RunEvent>();
    const collected: RunEvent[] = [];
    events.subscribe((event) => collected.push(event));
    await runner.run(request, events);
    return collected;
  }
});

function text(events: RunEvent[], type: "stdout" | "stderr"): string {
  return events
    .filter((event): event is Extract<RunEvent, { type: typeof type }> => event.type === type)
    .map((event) => event.data)
    .join("");
}

function exit(events: RunEvent[]): Extract<RunEvent, { type: "exit" }> | undefined {
  return events.find((event): event is Extract<RunEvent, { type: "exit" }> => event.type === "exit");
}

function metric(events: RunEvent[]): Extract<RunEvent, { type: "metric" }> | undefined {
  return events.find((event): event is Extract<RunEvent, { type: "metric" }> => event.type === "metric");
}
