import type { AiStreamEvent, AiUsage, ChatMessage } from "@internal/shared";
import {
  geminiToolTurn,
  type GeminiToolContent,
  type GeminiToolPart
} from "../backends/geminiTools.js";
import { TOOL_DECLARATIONS, executeTool, type AgentContext } from "./tools.js";

/** Hard caps so a runaway loop can't spin forever or drain the quota. */
const AGENT_MAX_ITERS = 8;
const AGENT_MAX_MS = 120_000;

/**
 * Drive one agentic turn with Gemini function-calling: repeatedly ask the model,
 * execute any tool calls it makes (emitting `tool_call` / `tool_result` / rich
 * `proposed_edit` steps), feed the results back, and stream the final text answer.
 * Yields the same {@link AiStreamEvent}s as the Antigravity path so chat.ts can
 * persist + stream them identically. Bounded by iteration + wall-clock caps and
 * cancelled when the client disconnects (`signal`).
 */
export async function* runAgent(
  apiKey: string,
  remoteModelId: string,
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  ctx: AgentContext,
  signal: AbortSignal
): AsyncGenerator<AiStreamEvent, AiUsage | undefined> {
  const contents: GeminiToolContent[] = history.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }));
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  const deadline = Date.now() + AGENT_MAX_MS;
  let usage: AiUsage | undefined;

  for (let iter = 0; iter < AGENT_MAX_ITERS; iter++) {
    if (signal.aborted || Date.now() > deadline) {
      break;
    }
    const turn = await geminiToolTurn(apiKey, remoteModelId, systemPrompt, contents, TOOL_DECLARATIONS, signal);
    if (turn.usage) {
      usage = turn.usage;
    }

    if (turn.functionCalls.length === 0) {
      if (turn.text) {
        yield { type: "token", data: turn.text };
      }
      return usage;
    }

    // Some turns carry a short preamble alongside the calls — show it as a thought,
    // not answer text, so the final answer bubble stays clean.
    if (turn.text.trim()) {
      yield { type: "step", step: { kind: "thought", text: turn.text.trim() } };
    }

    contents.push({
      role: "model",
      parts: turn.functionCalls.map((call) => ({ functionCall: call }))
    });

    const responseParts: GeminiToolPart[] = [];
    for (const call of turn.functionCalls) {
      yield { type: "step", step: { kind: "tool_call", name: call.name } };
      try {
        const { result, step } = await executeTool(call.name, call.args, ctx);
        if (step) {
          yield { type: "step", step };
        }
        yield { type: "step", step: { kind: "tool_result", isError: false } };
        responseParts.push({ functionResponse: { name: call.name, response: { result } } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.log.warn({ err: error, tool: call.name }, "agent tool failed");
        yield { type: "step", step: { kind: "tool_result", isError: true } };
        responseParts.push({ functionResponse: { name: call.name, response: { error: message } } });
      }
    }
    contents.push({ role: "user", parts: responseParts });
  }

  // Fell off the loop without a final text answer (hit a cap).
  yield { type: "token", data: "\n\n_(agent reached its step limit — ask a follow-up to continue)_" };
  return usage;
}
