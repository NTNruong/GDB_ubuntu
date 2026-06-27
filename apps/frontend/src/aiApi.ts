import type {
  AiModelsResponse,
  AiStreamEvent,
  AiThreadListResponse,
  AiThreadResponse,
  ChatSendRequest
} from "@internal/shared";
import { AuthExpiredError } from "./filesApi.js";

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    return (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    return text || response.statusText;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, credentials: "same-origin" });
  if (response.status === 401) {
    throw new AuthExpiredError();
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as T;
}

function jsonBody(body: unknown): RequestInit {
  return { headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export type ChatStreamHandlers = {
  onToken: (token: string) => void;
  onDone: (event: { threadId: string; title: string }) => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
};

export const aiApi = {
  models(): Promise<AiModelsResponse> {
    return request<AiModelsResponse>("/api/ai/models");
  },
  threads(): Promise<AiThreadListResponse> {
    return request<AiThreadListResponse>("/api/ai/threads");
  },
  thread(id: string): Promise<AiThreadResponse> {
    return request<AiThreadResponse>(`/api/ai/threads/${encodeURIComponent(id)}`);
  },
  renameThread(id: string, title: string): Promise<void> {
    return request<{ ok: true }>(`/api/ai/threads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      ...jsonBody({ title })
    }).then(() => undefined);
  },
  deleteThread(id: string): Promise<void> {
    return request<{ ok: true }>(`/api/ai/threads/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }).then(() => undefined);
  },

  /**
   * Stream a chat completion. Uses `fetch` + a `ReadableStream` reader (not
   * `EventSource`, which can't POST a body) and parses the same `data: <json>`
   * SSE framing the server writes. 401 → AuthExpiredError, like the other calls.
   */
  async chatStream(req: ChatSendRequest, handlers: ChatStreamHandlers): Promise<void> {
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      credentials: "same-origin",
      signal: handlers.signal,
      ...jsonBody(req)
    });
    if (response.status === 401) {
      throw new AuthExpiredError();
    }
    if (!response.ok || !response.body) {
      throw new Error(await readError(response));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handleLine = (line: string): void => {
      if (!line.startsWith("data:")) {
        return;
      }
      const payload = line.slice(5).trim();
      if (payload === "") {
        return;
      }
      let event: AiStreamEvent;
      try {
        event = JSON.parse(payload) as AiStreamEvent;
      } catch {
        return;
      }
      if (event.type === "token") {
        handlers.onToken(event.data);
      } else if (event.type === "done") {
        handlers.onDone({ threadId: event.threadId, title: event.title });
      } else if (event.type === "error") {
        handlers.onError(event.message);
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, nl).replace(/\r$/, ""));
        buffer = buffer.slice(nl + 1);
      }
    }
    const last = buffer.replace(/\r$/, "");
    if (last) {
      handleLine(last);
    }
  }
};
