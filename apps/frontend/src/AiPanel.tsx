import {
  GraduationCap,
  Plus,
  Send,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiContext,
  AiLevel,
  AiModelsResponse,
  AiSkillKind,
  AiThreadSummary,
  AiWorkflow,
  ChatMessage,
  ChatSendRequest,
  Language
} from "@internal/shared";
import { aiApi } from "./aiApi.js";

type AiPanelProps = {
  onClose: () => void;
  /** Reset to logged-out on a 401 (shared with the rest of the app). */
  onAuthError: (error: unknown) => void;
  /** Pull the editor's current file/selection/run output for auto-context. */
  collectContext: () => AiContext;
  /** The editor's currently selected language (drives the language_syntax skill). */
  currentLanguage: Language;
};

export function AiPanel({ onClose, onAuthError, collectContext, currentLanguage }: AiPanelProps) {
  const [meta, setMeta] = useState<AiModelsResponse | null>(null);
  const [model, setModel] = useState<string>("");
  const [workflow, setWorkflow] = useState<AiWorkflow>("answer");
  const [skillKind, setSkillKind] = useState<AiSkillKind>("language_syntax");
  const [topic, setTopic] = useState<string>("");
  const [level, setLevel] = useState<AiLevel>("fresher");
  const [attachContext, setAttachContext] = useState(true);

  const [threads, setThreads] = useState<AiThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load the model catalog + workflows/topics, and the user's thread list.
  useEffect(() => {
    let cancelled = false;
    aiApi
      .models()
      .then((data) => {
        if (cancelled) return;
        setMeta(data);
        setModel((current) => current || data.models[0]?.id || "");
        setTopic((current) => current || data.topics[0]?.id || "");
      })
      .catch(onAuthError);
    aiApi
      .threads()
      .then((data) => {
        if (!cancelled) setThreads(data.threads);
      })
      .catch(onAuthError);
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [onAuthError]);

  // Keep the transcript scrolled to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const refreshThreads = useCallback(() => {
    aiApi
      .threads()
      .then((data) => setThreads(data.threads))
      .catch(onAuthError);
  }, [onAuthError]);

  const openThread = useCallback(
    (id: string) => {
      setError(null);
      aiApi
        .thread(id)
        .then((thread) => {
          setThreadId(thread.id);
          setMessages(
            thread.messages
              .filter((message) => message.role !== "system")
              .map((message) => ({ role: message.role, content: message.content }))
          );
        })
        .catch(onAuthError);
    },
    [onAuthError]
  );

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    setThreadId(null);
    setMessages([]);
    setError(null);
  }, []);

  const deleteThread = useCallback(
    (id: string) => {
      aiApi
        .deleteThread(id)
        .then(() => {
          if (id === threadId) newThread();
          refreshThreads();
        })
        .catch(onAuthError);
    },
    [threadId, newThread, refreshThreads, onAuthError]
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || streaming || !model) {
      return;
    }
    setError(null);
    setInput("");
    setMessages((current) => [...current, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const skill: ChatSendRequest["skill"] =
      skillKind === "language_syntax"
        ? { kind: "language_syntax", language: currentLanguage }
        : { kind: "topic_roadmap", topic, level };

    const request: ChatSendRequest = {
      ...(threadId ? { threadId } : {}),
      model,
      workflow,
      skill,
      message: text,
      ...(attachContext ? { context: collectContext() } : {})
    };

    const appendToAssistant = (token: string): void => {
      setMessages((current) => {
        const next = current.slice();
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = { role: "assistant", content: last.content + token };
        }
        return next;
      });
    };

    aiApi
      .chatStream(request, {
        signal: controller.signal,
        onToken: appendToAssistant,
        onError: (message) => setError(message),
        onDone: ({ threadId: id }) => {
          setThreadId(id);
          refreshThreads();
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        onAuthError(err);
        setError(err instanceof Error ? err.message : "Request failed");
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
        setStreaming(false);
      });
  }, [
    input,
    streaming,
    model,
    skillKind,
    currentLanguage,
    topic,
    level,
    threadId,
    workflow,
    attachContext,
    collectContext,
    refreshThreads,
    onAuthError
  ]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  return (
    <aside className="ai-panel" aria-label="AI learning assistant">
      <header className="ai-panel-header">
        <span className="ai-panel-title">
          <GraduationCap size={16} />
          <span>Learning assistant</span>
        </span>
        <div className="ai-panel-header-actions">
          <button type="button" className="ai-icon-btn" title="New chat" aria-label="New chat" onClick={newThread}>
            <Plus size={15} />
          </button>
          <button type="button" className="ai-icon-btn" title="Close" aria-label="Close assistant" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="ai-controls">
        <label className="ai-field">
          <span>Model</span>
          <select data-testid="ai-model-select" value={model} onChange={(event) => setModel(event.target.value)}>
            {meta?.models.length ? (
              meta.models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))
            ) : (
              <option value="">No model available</option>
            )}
          </select>
        </label>
        <label className="ai-field">
          <span>Workflow</span>
          <select value={workflow} onChange={(event) => setWorkflow(event.target.value as AiWorkflow)}>
            {meta?.workflows.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ai-field">
          <span>Skill</span>
          <select value={skillKind} onChange={(event) => setSkillKind(event.target.value as AiSkillKind)}>
            <option value="language_syntax">Language syntax</option>
            <option value="topic_roadmap">Topic roadmap</option>
          </select>
        </label>
        {skillKind === "language_syntax" ? (
          <p className="ai-hint">Teaching syntax for the editor language: {currentLanguage}</p>
        ) : (
          <div className="ai-field-row">
            <label className="ai-field">
              <span>Topic</span>
              <select value={topic} onChange={(event) => setTopic(event.target.value)}>
                {meta?.topics.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ai-field">
              <span>Level</span>
              <select value={level} onChange={(event) => setLevel(event.target.value as AiLevel)}>
                {meta?.levels.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <label className="ai-checkbox">
          <input type="checkbox" checked={attachContext} onChange={(event) => setAttachContext(event.target.checked)} />
          <span>Attach current code &amp; output</span>
        </label>
      </div>

      {threads.length > 0 && (
        <div className="ai-threads">
          <select
            aria-label="Conversation"
            value={threadId ?? ""}
            onChange={(event) => {
              const id = event.target.value;
              if (id) openThread(id);
              else newThread();
            }}
          >
            <option value="">New conversation…</option>
            {threads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title}
              </option>
            ))}
          </select>
          {threadId && (
            <button
              type="button"
              className="ai-icon-btn"
              title="Delete conversation"
              aria-label="Delete conversation"
              onClick={() => deleteThread(threadId)}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      )}

      <div className="ai-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="ai-empty">Ask anything about programming, embedded or firmware — I&apos;ll teach in Vietnamese.</p>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`ai-message ai-${message.role}`}>
            <span className="ai-role">{message.role === "user" ? "You" : "Tutor"}</span>
            <div className="ai-bubble">{message.content || (streaming && index === messages.length - 1 ? "…" : "")}</div>
          </div>
        ))}
        {error && <p className="ai-error">{error}</p>}
      </div>

      <form
        className="ai-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          className="ai-input"
          value={input}
          placeholder="Ask the tutor…"
          rows={2}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        {streaming ? (
          <button type="button" className="ai-send" onClick={stop} title="Stop">
            <X size={16} />
          </button>
        ) : (
          <button type="submit" className="ai-send" disabled={!input.trim() || !model} title="Send">
            <Send size={16} />
          </button>
        )}
      </form>
    </aside>
  );
}
