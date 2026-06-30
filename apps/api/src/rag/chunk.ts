/** A heading-scoped slice of a document, ready to embed. */
export type MarkdownChunk = { headingPath: string; text: string };

export type ChunkOptions = {
  /** Soft max characters per chunk (~4 chars/token → ~1000 tokens at 4000). */
  maxChars: number;
  /** Overlap (chars) carried between split windows of one long section. */
  overlap: number;
};

const DEFAULTS: ChunkOptions = { maxChars: 4000, overlap: 400 };

/** ATX heading like `## Title` → `{ level, title }`, else null. */
function parseHeading(line: string): { level: number; title: string } | null {
  const match = /^(#{1,6})\s+(.*)$/.exec(line);
  if (!match) {
    return null;
  }
  return { level: match[1]?.length ?? 1, title: (match[2] ?? "").trim() };
}

/** Breadcrumb of the heading stack, e.g. "GPIO > API Reference". */
function breadcrumb(stack: { level: number; title: string }[]): string {
  return stack.map((entry) => entry.title).join(" > ");
}

/** Split one long section into overlapping windows on paragraph boundaries. */
function splitLong(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }
  const paragraphs = text.split(/\n{2,}/);
  const windows: string[] = [];
  let current = "";
  for (const para of paragraphs) {
    if (current !== "" && current.length + para.length + 2 > maxChars) {
      windows.push(current);
      const tail = current.slice(Math.max(0, current.length - overlap));
      current = `${tail}\n\n${para}`;
    } else {
      current = current === "" ? para : `${current}\n\n${para}`;
    }
  }
  if (current.trim() !== "") {
    windows.push(current);
  }
  return windows;
}

/**
 * Split markdown into heading-aware chunks. Each chunk carries the breadcrumb of
 * the headings it lives under so retrieval keeps context, and long sections are
 * windowed with overlap so no single chunk blows past the embedding limit.
 */
export function chunkMarkdown(markdown: string, options: Partial<ChunkOptions> = {}): MarkdownChunk[] {
  const { maxChars, overlap } = { ...DEFAULTS, ...options };
  const lines = markdown.split(/\r?\n/);
  const stack: { level: number; title: string }[] = [];
  const chunks: MarkdownChunk[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (text === "") {
      return;
    }
    const headingPath = breadcrumb(stack);
    for (const window of splitLong(text, maxChars, overlap)) {
      const trimmed = window.trim();
      if (trimmed !== "") {
        chunks.push({ headingPath, text: trimmed });
      }
    }
  };

  for (const line of lines) {
    const heading = parseHeading(line);
    if (heading) {
      flush();
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= heading.level) {
        stack.pop();
      }
      stack.push(heading);
    } else {
      buffer.push(line);
    }
  }
  flush();
  return chunks;
}
