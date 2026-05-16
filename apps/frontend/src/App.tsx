import Editor, { type OnMount } from "@monaco-editor/react";
import {
  Bug,
  ChevronRight,
  CircleStop,
  ListTree,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  StepForward,
  Terminal,
  Variable
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type TerminalLine = {
  stream: "stdout" | "stderr" | "system";
  text: string;
};

type WatchValue = {
  expression: string;
  value?: string;
  error?: string;
};

const initialLanguage = LANGUAGE_CAPABILITIES[0]!;

export function App() {
  const [language, setLanguage] = useState<Language>(initialLanguage.id);
  const [source, setSource] = useState(initialLanguage.defaultSource);
  const [stdin, setStdin] = useState("World\n");
  const [argvInput, setArgvInput] = useState("");
  const [breakpointText, setBreakpointText] = useState("");
  const [activeTab, setActiveTab] = useState<"output" | "debug">("output");
  const [runStatus, setRunStatus] = useState("Idle");
  const [debugStatus, setDebugStatus] = useState("Idle");
  const [output, setOutput] = useState<TerminalLine[]>([]);
  const [debugConsole, setDebugConsole] = useState<TerminalLine[]>([]);
  const [variables, setVariables] = useState<DebugVariable[]>([]);
  const [frames, setFrames] = useState<DebugFrame[]>([]);
  const [watches, setWatches] = useState<WatchValue[]>([]);
  const [watchInput, setWatchInput] = useState("");
  const [rawCommand, setRawCommand] = useState("");
  const [stoppedLine, setStoppedLine] = useState<number | undefined>();

  const clientIdRef = useRef(createClientId());
  const runSocket = useRef<WebSocket | null>(null);
  const runEvents = useRef<EventSource | null>(null);
  const debugSocket = useRef<WebSocket | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const decorationIds = useRef<string[]>([]);

  const capability = useMemo(
    () => LANGUAGE_CAPABILITIES.find((item) => item.id === language) ?? initialLanguage,
    [language]
  );
  const breakpoints = useMemo(() => parseBreakpointText(breakpointText), [breakpointText]);

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

  const sendDebug = useCallback((command: DebugCommand) => {
    if (debugSocket.current?.readyState === WebSocket.OPEN) {
      debugSocket.current.send(JSON.stringify(command));
    }
  }, []);

  const startRun = useCallback(async () => {
    stopSockets();
    setActiveTab("output");
    setOutput([]);
    setRunStatus("Starting");
    setStoppedLine(undefined);

    let argv: string[];
    try {
      argv = parseArgv(argvInput);
    } catch (error) {
      setRunStatus("Invalid arguments");
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
      appendOutput("system", `${messageFromError(error)}\n`);
    }
  }, [appendOutput, argvInput, language, source, stdin, stopSockets]);

  const startDebug = useCallback(async () => {
    if (!capability.debug) {
      return;
    }

    stopSockets();
    setActiveTab("debug");
    setDebugConsole([]);
    setVariables([]);
    setFrames([]);
    setWatches([]);
    setStoppedLine(undefined);
    setDebugStatus("Starting");

    if (breakpoints.length === 0) {
      setDebugStatus("No breakpoints");
      appendDebug("system", "No breakpoints set. Add a breakpoint before starting debug.\n");
      return;
    }

    let argv: string[];
    try {
      argv = parseArgv(argvInput);
    } catch (error) {
      setDebugStatus("Invalid arguments");
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
      socket.onclose = () => setDebugStatus((current) => (current === "Running" ? "Closed" : current));
      socket.onerror = () => setDebugStatus("Connection error");
    } catch (error) {
      setDebugStatus("Failed");
      appendDebug("system", `${messageFromError(error)}\n`);
    }
  }, [appendDebug, argvInput, breakpoints, capability.debug, language, source, stdin, stopSockets]);

  const handleRunEvent = useCallback(
    (event: RunEvent) => {
      if (event.type === "ready") {
        setRunStatus("Running");
        return;
      }
      if (event.type === "compile") {
        appendOutput("system", `compile ${event.status}\n`);
        return;
      }
      if (event.type === "run") {
        appendOutput("system", "run start\n");
        return;
      }
      if (event.type === "stdout" || event.type === "stderr") {
        appendOutput(event.type, event.data);
        return;
      }
      if (event.type === "exit") {
        runEvents.current?.close();
        runEvents.current = null;
        setRunStatus(event.timedOut ? "Timed out" : `Exited ${event.code ?? ""}`);
        appendOutput(
          "system",
          `\nprocess exited with code ${event.code ?? "unknown"}${event.timedOut ? " (timeout)" : ""}${
            event.outputTruncated ? " (output truncated)" : ""
          }\n`
        );
        return;
      }
      if (event.type === "error") {
        runEvents.current?.close();
        runEvents.current = null;
        setRunStatus("Error");
        appendOutput("system", `${event.message}\n`);
      }
    },
    [appendOutput]
  );

  const handleDebugEvent = useCallback(
    (event: DebugEvent) => {
      if (event.type === "ready") {
        setDebugStatus("Ready");
        return;
      }
      if (event.type === "compile") {
        appendDebug("system", `compile ${event.status}\n`);
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
        setDebugStatus(event.timedOut ? "Timed out" : "Exited");
        appendDebug("system", `\ndebug session exited${event.code === null ? "" : ` with code ${event.code}`}\n`);
        return;
      }
      if (event.type === "error") {
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

    decorationIds.current = editor.deltaDecorations(decorationIds.current, [
      ...breakpoints.map((line) => ({
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Terminal size={20} />
          <span>Internal Code Runner</span>
        </div>
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
        <button type="button" className="primary" onClick={startRun} title="Run">
          <Play size={16} />
          <span>Run</span>
        </button>
        <button type="button" onClick={startDebug} disabled={!capability.debug} title="Debug">
          <Bug size={16} />
          <span>Debug</span>
        </button>
        <button type="button" onClick={stopSockets} title="Stop">
          <CircleStop size={16} />
        </button>
        <span className="status-pill">{activeTab === "debug" ? debugStatus : runStatus}</span>
      </header>

      <main className="workspace">
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

        <section className="bottom-panel">
          <div className="input-card">
            <label htmlFor="stdin">stdin</label>
            <textarea id="stdin" value={stdin} onChange={(event) => setStdin(event.target.value)} spellCheck={false} />
            <label htmlFor="breakpoints">breakpoints</label>
            <input
              id="breakpoints"
              value={breakpointText}
              onChange={(event) => setBreakpointText(event.target.value)}
              placeholder="e.g. 6, 12"
            />
          </div>

          <div className="result-card">
            <div className="tabbar">
              <button className={activeTab === "output" ? "selected" : ""} onClick={() => setActiveTab("output")}>
                Output
              </button>
              <button className={activeTab === "debug" ? "selected" : ""} onClick={() => setActiveTab("debug")}>
                Debug
              </button>
            </div>

            {activeTab === "output" ? (
              <TerminalView lines={output} />
            ) : (
              <div className="debug-grid">
                <div className="debug-toolbar">
                  <button onClick={() => sendDebug({ type: "continue" })} title="Continue">
                    <ChevronRight size={15} />
                  </button>
                  <button onClick={() => sendDebug({ type: "pause" })} title="Pause">
                    <Pause size={15} />
                  </button>
                  <button onClick={() => sendDebug({ type: "stepOver" })} title="Step over">
                    <StepForward size={15} />
                  </button>
                  <button onClick={() => sendDebug({ type: "stepInto" })} title="Step into">
                    <SkipForward size={15} />
                  </button>
                  <button onClick={() => sendDebug({ type: "stepOut" })} title="Step out">
                    <RotateCcw size={15} />
                  </button>
                  <button onClick={() => sendDebug({ type: "variables" })} title="Variables">
                    <Variable size={15} />
                  </button>
                  <button onClick={() => sendDebug({ type: "stack" })} title="Stack">
                    <ListTree size={15} />
                  </button>
                  <button onClick={() => sendDebug({ type: "stop" })} title="Stop">
                    <CircleStop size={15} />
                  </button>
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
