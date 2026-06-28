import {
  ChevronLeft,
  ChevronRight,
  Copy,
  GraduationCap,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Terminal,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AiAgentStep,
  AiContext,
  AiKeyInfoResponse,
  AiLevel,
  AiModelsResponse,
  AiSkillKind,
  AiThreadNode,
  AiThreadSummary,
  AiWorkflow,
  ChatSendRequest,
  Language
} from "@internal/shared";
import { aiApi } from "./aiApi.js";
import { AiMarkdown } from "./AiMarkdown.js";
import { splitThinking } from "./aiContent.js";
import { activePath, nodeMap, siblings, descendToLeaf } from "./aiTree.js";

type AiPanelProps = {
  onClose: () => void;
  /** Reset to logged-out on a 401 (shared with the rest of the app). */
  onAuthError: (error: unknown) => void;
  /** Pull the editor's current file/selection/run output for auto-context. */
  collectContext: () => AiContext;
  /** The editor's currently selected language (drives the language_syntax skill). */
  currentLanguage: Language;
};

/** The in-flight turn rendered below the persisted branch while streaming. */
type Pending = { user: string | null; assistant: string; steps: AiAgentStep[] };

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
  const [nodes, setNodes] = useState<AiThreadNode[]>([]);
  const [currentLeafId, setCurrentLeafId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<{ nodeId: string; text: string } | null>(null);

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [keyInfo, setKeyInfo] = useState<AiKeyInfoResponse | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [showKeyForm, setShowKeyForm] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const path = useMemo(() => activePath(nodes, currentLeafId), [nodes, currentLeafId]);
  const byId = useMemo(() => nodeMap(nodes), [nodes]);

  const reloadModels = useCallback(() => {
    return aiApi
      .models()
      .then((data) => {
        setMeta(data);
        setModel((current) => (current && data.models.some((m) => m.id === current) ? current : data.models[0]?.id ?? ""));
        setTopic((current) => current || data.topics[0]?.id || "");
      })
      .catch(onAuthError);
  }, [onAuthError]);

  useEffect(() => {
    let cancelled = false;
    void reloadModels();
    aiApi
      .threads()
      .then((data) => {
        if (!cancelled) setThreads(data.threads);
      })
      .catch(onAuthError);
    aiApi
      .keyInfo()
      .then((info) => {
        if (!cancelled) setKeyInfo(info);
      })
      .catch(onAuthError);
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [reloadModels, onAuthError]);

  const saveKey = useCallback(() => {
    const value = keyInput.trim();
    if (!value) return;
    aiApi
      .setKey(value)
      .then((info) => {
        setKeyInfo(info);
        setKeyInput("");
        setShowKeyForm(false);
        return reloadModels();
      })
      .catch(onAuthError);
  }, [keyInput, reloadModels, onAuthError]);

  const removeKey = useCallback(() => {
    aiApi
      .deleteKey()
      .then(() => {
        setKeyInfo({ hasKey: false });
        return reloadModels();
      })
      .catch(onAuthError);
  }, [reloadModels, onAuthError]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [path, pending]);

  const refreshThreads = useCallback(() => {
    aiApi
      .threads()
      .then((data) => setThreads(data.threads))
      .catch(onAuthError);
  }, [onAuthError]);

  const loadThread = useCallback(
    (id: string) => {
      return aiApi
        .thread(id)
        .then((thread) => {
          setThreadId(thread.id);
          setNodes(thread.nodes);
          setCurrentLeafId(thread.currentLeafId);
        })
        .catch(onAuthError);
    },
    [onAuthError]
  );

  const openThread = useCallback(
    (id: string) => {
      setError(null);
      setEditing(null);
      void loadThread(id);
    },
    [loadThread]
  );

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    setThreadId(null);
    setNodes([]);
    setCurrentLeafId(null);
    setPending(null);
    setEditing(null);
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

  // Core send used by normal send, edit-and-resend, and regenerate.
  const runChat = useCallback(
    (opts: { message: string; parentId?: string; regenerate?: boolean; showUser: string | null }) => {
      if (streaming || !model) {
        return;
      }
      setError(null);
      setEditing(null);
      setPending({ user: opts.showUser, assistant: "", steps: [] });
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
        message: opts.message,
        ...(opts.parentId ? { parentId: opts.parentId } : {}),
        ...(opts.regenerate ? { regenerate: true } : {}),
        ...(attachContext ? { context: collectContext() } : {})
      };

      aiApi
        .chatStream(request, {
          signal: controller.signal,
          onToken: (token) => setPending((p) => (p ? { ...p, assistant: p.assistant + token } : p)),
          onStep: (step) => setPending((p) => (p ? { ...p, steps: [...p.steps, step] } : p)),
          onError: (message) => setError(message),
          onDone: ({ threadId: id }) => {
            void loadThread(id).then(() => setPending(null));
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
    },
    [
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
      loadThread,
      refreshThreads,
      onAuthError
    ]
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    runChat({ message: text, parentId: currentLeafId ?? undefined, showUser: text });
  }, [input, currentLeafId, runChat]);

  const regenerate = useCallback(
    (assistant: AiThreadNode) => {
      if (!assistant.parentId) return;
      const userText = byId.get(assistant.parentId)?.content ?? "";
      runChat({ message: userText || "(regenerate)", parentId: assistant.parentId, regenerate: true, showUser: null });
    },
    [byId, runChat]
  );

  const submitEdit = useCallback(() => {
    if (!editing) return;
    const node = byId.get(editing.nodeId);
    const text = editing.text.trim();
    if (!node || !text) return;
    // Branch a new user message under the same parent (keeps the old one as a variant).
    runChat({ message: text, parentId: node.parentId ?? undefined, showUser: text });
  }, [editing, byId, runChat]);

  const removeNode = useCallback(
    (nodeId: string) => {
      if (!threadId) return;
      aiApi
        .deleteNode(threadId, nodeId)
        .then(() => loadThread(threadId))
        .catch(onAuthError);
    },
    [threadId, loadThread, onAuthError]
  );

  const switchVariant = useCallback(
    (node: AiThreadNode, dir: -1 | 1) => {
      if (!threadId) return;
      const sibs = siblings(nodes, node);
      const index = sibs.findIndex((s) => s.id === node.id);
      const target = sibs[index + dir];
      if (!target) return;
      const leaf = descendToLeaf(nodes, target.id);
      setCurrentLeafId(leaf);
      aiApi.setLeaf(threadId, leaf).catch(onAuthError);
    },
    [threadId, nodes, onAuthError]
  );

  const copy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text);
  }, []);

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
        {meta?.models.find((item) => item.id === model)?.backend === "antigravity" && (
          <p className="ai-hint ai-experimental">
            Experimental agent — runs tools/code in Google&apos;s sandbox. Slow, very limited free quota.
          </p>
        )}
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

        <div className="ai-key">
          {keyInfo?.hasKey ? (
            <div className="ai-key-status">
              <KeyRound size={13} />
              <span>Google key ••{keyInfo.last4}</span>
              <button type="button" className="ai-link" onClick={removeKey}>
                Remove
              </button>
            </div>
          ) : showKeyForm ? (
            <div className="ai-key-form">
              <input
                type="password"
                value={keyInput}
                placeholder="Paste your Google API key"
                autoComplete="off"
                onChange={(event) => setKeyInput(event.target.value)}
              />
              <button type="button" className="ai-link" onClick={saveKey} disabled={!keyInput.trim()}>
                Save
              </button>
              <button
                type="button"
                className="ai-link"
                onClick={() => {
                  setShowKeyForm(false);
                  setKeyInput("");
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="ai-link" onClick={() => setShowKeyForm(true)}>
              <KeyRound size={13} /> Add your Google API key
            </button>
          )}
        </div>
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
        {path.length === 0 && !pending && (
          <p className="ai-empty">Ask anything about programming, embedded or firmware — I&apos;ll teach in Vietnamese.</p>
        )}
        {path.map((node) => {
          const sibs = siblings(nodes, node);
          const variantIndex = sibs.findIndex((s) => s.id === node.id);
          const isEditing = editing?.nodeId === node.id;
          return (
            <div key={node.id} className={`ai-message ai-${node.role}`}>
              <span className="ai-role">{node.role === "user" ? "You" : "Tutor"}</span>
              {node.role === "assistant" && node.steps && node.steps.length > 0 && (
                <details className="ai-agent-steps" open>
                  <summary>Agent activity ({node.steps.length})</summary>
                  {node.steps.map((step, stepIndex) => (
                    <AgentStepView key={stepIndex} step={step} />
                  ))}
                </details>
              )}
              {isEditing ? (
                <div className="ai-edit">
                  <textarea
                    value={editing?.text ?? ""}
                    rows={3}
                    onChange={(event) => setEditing({ nodeId: node.id, text: event.target.value })}
                  />
                  <div className="ai-edit-actions">
                    <button type="button" className="ai-link" onClick={submitEdit} disabled={!editing?.text.trim()}>
                      Send
                    </button>
                    <button type="button" className="ai-link" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : node.role === "assistant" ? (
                <AssistantBody content={node.content} />
              ) : (
                <div className="ai-bubble">{node.content}</div>
              )}
              {!isEditing && (
                <div className="ai-msg-actions">
                  {sibs.length > 1 && (
                    <span className="ai-variant-nav">
                      <button
                        type="button"
                        className="ai-icon-btn"
                        title="Previous variant"
                        disabled={variantIndex <= 0}
                        onClick={() => switchVariant(node, -1)}
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <span>
                        {variantIndex + 1}/{sibs.length}
                      </span>
                      <button
                        type="button"
                        className="ai-icon-btn"
                        title="Next variant"
                        disabled={variantIndex >= sibs.length - 1}
                        onClick={() => switchVariant(node, 1)}
                      >
                        <ChevronRight size={13} />
                      </button>
                    </span>
                  )}
                  <button type="button" className="ai-icon-btn" title="Copy" onClick={() => copy(node.content)}>
                    <Copy size={13} />
                  </button>
                  {node.role === "user" && (
                    <button
                      type="button"
                      className="ai-icon-btn"
                      title="Edit & resend"
                      onClick={() => setEditing({ nodeId: node.id, text: node.content })}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {node.role === "assistant" && (
                    <button
                      type="button"
                      className="ai-icon-btn"
                      title="Regenerate"
                      disabled={streaming}
                      onClick={() => regenerate(node)}
                    >
                      <RefreshCw size={13} />
                    </button>
                  )}
                  <button type="button" className="ai-icon-btn" title="Delete" onClick={() => removeNode(node.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {pending && (
          <>
            {pending.user !== null && (
              <div className="ai-message ai-user">
                <span className="ai-role">You</span>
                <div className="ai-bubble">{pending.user}</div>
              </div>
            )}
            <div className="ai-message ai-assistant">
              <span className="ai-role">Tutor</span>
              {pending.steps.length > 0 && (
                <details className="ai-agent-steps" open>
                  <summary>Agent activity ({pending.steps.length})</summary>
                  {pending.steps.map((step, stepIndex) => (
                    <AgentStepView key={stepIndex} step={step} />
                  ))}
                </details>
              )}
              <AssistantBody content={pending.assistant} streaming />
            </div>
          </>
        )}
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

/** Assistant reply: a collapsible Thinking block (if any) above the markdown answer. */
function AssistantBody({ content, streaming }: { content: string; streaming?: boolean }) {
  const { thinking, body, thinkingOpen } = splitThinking(content);
  return (
    <div className="ai-bubble">
      {thinking && (
        <details className="ai-think" open={Boolean(streaming && thinkingOpen)}>
          <summary>Suy nghĩ / Thinking</summary>
          <div className="ai-think-body">{thinking}</div>
        </details>
      )}
      {body ? <AiMarkdown content={body} /> : <span className="ai-md-empty">…</span>}
    </div>
  );
}

/** Render one Antigravity agent activity item (code/tool/image/thought). */
function AgentStepView({ step }: { step: AiAgentStep }) {
  if (step.kind === "code_call") {
    return (
      <div className="ai-step ai-step-code">
        <span className="ai-step-label">
          <Terminal size={12} /> code{step.language ? ` · ${step.language}` : ""}
        </span>
        <pre>{step.code}</pre>
      </div>
    );
  }
  if (step.kind === "code_result") {
    return (
      <div className={`ai-step ai-step-result${step.isError ? " ai-step-error" : ""}`}>
        <span className="ai-step-label">{step.isError ? "error" : "result"}</span>
        <pre>{step.result}</pre>
      </div>
    );
  }
  if (step.kind === "tool_call") {
    return (
      <div className="ai-step ai-step-tool">
        <span className="ai-step-label">
          <Wrench size={12} /> {step.name}
        </span>
      </div>
    );
  }
  if (step.kind === "tool_result") {
    return (
      <div className={`ai-step ai-step-tool${step.isError ? " ai-step-error" : ""}`}>
        <span className="ai-step-label">tool {step.isError ? "failed" : "done"}</span>
      </div>
    );
  }
  if (step.kind === "image") {
    return (
      <div className="ai-step ai-step-img">
        <img src={`data:${step.mimeType};base64,${step.dataBase64}`} alt="agent artifact" />
      </div>
    );
  }
  return (
    <div className="ai-step ai-step-thought">
      <em>{step.text}</em>
    </div>
  );
}
