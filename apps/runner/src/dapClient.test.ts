import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { DapClient, type DapEvent } from "./dapClient.js";

describe("DapClient", () => {
  it("parses partial framed events", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new DapClient(input, output);
    const events: DapEvent[] = [];
    client.onEvent((event) => events.push(event));

    const frame = encode({ seq: 1, type: "event", event: "initialized" });
    input.write(frame.slice(0, 10));
    input.write(frame.slice(10));

    await tick();
    expect(events).toEqual([{ seq: 1, type: "event", event: "initialized" }]);
  });

  it("parses multiple messages from one chunk", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new DapClient(input, output);
    const events: DapEvent[] = [];
    client.onEvent((event) => events.push(event));

    input.write(
      Buffer.concat([
        encode({ seq: 1, type: "event", event: "continued" }),
        encode({ seq: 2, type: "event", event: "terminated" })
      ])
    );

    await tick();
    expect(events.map((event) => event.event)).toEqual(["continued", "terminated"]);
  });

  it("resolves matching responses", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new DapClient(input, output);
    const responsePromise = client.request("initialize", { adapterID: "test" });

    input.write(encode({ seq: 2, type: "response", request_seq: 1, success: true, command: "initialize" }));

    await expect(responsePromise).resolves.toMatchObject({ command: "initialize", success: true });
  });

  it("rejects requests that do not receive a response", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new DapClient(input, output, 1);

    await expect(client.request("initialize")).rejects.toThrow("DAP request 'initialize' timed out");
  });
});

function encode(message: unknown): Buffer {
  const payload = JSON.stringify(message);
  return Buffer.from(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`, "utf8");
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
