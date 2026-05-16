import { EventEmitter } from "node:events";

export type DapEvent = {
  type: "event";
  seq: number;
  event: string;
  body?: unknown;
};

export type DapResponse = {
  type: "response";
  seq: number;
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: unknown;
};

type DapRequest = {
  type: "request";
  seq: number;
  command: string;
  arguments?: unknown;
};

type DapMessage = DapEvent | DapResponse | DapRequest;

type PendingRequest = {
  command: string;
  resolve: (response: DapResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const HEADER_SEPARATOR = Buffer.from("\r\n\r\n", "ascii");
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class DapClient {
  private readonly emitter = new EventEmitter();
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private seq = 1;
  private closed = false;

  constructor(
    private readonly input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ) {
    this.input.on("data", (chunk: Buffer | string) => {
      this.readChunk(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
    });
    this.input.on("error", (error) => {
      const dapError = error instanceof Error ? error : new Error("DAP input failed");
      this.emitError(dapError);
      this.failAll(dapError);
    });
    this.input.on("end", () => this.close());
    this.input.on("close", () => this.close());
  }

  onEvent(listener: (event: DapEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.emitter.on("dapError", listener);
    return () => this.emitter.off("dapError", listener);
  }

  async request(command: string, args?: unknown): Promise<DapResponse> {
    if (this.closed) {
      throw new Error("DAP session is closed");
    }

    const seq = this.seq++;
    const message = {
      seq,
      type: "request",
      command,
      arguments: args
    };
    const payload = JSON.stringify(message);
    const framed = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;

    return await new Promise<DapResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`DAP request '${command}' timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      this.pending.set(seq, { command, resolve, reject, timeout });
      this.output.write(framed, "utf8", (error) => {
        if (!error) {
          return;
        }

        this.pending.delete(seq);
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.failAll(new Error("DAP session closed"));
  }

  private readChunk(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length > 0) {
      const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd < 0) {
        if (this.buffer.length > 1024 * 1024) {
          this.emitError(new Error("Invalid DAP stream: missing message header"));
          this.buffer = Buffer.alloc(0);
        }
        return;
      }

      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const contentLength = /^Content-Length:\s*(\d+)$/im.exec(header)?.[1];
      if (!contentLength) {
        this.emitError(new Error("Invalid DAP stream: missing Content-Length"));
        this.buffer = this.buffer.subarray(headerEnd + HEADER_SEPARATOR.length);
        continue;
      }

      const length = Number.parseInt(contentLength, 10);
      const bodyStart = headerEnd + HEADER_SEPARATOR.length;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) {
        return;
      }

      const body = this.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.subarray(bodyEnd);
      this.handleBody(body);
    }
  }

  private handleBody(body: string): void {
    let message: DapMessage;
    try {
      message = JSON.parse(body) as DapMessage;
    } catch {
      this.emitError(new Error("Invalid DAP stream: malformed JSON message"));
      return;
    }

    if (message.type === "event") {
      this.emitter.emit("event", message);
      return;
    }

    if (message.type === "response") {
      const pending = this.pending.get(message.request_seq);
      if (!pending) {
        return;
      }

      this.pending.delete(message.request_seq);
      clearTimeout(pending.timeout);
      if (message.success) {
        pending.resolve(message);
      } else {
        pending.reject(new Error(message.message ?? `${pending.command} failed`));
      }
      return;
    }

    if (message.type === "request") {
      this.respondToAdapterRequest(message);
    }
  }

  private respondToAdapterRequest(request: DapRequest): void {
    const response = {
      seq: this.seq++,
      type: "response",
      request_seq: request.seq,
      success: false,
      command: request.command,
      message: `Runner does not support adapter request '${request.command}'`
    };
    const payload = JSON.stringify(response);
    this.output.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`, "utf8");
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emitError(error: Error): void {
    this.emitter.emit("dapError", error);
  }
}
