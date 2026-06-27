import type { AiStreamEvent } from "@internal/shared";

const BASE = "https://generativelanguage.googleapis.com/v1beta/interactions";
const TERMINAL = new Set(["completed", "requires_action", "cancelled", "error"]);

/**
 * Build the agent `input`. The first turn carries the teaching persona (system
 * prompt); continuations rely on server-side memory via `previous_interaction_id`,
 * so we send only the new user message.
 */
export function toAgentInput(systemPrompt: string, userMessage: string, isContinuation: boolean): string {
  return isContinuation ? userMessage : `${systemPrompt}\n\n---\n\n${userMessage}`;
}

type AgentContent = { type?: string; text?: string; data?: string; mime_type?: string };
type AgentStepRaw = {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  result?: string;
  is_error?: boolean;
  arguments?: { language?: string; code?: string };
  content?: AgentContent[];
};
export type AgentSnapshot = {
  id?: string;
  status?: string;
  output_text?: string;
  environment_id?: string;
  steps?: AgentStepRaw[];
};

/** Mutable de-dup state carried across successive snapshot reads. */
export type AgentSeen = { textLen: number; stepKeys: Set<string> };
export function newAgentSeen(): AgentSeen {
  return { textLen: 0, stepKeys: new Set<string>() };
}

/**
 * Diff a (cumulative) interaction snapshot against what we've already emitted and
 * return only the new events: appended answer text as `token`s, and any unseen
 * code/tool/image steps as `step`s. Pure + snapshot-shape tolerant so it can be
 * unit-tested without the network.
 */
export function extractAgentEvents(snapshot: AgentSnapshot, seen: AgentSeen): AiStreamEvent[] {
  const events: AiStreamEvent[] = [];
  let fullText = "";
  const steps = snapshot.steps ?? [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step) {
      continue;
    }
    const key = `${step.type}:${step.id ?? step.call_id ?? i}`;
    if (step.type === "model_output") {
      for (const part of step.content ?? []) {
        if (part.type === "text" && part.text) {
          fullText += part.text;
        } else if (part.type === "image" && part.data) {
          const imageKey = `${key}:img:${part.data.length}`;
          if (!seen.stepKeys.has(imageKey)) {
            seen.stepKeys.add(imageKey);
            events.push({
              type: "step",
              step: { kind: "image", mimeType: part.mime_type ?? "image/png", dataBase64: part.data }
            });
          }
        }
      }
    } else if (step.type === "code_execution_call") {
      if (!seen.stepKeys.has(key)) {
        seen.stepKeys.add(key);
        events.push({
          type: "step",
          step: { kind: "code_call", language: step.arguments?.language ?? "", code: step.arguments?.code ?? "" }
        });
      }
    } else if (step.type === "code_execution_result") {
      if (!seen.stepKeys.has(key)) {
        seen.stepKeys.add(key);
        events.push({ type: "step", step: { kind: "code_result", result: step.result ?? "", isError: Boolean(step.is_error) } });
      }
    } else if (step.type === "function_call") {
      if (!seen.stepKeys.has(key)) {
        seen.stepKeys.add(key);
        events.push({ type: "step", step: { kind: "tool_call", name: step.name ?? "tool" } });
      }
    } else if (step.type === "function_result") {
      if (!seen.stepKeys.has(key)) {
        seen.stepKeys.add(key);
        events.push({ type: "step", step: { kind: "tool_result", isError: Boolean(step.is_error) } });
      }
    }
  }
  // Prefer `output_text` once it is at least as complete as the streamed text.
  const candidate = snapshot.output_text ?? "";
  const text = candidate.length > fullText.length ? candidate : fullText;
  if (text.length > seen.textLen) {
    events.push({ type: "token", data: text.slice(seen.textLen) });
    seen.textLen = text.length;
  }
  return events;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

export type AgentRunResult = { interactionId?: string; environmentId?: string };
export type AgentRunOptions = {
  previousInteractionId?: string;
  environmentId?: string;
  maxMs: number;
  pollMs?: number;
};

/**
 * Run a Google Antigravity agent interaction and yield activity as it happens.
 * The Interactions API is not token-streaming, so we create the interaction with
 * `background:true` and poll `GET /interactions/{id}` (full snapshots), emitting
 * only the delta each poll. Returns the interaction + environment ids for
 * multi-turn continuation. On abort/timeout it best-effort cancels the run.
 */
export async function* streamAntigravity(
  apiKey: string,
  agentId: string,
  input: string,
  signal: AbortSignal,
  opts: AgentRunOptions
): AsyncGenerator<AiStreamEvent, AgentRunResult> {
  const headers = { "content-type": "application/json", "x-goog-api-key": apiKey };
  const createBody: Record<string, unknown> = {
    agent: agentId,
    input,
    environment: opts.environmentId ?? "remote",
    background: true,
    store: true
  };
  if (opts.previousInteractionId) {
    createBody.previous_interaction_id = opts.previousInteractionId;
  }

  const createRes = await fetch(BASE, {
    method: "POST",
    headers,
    body: JSON.stringify(createBody),
    signal
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    throw new Error(`Antigravity create returned ${createRes.status}: ${text || "no response body"}`);
  }
  const created = (await createRes.json()) as AgentSnapshot;
  const id = created.id;
  if (!id) {
    throw new Error("Antigravity create returned no interaction id");
  }
  let environmentId = created.environment_id ?? opts.environmentId;

  const seen = newAgentSeen();
  const pollMs = opts.pollMs ?? 1500;
  const deadline = Date.now() + opts.maxMs;
  for (const event of extractAgentEvents(created, seen)) {
    yield event;
  }
  let status = created.status ?? "in_progress";

  try {
    while (!TERMINAL.has(status)) {
      if (Date.now() > deadline) {
        yield { type: "error", message: "Antigravity run exceeded the time limit" };
        break;
      }
      await sleep(pollMs, signal);
      const getRes = await fetch(`${BASE}/${encodeURIComponent(id)}`, { headers, signal });
      if (!getRes.ok) {
        const text = await getRes.text().catch(() => "");
        throw new Error(`Antigravity poll returned ${getRes.status}: ${text || "no response body"}`);
      }
      const snap = (await getRes.json()) as AgentSnapshot;
      environmentId = snap.environment_id ?? environmentId;
      for (const event of extractAgentEvents(snap, seen)) {
        yield event;
      }
      status = snap.status ?? "in_progress";
    }
    if (status === "error") {
      yield { type: "error", message: "Antigravity run failed" };
    }
  } finally {
    if (!TERMINAL.has(status)) {
      // Aborted or timed out mid-run: tell Google to stop the sandbox (best effort).
      void fetch(`${BASE}/${encodeURIComponent(id)}/cancel`, { method: "POST", headers }).catch(() => undefined);
    }
  }

  return { interactionId: id, environmentId };
}
