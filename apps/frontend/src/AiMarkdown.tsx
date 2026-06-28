import { Copy } from "lucide-react";
import { isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";

/** mermaid is heavy (~hundreds of KB) → load it lazily the first time a diagram renders. */
let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      // securityLevel:"strict" sanitizes the SVG and disables scripts/click handlers.
      mod.default.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
      return mod.default;
    });
  }
  return mermaidPromise;
}

/** Render a ```mermaid block to SVG; fall back to the raw source while loading or on a parse error
 *  (which also covers an incomplete fence mid-stream). */
function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSvg(null);
    loadMermaid()
      .then((mermaid) => mermaid.render(`ai-mermaid-${Math.random().toString(36).slice(2)}`, code))
      .then((result) => {
        if (active) setSvg(result.svg);
      })
      .catch(() => {
        if (active) setSvg(null);
      });
    return () => {
      active = false;
    };
  }, [code]);

  if (svg === null) {
    return (
      <div className="ai-code">
        <pre>{code}</pre>
      </div>
    );
  }
  // mermaid (strict mode) sanitizes its own output, so injecting the SVG is safe.
  return <div className="ai-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Read the language + raw text of a fenced block from the `<code>` child react-markdown passes. */
function codeInfo(children: ReactNode): { lang: string; text: string } | null {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement(child)) return null;
  const props = child.props as { className?: string; children?: ReactNode };
  const lang = /language-(\w+)/.exec(props.className ?? "")?.[1] ?? "";
  const text = typeof props.children === "string" ? props.children : "";
  return { lang, text };
}

/**
 * A fenced code block. A ```mermaid block becomes a diagram; anything else keeps
 * rehype-highlight's syntax spans (we wrap the default `<pre>` rather than re-rendering
 * the text) and gets a Copy button that reads the rendered text via the DOM.
 */
const CodeBlock: Components["pre"] = ({ children }) => {
  const ref = useRef<HTMLPreElement>(null);
  const info = codeInfo(children);
  if (info?.lang === "mermaid" && info.text.trim()) {
    return <MermaidBlock code={info.text} />;
  }
  const onCopy = () => {
    const text = ref.current?.innerText ?? "";
    void navigator.clipboard?.writeText(text);
  };
  return (
    <div className="ai-code">
      <button type="button" className="ai-code-copy" title="Copy code" onClick={onCopy}>
        <Copy size={13} />
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
};

/** External links open in a new tab and can't reach back via window.opener. */
const Anchor: Components["a"] = ({ children, href }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

const components: Components = { pre: CodeBlock, a: Anchor };

/**
 * Render assistant markdown safely. react-markdown is used in its default mode
 * (no `rehype-raw`), so raw HTML in model output is escaped as text rather than
 * executed — our XSS guard. `ignoreMissing` keeps unknown code languages (and the
 * mermaid blocks) from throwing during highlight.
 */
export function AiMarkdown({ content }: { content: string }) {
  return (
    <div className="ai-md">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { ignoreMissing: true }]]}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  );
}
