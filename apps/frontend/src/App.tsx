import Editor, { type OnMount } from "@monaco-editor/react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bug,
  ChevronDown,
  ChevronUp,
  CircleX,
  ListTree,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Square,
  Terminal,
  TriangleAlert,
  Variable
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  LANGUAGE_CAPABILITIES,
  parseArgv,
  type DebugCommand,
  type DebugEvent,
  type DebugFrame,
  type DebugVariable,
  type Language,
  type RunEvent
} from "@internal/shared";
import { parseBreakpointText, toggleBreakpointText } from "./breakpoints";
import { isCompilerDiagnosticContext, parseCompilerDiagnostics, type Diagnostic } from "./diagnostics";
import { formatRunMetric } from "./runMetrics";

type TerminalLine = {
  stream: "stdout" | "stderr" | "system";
  text: string;
};

type ActiveTab = "output" | "errors" | "debug";
type RunPhase = "idle" | "compile" | "run";

type WatchValue = {
  expression: string;
  value?: string;
  error?: string;
};

const initialLanguage = LANGUAGE_CAPABILITIES[0]!;

export function App() {
  const [language, setLanguage] = useState<Language>(initialLanguage.id);
  const [source, setSource] = useState(initialLanguage.defaultSource);
  const [stdin, setStdin] = useState("");
  const [argvInput, setArgvInput] = useState("");
  const [breakpointText, setBreakpointText] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("output");
  const [runStatus, setRunStatus] = useState("Idle");
  const [debugStatus, setDebugStatus] = useState("Idle");
  const [output, setOutput] = useState<TerminalLine[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [debugConsole, setDebugConsole] = useState<TerminalLine[]>([]);
  const [variables, setVariables] = useState<DebugVariable[]>([]);
  const [frames, setFrames] = useState<DebugFrame[]>([]);
  const [watches, setWatches] = useState<WatchValue[]>([]);
  const [watchInput, setWatchInput] = useState("");
  const [rawCommand, setRawCommand] = useState("");
  const [stoppedLine, setStoppedLine] = useState<number | undefined>();
  const [isRunActive, setIsRunActive] = useState(false);
  const [isDebugActive, setIsDebugActive] = useState(false);
  const [runElapsed, setRunElapsed] = useState(0);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [editorHeight, setEditorHeight] = useState(58);
  const [isDragging, setIsDragging] = useState(false);
  const [isBottomCollapsed, setIsBottomCollapsed] = useState(false);

  const clientIdRef = useRef(createClientId());
  const workspaceRef = useRef<HTMLElement | null>(null);
  const runSocket = useRef<WebSocket | null>(null);
  const runEvents = useRef<EventSource | null>(null);
  const runPhaseRef = useRef<RunPhase>("idle");
  const runLanguageRef = useRef<Language>(initialLanguage.id);
  const debugSocket = useRef<WebSocket | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const decorationIds = useRef<string[]>([]);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const capability = useMemo(
    () => LANGUAGE_CAPABILITIES.find((item) => item.id === language) ?? initialLanguage,
    [language]
  );
  const breakpoints = useMemo(() => parseBreakpointText(breakpointText), [breakpointText]);

  const isDebugRunning = isDebugActive && debugStatus === "Running";
  const isDebugStopped = isDebugActive && debugStatus !== "Running" && debugStatus !== "Starting";

  const statusClass = useMemo(() => {
    const status = activeTab === "debug" ? debugStatus : runStatus;
    if (status === "Idle") return "";
    if (status === "Starting") return "status-starting";
    if (status === "Running" || status.startsWith("Running ")) return "status-running";
    if (status.startsWith("Exited 0")) return "status-success";
    if (status.startsWith("Exited ")) return "status-error";
    if (status === "Error" || status === "Failed") return "status-error";
    if (status === "Timed out") return "status-warning";
    if (status === "Stopped") return "status-stopped";
    if (/breakpoint|Stopped/i.test(status)) return "status-breakpoint";
    return "";
  }, [activeTab, debugStatus, runStatus]);

  const appendOutput = useCallback((stream: TerminalLine["stream"], text: string) => {
    setOutput((current) => [...current, { stream, text }]);
  }, []);

  const appendDebug = useCallback((stream: TerminalLine["stream"], text: string) => {
    setDebugConsole((current) => [...current, { stream, text }]);
  }, []);

  const stopSockets = useCallback(() => {
    runSocket.current?.close();
    runEvents.current?.close();
    debugSocket.current?.close();
    runSocket.current = null;
    runEvents.current = null;
    debugSocket.current = null;
  }, []);

  const handleStop = useCallback(() => {
    const stoppingRun = runSocket.current !== null || runEvents.current !== null;
    const stoppingDebug = debugSocket.current !== null;
    if (stoppingDebug && debugSocket.current?.readyState === WebSocket.OPEN) {
      try {
        debugSocket.current.send(JSON.stringify({ type: "stop" }));
      } catch {
        // Runner ws-close handler sẽ cleanup nếu send fail
      }
    }
    stopSockets();
    if (stoppingRun) {
      setRunStatus("Stopped");
      setIsRunActive(false);
      appendOutput("system", "\nStopped by user\n");
    }
    if (stoppingDebug) {
      setDebugStatus("Stopped");
      setIsDebugActive(false);
      appendDebug("system", "\nStopped by user\n");
    }
  }, [appendDebug, appendOutput, stopSockets]);

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setIsDragging(true);
    let lastRun = 0;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const now = Date.now();
      if (now - lastRun < 16) return;
      lastRun = now;
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      setEditorHeight(Math.min(85, Math.max(20, pct)));
    };

    const onMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      setTimeout(() => editorRef.current?.layout(), 50);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  const sendDebug = useCallback((command: DebugCommand) => {
    if (debugSocket.current?.readyState === WebSocket.OPEN) {
      debugSocket.current.send(JSON.stringify(command));
    }
  }, []);

  const startDebugRef = useRef<() => Promise<void>>(async () => {});

  const handleRestart = useCallback(async () => {
    if (!isDebugActive) return;
    setIsMoreMenuOpen(false);
    handleStop();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await startDebugRef.current();
  }, [isDebugActive, handleStop]);

  const jumpToDiagnostic = useCallback((diagnostic: Diagnostic) => {
    if (!diagnostic.line) {
      return;
    }

    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    editor.revealLineInCenter(diagnostic.line);
    editor.setPosition({ lineNumber: diagnostic.line, column: diagnostic.column ?? 1 });
  }, []);

  const appendRunStderr = useCallback(
    (data: string) => {
      const shouldParseDiagnostics = runPhaseRef.current === "compile" && runLanguageRef.current !== "python";

      if (!shouldParseDiagnostics) {
        appendOutput("stderr", data);
        return;
      }

      const parsed = parseCompilerDiagnostics(data);
      if (parsed.length > 0) {
        setDiagnostics((current) => [...current, ...parsed]);
        setActiveTab("errors");
        return;
      }

      if (!isCompilerDiagnosticContext(data)) {
        appendOutput("stderr", data);
      }
    },
    [appendOutput]
  );

  const startRun = useCallback(async () => {
    stopSockets();
    setIsRunActive(true);
    setIsDebugActive(false);
    setActiveTab("output");
    setOutput([]);
    setDiagnostics([]);
    setRunStatus("Starting");
    setStoppedLine(undefined);
    runPhaseRef.current = "idle";
    runLanguageRef.current = language;

    let argv: string[];
    try {
      argv = parseArgv(argvInput);
    } catch (error) {
      setRunStatus("Invalid arguments");
      setIsRunActive(false);
      appendOutput("system", `${messageFromError(error)}\n`);
      return;
    }

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language, source, stdin, argv })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const { id } = (await response.json()) as { id: string };
      const events = new EventSource(`/api/run/${id}/events`);
      runEvents.current = events;

      events.onmessage = (event) => handleRunEvent(JSON.parse(event.data) as RunEvent);
      events.onerror = () => {
        if (runEvents.current !== events) {
          return;
        }

        setRunStatus("Connection error");
        appendOutput("system", "event stream connection failed\n");
        events.close();
        runEvents.current = null;
      };
    } catch (error) {
      setRunStatus("Failed");
      setIsRunActive(false);
      appendOutput("system", `${messageFromError(error)}\n`);
    }
  }, [appendOutput, argvInput, language, source, stdin, stopSockets]);

  const startDebug = useCallback(async () => {
    if (!capability.debug) {
      return;
    }

    stopSockets();
    setIsDebugActive(true);
    setIsRunActive(false);
    setActiveTab("debug");
    setDebugConsole([]);
    setVariables([]);
    setFrames([]);
    setWatches([]);
    setStoppedLine(undefined);
    setDebugStatus("Starting");

    if (breakpoints.length === 0) {
      setDebugStatus("No breakpoints");
      setIsDebugActive(false);
      appendDebug("system", "No breakpoints set. Add a breakpoint before starting debug.\n");
      return;
    }

    const lineCount = editorRef.current?.getModel()?.getLineCount() ?? 0;
    if (lineCount > 0 && breakpoints.some((line) => line > lineCount)) {
      const invalid = breakpoints.filter((line) => line > lineCount);
      setDebugStatus("Invalid breakpoints");
      setIsDebugActive(false);
      appendDebug("system", `Breakpoints out of range: lines ${invalid.join(", ")} (file has ${lineCount} lines)\n`);
      return;
    }

    let argv: string[];
    try {
      argv = parseArgv(argvInput);
    } catch (error) {
      setDebugStatus("Invalid arguments");
      setIsDebugActive(false);
      appendDebug("system", `${messageFromError(error)}\n`);
      return;
    }

    try {
      const response = await fetch("/api/debug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language,
          source,
          stdin,
          argv,
          breakpoints,
          clientId: clientIdRef.current
        })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const { id } = (await response.json()) as { id: string };
      const socket = new WebSocket(wsUrl(`/api/debug/${id}`));
      debugSocket.current = socket;

      socket.onmessage = (event) => handleDebugEvent(JSON.parse(event.data) as DebugEvent);
      socket.onclose = () => setDebugStatus((current) => (current === "Running" || current === "Starting") ? "Closed" : current);
      socket.onerror = () => setDebugStatus("Connection error");
    } catch (error) {
      setDebugStatus("Failed");
      setIsDebugActive(false);
      appendDebug("system", `${messageFromError(error)}\n`);
    }
  }, [appendDebug, argvInput, breakpoints, capability.debug, language, source, stdin, stopSockets]);

  useEffect(() => {
    startDebugRef.current = startDebug;
  }, [startDebug]);

  useEffect(() => {
    if (!isMoreMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMoreMenuOpen]);

  const handleRunEvent = useCallback(
    (event: RunEvent) => {
      if (event.type === "ready") {
        setRunStatus("Running");
        return;
      }
      if (event.type === "compile") {
        runPhaseRef.current = event.status === "start" ? "compile" : "idle";
        appendOutput("system", event.status === "start" ? "⟳ Compiling...\n" : "✓ Compiled\n");
        return;
      }
      if (event.type === "run") {
        runPhaseRef.current = "run";
        appendOutput("system", "▶ Running\n");
        return;
      }
      if (event.type === "stdout") {
        appendOutput("stdout", event.data);
        return;
      }
      if (event.type === "stderr") {
        appendRunStderr(event.data);
        return;
      }
      if (event.type === "metric") {
        appendOutput("system", `${formatRunMetric(event)}\n`);
        return;
      }
      if (event.type === "exit") {
        runEvents.current?.close();
        runEvents.current = null;
        runPhaseRef.current = "idle";
        setIsRunActive(false);
        setRunStatus(event.timedOut ? "Timed out" : `Exited ${event.code ?? ""}`);
        const truncatedSuffix = event.outputTruncated ? " (output truncated)" : "";
        if (event.timedOut) {
          appendOutput("system", `\n⚠ Timed out${truncatedSuffix}\n`);
        } else if (event.code === 0) {
          appendOutput("system", `\n✓ Finished${truncatedSuffix}\n`);
        } else {
          appendOutput("system", `\n✗ Exited with code ${event.code ?? "unknown"}${truncatedSuffix}\n`);
        }
        return;
      }
      if (event.type === "error") {
        runEvents.current?.close();
        runEvents.current = null;
        runPhaseRef.current = "idle";
        setIsRunActive(false);
        setRunStatus("Error");
        appendOutput("system", `${event.message}\n`);
      }
    },
    [appendOutput, appendRunStderr]
  );

  const handleDebugEvent = useCallback(
    (event: DebugEvent) => {
      if (event.type === "ready") {
        setDebugStatus("Ready");
        return;
      }
      if (event.type === "compile") {
        appendDebug("system", event.status === "start" ? "⟳ Compiling...\n" : "✓ Compiled\n");
        return;
      }
      if (event.type === "stdout" || event.type === "stderr" || event.type === "console") {
        appendDebug(event.type === "stderr" ? "stderr" : "stdout", event.data);
        return;
      }
      if (event.type === "running") {
        setDebugStatus("Running");
        return;
      }
      if (event.type === "stopped") {
        setDebugStatus(event.reason ?? "Stopped");
        setStoppedLine(event.line);
        if (event.line) {
          editorRef.current?.revealLineInCenter(event.line);
        }
        return;
      }
      if (event.type === "variables") {
        setVariables(event.variables);
        return;
      }
      if (event.type === "stack") {
        setFrames(event.frames);
        return;
      }
      if (event.type === "watch") {
        setWatches((current) => [
          ...current.filter((watch) => watch.expression !== event.expression),
          { expression: event.expression, value: event.value, error: event.error }
        ]);
        return;
      }
      if (event.type === "exit") {
        setIsDebugActive(false);
        setDebugStatus(event.timedOut ? "Timed out" : "Exited");
        appendDebug("system", `\ndebug session exited${event.code === null ? "" : ` with code ${event.code}`}\n`);
        return;
      }
      if (event.type === "error") {
        setIsDebugActive(false);
        setDebugStatus("Error");
        appendDebug("system", `${event.message}\n`);
      }
    },
    [appendDebug]
  );

  const onEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS || !event.target.position) {
        return;
      }

      const line = event.target.position.lineNumber;
      setBreakpointText((current) => toggleBreakpointText(current, line));
    });
  };

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      return;
    }

    const lineCount = editor.getModel()?.getLineCount() ?? Infinity;
    const validBreakpoints = breakpoints.filter((line) => line <= lineCount);
    decorationIds.current = editor.deltaDecorations(decorationIds.current, [
      ...validBreakpoints.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: "breakpoint-glyph"
        }
      })),
      ...(stoppedLine
        ? [
            {
              range: new monaco.Range(stoppedLine, 1, stoppedLine, 1),
              options: {
                isWholeLine: true,
                className: "current-debug-line"
              }
            }
          ]
        : [])
    ]);
  }, [breakpoints, stoppedLine]);

  useEffect(() => () => stopSockets(), [stopSockets]);

  useEffect(() => {
    if (!isRunActive) {
      setRunElapsed(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setRunElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunActive]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1 className="brand">
          <div className="brand-icon">
            <Terminal size={18} />
          </div>
          <span className="brand-text">Internal Code Runner</span>
        </h1>
        <select
          aria-label="Language"
          value={language}
          onChange={(event) => {
            const next = event.target.value as Language;
            setLanguage(next);
            setSource(LANGUAGE_CAPABILITIES.find((item) => item.id === next)?.defaultSource ?? "");
            setStoppedLine(undefined);
          }}
        >
          {LANGUAGE_CAPABILITIES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Arguments"
          className="args-input"
          value={argvInput}
          placeholder="argv"
          onChange={(event) => setArgvInput(event.target.value)}
        />
        <button type="button" className="primary" onClick={startRun} disabled={isRunActive || isDebugActive} title="Run">
          <Play size={16} />
          <span>Run</span>
        </button>
        <button type="button" data-testid="btn-debug" onClick={startDebug} disabled={isRunActive || isDebugActive || !capability.debug} title="Debug">
          <Bug size={16} />
          <span>Debug</span>
        </button>
        <button type="button" data-testid="btn-topbar-stop" onClick={handleStop} disabled={!isRunActive && !isDebugActive} title="Stop">
          <Square size={16} fill="currentColor" />
        </button>
        <span className={`status-pill ${statusClass}${isRunActive && runElapsed >= 3 ? " running-long" : ""}`}>
          {activeTab === "debug"
            ? debugStatus
            : isRunActive && runElapsed >= 3
              ? `Running ${runElapsed}s…`
              : runStatus}
        </span>
      </header>

      <main
        className={`workspace ${isBottomCollapsed ? "bottom-collapsed" : ""}`}
        ref={workspaceRef}
        style={{ "--editor-height": `${editorHeight}%` } as CSSProperties}
      >
        <section className="editor-panel">
          <Editor
            height="100%"
            language={language === "cpp" ? "cpp" : language}
            theme="vs-dark"
            value={source}
            onChange={(value) => setSource(value ?? "")}
            onMount={onEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbersMinChars: 4,
              glyphMargin: true,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 4
            }}
          />
        </section>

        <div
          className={`resize-handle ${isDragging ? "dragging" : ""}`}
          onMouseDown={startResize}
          onDoubleClick={() => setEditorHeight(58)}
        >
          <button
            type="button"
            className="collapse-toggle"
            onClick={() => setIsBottomCollapsed((prev) => !prev)}
            aria-label={isBottomCollapsed ? "Expand panel" : "Collapse panel"}
            title={isBottomCollapsed ? "Expand panel" : "Collapse panel"}
          >
            {isBottomCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        <section className="bottom-panel">
          <div className="input-card">
            <label htmlFor="stdin">stdin</label>
            <textarea id="stdin" value={stdin} onChange={(event) => setStdin(event.target.value)} spellCheck={false} />
            <label>breakpoints</label>
            <div className="breakpoint-info">
              <input
                id="breakpoints"
                type="text"
                className="sr-only"
                aria-label="breakpoints"
                value={breakpointText}
                onChange={(event) => setBreakpointText(event.target.value)}
              />
              <span className="breakpoint-count">
                {breakpoints.length} breakpoint{breakpoints.length !== 1 ? "s" : ""} set — click the gutter to toggle
              </span>
              {breakpoints.length > 0 && (
                <button type="button" className="breakpoint-clear" onClick={() => setBreakpointText("")} title="Clear all breakpoints">
                  Clear all
                </button>
              )}
            </div>
          </div>

          <div className="result-card">
            <div className="tabbar">
              <button className={activeTab === "output" ? "selected" : ""} onClick={() => setActiveTab("output")}>
                <Terminal size={14} />
                <span>Output</span>
              </button>
              <button className={activeTab === "errors" ? "selected" : ""} onClick={() => setActiveTab("errors")}>
                <CircleX size={14} />
                <span>Error List</span>
                {diagnostics.length > 0 && <span className="tab-badge">{diagnostics.length}</span>}
              </button>
              <button className={activeTab === "debug" ? "selected" : ""} onClick={() => setActiveTab("debug")}>
                <Bug size={14} />
                <span>Debug</span>
              </button>
            </div>

            {activeTab === "output" && (
              <TerminalView lines={output} />
            )}
            {activeTab === "errors" && (
              <DiagnosticsPanel diagnostics={diagnostics} onSelect={jumpToDiagnostic} />
            )}
            {activeTab === "debug" && (
              <div className="debug-grid">
                <div className="debug-toolbar">
                  <div className="debug-group">
                    {isDebugRunning ? (
                      <button aria-label="Pause" onClick={() => sendDebug({ type: "pause" })} title="Pause">
                        <Pause size={15} fill="currentColor" />
                      </button>
                    ) : (
                      <button aria-label="Continue" disabled={!isDebugStopped} onClick={() => sendDebug({ type: "continue" })} title="Continue">
                        <Play size={15} fill="currentColor" />
                      </button>
                    )}
                  </div>
                  <div className="debug-group">
                    <button aria-label="Step over" disabled={!isDebugStopped} onClick={() => sendDebug({ type: "stepOver" })} title="Step over">
                      <SkipForward size={15} fill="currentColor" />
                    </button>
                    <button aria-label="Step into" disabled={!isDebugStopped} onClick={() => sendDebug({ type: "stepInto" })} title="Step into">
                      <ArrowDownToLine size={15} />
                    </button>
                    <button aria-label="Step out" disabled={!isDebugStopped} onClick={() => sendDebug({ type: "stepOut" })} title="Step out">
                      <ArrowUpFromLine size={15} />
                    </button>
                  </div>
                  <div className="debug-group">
                    <button aria-label="Restart" disabled={!isDebugActive} onClick={handleRestart} title="Restart">
                      <RotateCcw size={15} />
                    </button>
                    <button aria-label="Stop" disabled={!isDebugActive} onClick={() => sendDebug({ type: "stop" })} title="Stop">
                      <Square size={15} fill="currentColor" className="icon-stop" />
                    </button>
                  </div>
                  <div className="debug-group debug-more" ref={moreMenuRef}>
                    <button
                      aria-label="More"
                      aria-haspopup="menu"
                      aria-expanded={isMoreMenuOpen}
                      disabled={!isDebugActive}
                      onClick={() => setIsMoreMenuOpen((open) => !open)}
                      title="More"
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    {isMoreMenuOpen && (
                      <div className="debug-more-menu" role="menu">
                        <button
                          role="menuitem"
                          disabled={!isDebugStopped}
                          onClick={() => {
                            sendDebug({ type: "variables" });
                            setIsMoreMenuOpen(false);
                          }}
                        >
                          <Variable size={14} />
                          <span>Variables</span>
                        </button>
                        <button
                          role="menuitem"
                          disabled={!isDebugStopped}
                          onClick={() => {
                            sendDebug({ type: "stack" });
                            setIsMoreMenuOpen(false);
                          }}
                        >
                          <ListTree size={14} />
                          <span>Call Stack</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <TerminalView lines={debugConsole} compact />

                <div className="inspectors">
                  <Inspector title="Variables" empty="No variables" rows={variables.map((item) => [item.name, item.value ?? ""])} />
                  <Inspector
                    title="Call Stack"
                    empty="No frames"
                    rows={frames.map((frame) => [
                      `#${frame.level}`,
                      `${frame.func}${frame.line ? `:${frame.line}` : ""}`
                    ])}
                  />
                  <Inspector
                    title="Watches"
                    empty="No watches"
                    rows={watches.map((watch) => [watch.expression, watch.error ?? watch.value ?? ""])}
                  />
                </div>

                <form
                  className="debug-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!watchInput.trim()) {
                      return;
                    }
                    sendDebug({ type: "evaluate", expression: watchInput.trim() });
                    setWatchInput("");
                  }}
                >
                  <input value={watchInput} onChange={(event) => setWatchInput(event.target.value)} placeholder="watch" />
                  <button type="submit">Eval</button>
                </form>

                <form
                  className="debug-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!rawCommand.trim()) {
                      return;
                    }
                    sendDebug({ type: "raw", command: rawCommand.trim() });
                    setRawCommand("");
                  }}
                >
                  <input value={rawCommand} onChange={(event) => setRawCommand(event.target.value)} placeholder="debug console" />
                  <button type="submit">Send</button>
                </form>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function DiagnosticsPanel({ diagnostics, onSelect }: { diagnostics: Diagnostic[]; onSelect: (diagnostic: Diagnostic) => void }) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");

  if (diagnostics.length === 0) {
    return (
      <div className="diagnostics-panel">
        <p className="diagnostic-empty">No errors or warnings</p>
      </div>
    );
  }

  return (
    <div className="diagnostics-panel">
      <DiagnosticSection title="Errors" severity="error" diagnostics={errors} onSelect={onSelect} />
      <DiagnosticSection title="Warnings" severity="warning" diagnostics={warnings} onSelect={onSelect} />
    </div>
  );
}

function DiagnosticSection({
  title,
  severity,
  diagnostics,
  onSelect
}: {
  title: string;
  severity: Diagnostic["severity"];
  diagnostics: Diagnostic[];
  onSelect: (diagnostic: Diagnostic) => void;
}) {
  const Icon = severity === "error" ? CircleX : TriangleAlert;

  return (
    <section className="diagnostic-section">
      <h2>
        <span className={`diagnostic-icon ${severity}`}>
          <Icon size={16} />
        </span>
        {title}
        <span className="diagnostic-count">{diagnostics.length}</span>
      </h2>
      {diagnostics.length === 0 ? (
        <p className="diagnostic-empty">None</p>
      ) : (
        diagnostics.map((diagnostic, index) => (
          <button
            type="button"
            className="diagnostic-row"
            key={`${diagnostic.raw}-${index}`}
            onClick={() => onSelect(diagnostic)}
            disabled={!diagnostic.line}
          >
            <span className={`diagnostic-icon ${severity}`}>
              <Icon size={15} />
            </span>
            <span className="diagnostic-message">{diagnostic.message}</span>
            <span className="diagnostic-location">{formatDiagnosticLocation(diagnostic)}</span>
          </button>
        ))
      )}
    </section>
  );
}

function TerminalView({ lines, compact = false }: { lines: TerminalLine[]; compact?: boolean }) {
  return (
    <pre className={compact ? "terminal compact" : "terminal"} aria-live="polite">
      {lines.map((line, index) => (
        <span key={`${index}-${line.stream}`} className={`stream-${line.stream}`}>
          {line.text}
        </span>
      ))}
    </pre>
  );
}

function Inspector({ title, empty, rows }: { title: string; empty: string; rows: string[][] }) {
  return (
    <section className="inspector">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p>{empty}</p>
      ) : (
        rows.map(([name, value]) => (
          <div className="kv-row" key={`${title}-${name}`}>
            <span>{name}</span>
            <code>{value}</code>
          </div>
        ))
      )}
    </section>
  );
}

function formatDiagnosticLocation(diagnostic: Diagnostic): string {
  const file = diagnostic.file?.replace(/^\/workspace\//, "") ?? "source";
  if (!diagnostic.line) {
    return file;
  }

  return `${file}:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ""}`;
}

function wsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error ?? text;
  } catch {
    return text || response.statusText;
  }
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function createClientId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
