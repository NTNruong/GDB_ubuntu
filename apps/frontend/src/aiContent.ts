/** Result of splitting a `<think>…</think>` reasoning block off the answer body. */
export type SplitThinking = {
  /** The reasoning text, or null when the message has no `<think>` block. */
  thinking: string | null;
  /** The answer body with the reasoning block removed. */
  body: string;
  /** True while a `<think>` is open but not yet closed (mid-stream). */
  thinkingOpen: boolean;
};

const OPEN = "<think>";
const CLOSE = "</think>";

/**
 * Pull a leading `<think>…</think>` reasoning block out of model output so it can
 * render in a collapsible section, llama.cpp-style. During streaming the closing
 * tag may not have arrived yet — then everything after `<think>` is the (still
 * growing) reasoning and `thinkingOpen` is true.
 */
export function splitThinking(content: string): SplitThinking {
  const open = content.indexOf(OPEN);
  if (open === -1) {
    return { thinking: null, body: content, thinkingOpen: false };
  }
  const before = content.slice(0, open);
  const afterOpen = content.slice(open + OPEN.length);
  const close = afterOpen.indexOf(CLOSE);
  if (close === -1) {
    return { thinking: afterOpen.trim(), body: before.trim(), thinkingOpen: true };
  }
  const thinking = afterOpen.slice(0, close).trim();
  const after = afterOpen.slice(close + CLOSE.length);
  return { thinking, body: (before + after).trim(), thinkingOpen: false };
}
