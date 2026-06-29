import {
  ArrowLeftRight,
  Bot,
  ChevronLeft,
  ChevronRight,
  Copy,
  KeyRound,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AI_REASONING_EFFORTS, MAX_AI_ATTACHMENTS, MAX_AI_CONTEXT_BYTES } from "@internal/shared";
import { levelForRatio, tokenRingColor } from "./aiTokens.js";
import type {
  AiAgentStep,
  AiAttachment,
  AiContext,
  AiKeyInfoResponse,
  AiLevel,
  AiModelsResponse,
  AiReasoningEffort,
  AiSkillKind,
  AiThreadNode,
  AiThreadSummary,
  AiUsage,
  AiWorkflow,
  ChatSendRequest,
  Language,
  TreeNode
} from "@internal/shared";
import { aiApi } from "./aiApi.js";
import { AiMarkdown } from "./AiMarkdown.js";
import { splitThinking } from "./aiContent.js";
import { flattenFiles } from "./aiAttachments.js";
import { activePath, modelSwitchPoints, nodeMap, siblings, descendToLeaf } from "./aiTree.js";

type AiPanelProps = {
  onClose: () => void;
  /** Reset to logged-out on a 401 (shared with the rest of the app). */
  onAuthError: (error: unknown) => void;
  /** Pull the editor's current file/selection/run output for auto-context. */
  collectContext: () => AiContext;
  /** The editor's currently selected language (drives the language_syntax skill). */
  currentLanguage: Language;
  /** List the user's Explorer files so they can be attached as reference context. */
  listWorkspaceFiles: () => Promise<TreeNode[]>;
  /** Read one Explorer file's content for an attachment. */
  readWorkspaceFile: (path: string) => Promise<string>;
};

/** The in-flight turn rendered below the persisted branch while streaming. */
type Pending = { user: string | null; assistant: string; steps: AiAgentStep[] };

export function AiPanel({
  onClose,
  onAuthError,
  collectContext,
  currentLanguage,
  listWorkspaceFiles,
  readWorkspaceFile
}: AiPanelProps) {
  const [meta, setMeta] = useState<AiModelsResponse | null>(null);
  const [model, setModel] = useState<string>("");
  const [workflow, setWorkflow] = useState<AiWorkflow>("answer");
  const [skillKind, setSkillKind] = useState<AiSkillKind>("language_syntax");
  const [topic, setTopic] = useState<string>("");
  const [level, setLevel] = useState<AiLevel>("fresher");
  // Copilot-style context pins: the current file / run output are shown as chips
  // (italic = focused only, not sent). Pin a chip to actually send it as context.
  const [pinnedFile, setPinnedFile] = useState(false);
  const [pinnedOutput, setPinnedOutput] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<AiReasoningEffort>("off");
  const [usage, setUsage] = useState<AiUsage | null>(null);

  // Explorer files explicitly attached as reference context (persist as chips for
  // the panel session, reset on New chat). The picker lists the workspace tree.
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFiles, setPickerFiles] = useState<TreeNode[]>([]);

  const [threads, setThreads] = useState<AiThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<AiThreadNode[]>([]);
  const [currentLeafId, setCurrentLeafId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<{ nodeId: string; text: string } | null>(null);

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Transient confirmation shown above the composer after a compact action.
  const [notice, setNotice] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);

  const [keyInfo, setKeyInfo] = useState<AiKeyInfoResponse | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [showKeyForm, setShowKeyForm] = useState(false);
  // Settings eat a lot of vertical space; collapse them behind a gear so the chat
  // gets the height. Open for a fresh chat, auto-collapsed when opening a thread.
  const [settingsOpen, setSettingsOpen] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The composer floats over the messages (ISSUE-078); track its height so the
  // scroll area reserves matching bottom padding and never hides the last message.
  const composerRef = useRef<HTMLFormElement | null>(null);
  const [composerH, setComposerH] = useState(0);

  const path = useMemo(() => activePath(nodes, currentLeafId), [nodes, currentLeafId]);
  const byId = useMemo(() => nodeMap(nodes), [nodes]);

  // Node ids that should be preceded by a "switched model" divider (ISSUE-081).
  const modelSwitches = useMemo(() => modelSwitchPoints(path), [path]);

  // One-line summary shown when the settings block is collapsed.
  const selectedModel = meta?.models.find((m) => m.id === model);
  const isLocal = selectedModel?.backend === "llama";
  const modelLabel = selectedModel?.label ?? model;
  const workflowLabel = meta?.workflows.find((w) => w.id === workflow)?.label ?? workflow;
  const topicLabel = meta?.topics.find((t) => t.id === topic)?.label ?? topic;
  const skillSummary = skillKind === "language_syntax" ? currentLanguage : `${topicLabel} · ${level}`;
  const settingsSummary = [modelLabel, workflowLabel, skillSummary].filter(Boolean).join(" · ");

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
          setSettingsOpen(false);
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
    setSettingsOpen(true);
    setAttachments([]);
    setPickerOpen(false);
    setPinnedFile(false);
    setPinnedOutput(false);
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
      setUsage(null);
      setPending({ user: opts.showUser, assistant: "", steps: [] });
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const skill: ChatSendRequest["skill"] =
        skillKind === "language_syntax"
          ? { kind: "language_syntax", language: currentLanguage }
          : { kind: "topic_roadmap", topic, level };

      // Only pinned chips are sent as context (Copilot-style); unpinned = focused only.
      let turnContext: AiContext | undefined;
      if (pinnedFile || pinnedOutput) {
        const live = collectContext();
        const ctx: AiContext = {};
        if (pinnedFile) {
          if (live.filename) ctx.filename = live.filename;
          if (live.language) ctx.language = live.language;
          if (live.code) ctx.code = live.code;
          if (live.selection) ctx.selection = live.selection;
        }
        if (pinnedOutput && live.runOutput) {
          ctx.runOutput = live.runOutput;
        }
        if (Object.keys(ctx).length > 0) turnContext = ctx;
      }

      const request: ChatSendRequest = {
        ...(threadId ? { threadId } : {}),
        model,
        workflow,
        skill,
        message: opts.message,
        ...(opts.parentId ? { parentId: opts.parentId } : {}),
        ...(opts.regenerate ? { regenerate: true } : {}),
        ...(isLocal && reasoningEffort !== "off" ? { reasoningEffort } : {}),
        ...(turnContext ? { context: turnContext } : {}),
        ...(attachments.length > 0 ? { attachments } : {})
      };

      aiApi
        .chatStream(request, {
          signal: controller.signal,
          onToken: (token) => setPending((p) => (p ? { ...p, assistant: p.assistant + token } : p)),
          onStep: (step) => setPending((p) => (p ? { ...p, steps: [...p.steps, step] } : p)),
          onError: (message) => setError(message),
          onDone: ({ threadId: id, usage: turnUsage }) => {
            setUsage(turnUsage ?? null);
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
      isLocal,
      reasoningEffort,
      pinnedFile,
      pinnedOutput,
      collectContext,
      attachments,
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

  // ISSUE-080: summarize the older part of the thread into one node, then clear
  // attachments/pins so the next turn carries far fewer tokens.
  const compact = useCallback(() => {
    if (!threadId || streaming || compacting) {
      return;
    }
    setError(null);
    setCompacting(true);
    aiApi
      .compactThread(threadId, model)
      .then((thread) => {
        setNodes(thread.nodes);
        setCurrentLeafId(thread.currentLeafId);
        setAttachments([]);
        setPinnedFile(false);
        setPinnedOutput(false);
        setUsage(null);
        setNotice("Đã thu gọn ngữ cảnh — tin cũ được tóm tắt, đính kèm đã gỡ.");
      })
      .catch((err) => {
        onAuthError(err);
        setError(err instanceof Error ? err.message : "Compact failed");
      })
      .finally(() => setCompacting(false));
  }, [threadId, streaming, compacting, model, onAuthError]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) {
      return;
    }
    const update = () => setComposerH(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const togglePicker = useCallback(() => {
    if (pickerOpen) {
      setPickerOpen(false);
      return;
    }
    listWorkspaceFiles()
      .then((entries) => {
        setPickerFiles(flattenFiles(entries));
        setPickerOpen(true);
      })
      .catch(onAuthError);
  }, [pickerOpen, listWorkspaceFiles, onAuthError]);

  const addAttachment = useCallback(
    (filePath: string) => {
      if (attachments.length >= MAX_AI_ATTACHMENTS || attachments.some((a) => a.path === filePath)) {
        return;
      }
      readWorkspaceFile(filePath)
        .then((content) => {
          setAttachments((prev) =>
            prev.length >= MAX_AI_ATTACHMENTS || prev.some((a) => a.path === filePath)
              ? prev
              : [...prev, { path: filePath, content: content.slice(0, MAX_AI_CONTEXT_BYTES) }]
          );
          setPickerOpen(false);
        })
        .catch(onAuthError);
    },
    [attachments, readWorkspaceFile, onAuthError]
  );

  const removeAttachment = useCallback((filePath: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== filePath));
  }, []);

  // Live editor context for the composer chips (current file + run output).
  const liveCtx = collectContext();
  const currentFileName = liveCtx.filename;
  const hasRunOutput = Boolean(liveCtx.runOutput);

  return (
    <aside className="ai-panel" aria-label="Chat AI">
      <header className="ai-panel-header">
        <span className="ai-panel-title">
          <Bot size={16} />
          <span>Chat AI</span>
        </span>
        <div className="ai-panel-header-actions">
          <button
            type="button"
            className={`ai-icon-btn${settingsOpen ? " is-active" : ""}`}
            title="Settings"
            aria-label="Settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings size={15} />
          </button>
          <button type="button" className="ai-icon-btn" title="New chat" aria-label="New chat" onClick={newThread}>
            <Plus size={15} />
          </button>
          <button type="button" className="ai-icon-btn" title="Close" aria-label="Close assistant" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </header>

      {settingsOpen && (
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
        {isLocal && (
          <label className="ai-field">
            <span>Reasoning effort</span>
            <select
              data-testid="ai-effort"
              value={reasoningEffort}
              onChange={(event) => setReasoningEffort(event.target.value as AiReasoningEffort)}
            >
              {AI_REASONING_EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
        )}

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
      )}

      {!settingsOpen && (
        <button
          type="button"
          className="ai-settings-summary"
          title="Show settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={13} />
          <span className="ai-settings-summary-text">{settingsSummary}</span>
        </button>
      )}

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

      <div
        className="ai-messages"
        ref={scrollRef}
        style={composerH ? { paddingBottom: composerH + 12 } : undefined}
      >
        {path.length === 0 && !pending && (
          <p className="ai-empty">Ask anything about programming, embedded or firmware — I&apos;ll teach in Vietnamese.</p>
        )}
        {path.map((node) => {
          const divider = modelSwitches.has(node.id) ? (
            <ModelDivider modelId={modelSwitches.get(node.id) ?? ""} models={meta?.models} />
          ) : null;

          if (node.kind === "summary") {
            return (
              <Fragment key={node.id}>
                {divider}
                <div className="ai-compaction-notice">
                  <span className="ai-compaction-title">
                    <Sparkles size={12} /> Ngữ cảnh đã thu gọn / Context compacted
                  </span>
                  <AssistantBody content={node.content} />
                </div>
              </Fragment>
            );
          }

          const sibs = siblings(nodes, node);
          const variantIndex = sibs.findIndex((s) => s.id === node.id);
          const isEditing = editing?.nodeId === node.id;
          return (
            <Fragment key={node.id}>
              {divider}
              <div className={`ai-message ai-${node.role}`}>
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
            </Fragment>
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
                    <AgentStepView
                      key={stepIndex}
                      step={step}
                      active={
                        streaming &&
                        stepIndex === pending.steps.length - 1 &&
                        step.kind === "tool_call"
                      }
                    />
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
        ref={composerRef}
        className="ai-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {notice && (
          <div className="ai-toast" role="status">
            {notice}
          </div>
        )}

        {(currentFileName || hasRunOutput || attachments.length > 0) && (
          <div className="ai-ctx-row">
            {currentFileName && (
              <button
                type="button"
                className={`ai-ctx-chip${pinnedFile ? " is-pinned" : ""}`}
                title={pinnedFile ? "Attached — click to detach" : "Focused only — click to attach"}
                onClick={() => setPinnedFile((v) => !v)}
              >
                <Paperclip size={11} />
                <span className="ai-ctx-chip-name">{currentFileName}</span>
              </button>
            )}
            {hasRunOutput && (
              <button
                type="button"
                className={`ai-ctx-chip${pinnedOutput ? " is-pinned" : ""}`}
                title={pinnedOutput ? "Output attached — click to detach" : "Click to attach run output"}
                onClick={() => setPinnedOutput((v) => !v)}
              >
                <Terminal size={11} />
                <span className="ai-ctx-chip-name">run output</span>
              </button>
            )}
            {attachments.map((file) => (
              <span key={file.path} className="ai-ctx-chip is-pinned" title={file.path}>
                <Paperclip size={11} />
                <span className="ai-ctx-chip-name">{file.path}</span>
                <button
                  type="button"
                  className="ai-ctx-chip-remove"
                  title="Remove attachment"
                  aria-label={`Remove ${file.path}`}
                  onClick={() => removeAttachment(file.path)}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="ai-capsule">
          <div className="ai-attach">
            <button
              type="button"
              className="ai-attach-btn"
              data-testid="ai-attach"
              title="Attach a workspace file"
              aria-label="Attach a workspace file"
              aria-expanded={pickerOpen}
              disabled={attachments.length >= MAX_AI_ATTACHMENTS}
              onClick={togglePicker}
            >
              <Paperclip size={15} />
            </button>
            {pickerOpen && (
              <div className="ai-attach-picker" role="listbox" aria-label="Workspace files">
                {pickerFiles.length === 0 ? (
                  <p className="ai-attach-empty">No workspace files.</p>
                ) : (
                  pickerFiles.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      className="ai-attach-option"
                      disabled={attachments.some((a) => a.path === file.path)}
                      title={file.path}
                      onClick={() => addAttachment(file.path)}
                    >
                      {file.path}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {usage && (
            <TokenRing
              usage={usage}
              busy={compacting}
              canCompact={Boolean(threadId) && !streaming && !compacting}
              onCompact={compact}
            />
          )}

          <textarea
            className="ai-input"
            value={input}
            placeholder="Ask the tutor…"
            rows={1}
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
        </div>
      </form>
    </aside>
  );
}

/**
 * Composer token meter (ISSUE-079): an SVG ring when the model reports a real
 * context window (`usage.contextSize`, local llama only) — colored across 10
 * levels by usage ratio — otherwise a neutral dot showing the raw token count.
 * Clicking it triggers the compact-context action (ISSUE-080).
 */
function TokenRing({
  usage,
  busy,
  canCompact,
  onCompact
}: {
  usage: AiUsage;
  busy: boolean;
  canCompact: boolean;
  onCompact: () => void;
}) {
  const used = usage.promptTokens + usage.completionTokens;
  const ctxWindow = usage.contextSize;
  const ratio = ctxWindow ? Math.min(1, used / ctxWindow) : 0;
  const pct = ctxWindow ? Math.round(ratio * 100) : null;
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const color = ctxWindow ? tokenRingColor(ratio) : "var(--text-muted)";
  const level = ctxWindow ? levelForRatio(ratio) : 0;

  return (
    <button
      type="button"
      className={`ai-token-ring${busy ? " is-busy" : ""}`}
      data-level={level}
      aria-label="Token usage — click to compact context"
      disabled={!canCompact}
      onClick={onCompact}
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        <circle className="ai-token-ring-track" cx="10" cy="10" r={radius} fill="none" strokeWidth="2.5" />
        {ctxWindow ? (
          <circle
            cx="10"
            cy="10"
            r={radius}
            fill="none"
            strokeWidth="2.5"
            stroke={color}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
            transform="rotate(-90 10 10)"
          />
        ) : (
          <circle cx="10" cy="10" r="2.5" fill="var(--text-muted)" />
        )}
      </svg>
      <span className="ai-ring-tip" role="tooltip">
        {pct !== null ? (
          <strong>Usage: {pct}%</strong>
        ) : (
          <strong>{used.toLocaleString()} tokens</strong>
        )}
        <span>
          Tokens: {used.toLocaleString()}
          {ctxWindow ? ` / ${ctxWindow.toLocaleString()}` : ""}
        </span>
        <span className="ai-ring-tip-hint">{busy ? "Đang thu gọn…" : "Bấm để thu gọn ngữ cảnh"}</span>
      </span>
    </button>
  );
}

/** Divider inserted in the transcript when the answering model changes (ISSUE-081). */
function ModelDivider({ modelId, models }: { modelId: string; models?: AiModelsResponse["models"] }) {
  const label = models?.find((item) => item.id === modelId)?.label ?? modelId;
  return (
    <div className="ai-model-divider" role="separator" aria-label={`Switched to ${label}`}>
      <ArrowLeftRight size={12} />
      <span>Đã chuyển sang model {label}</span>
    </div>
  );
}

/** Assistant reply: a collapsible Thinking block (if any) above the markdown answer. */
function AssistantBody({ content, streaming }: { content: string; streaming?: boolean }) {
  const { thinking, body, thinkingOpen } = splitThinking(content);
  return (
    <div className="ai-bubble">
      {thinking && (
        <details
          className={`ai-think${streaming && thinkingOpen ? " thinking-active" : ""}`}
          open={Boolean(streaming && thinkingOpen)}
        >
          <summary>Suy nghĩ / Thinking</summary>
          <div className="ai-think-body">{thinking}</div>
        </details>
      )}
      {body ? <AiMarkdown content={body} /> : <span className="ai-md-empty">…</span>}
    </div>
  );
}

/** Render one Antigravity agent activity item (code/tool/image/thought).
 *  `active` marks a tool_call that is still running (spins the wrench). */
function AgentStepView({ step, active }: { step: AiAgentStep; active?: boolean }) {
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
      <div className={`ai-step ai-step-tool${active ? " is-running" : ""}`}>
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
