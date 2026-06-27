import Editor, { type OnMount } from "@monaco-editor/react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bug,
  ChevronRight,
  CircleX,
  GraduationCap,
  ListTree,
  LogIn,
  LogOut,
  PanelLeft,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  Square,
  Terminal,
  TriangleAlert,
  Variable
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  LANGUAGE_CAPABILITIES,
  LANGUAGE_EXTENSIONS,
  defaultFileName,
  fileExtension,
  parseArgv,
  type Breakpoint,
  type AiContext,
  type DebugCommand,
  type DebugEvent,
  type DebugFrame,
  type DebugVariable,
  type Language,
  type ProjectFile,
  type RunEvent,
  type TreeNode
} from "@internal/shared";
import { parseBreakpointText, toggleBreakpointText } from "./breakpoints";
import {
  registerSuggestions,
  languageHasSuggestions,
  supportsSuggestionToggle,
  disableJavascriptWorkerCompletions
} from "./langCompletions";
import { parseCompilerDiagnostics, type Diagnostic } from "./diagnostics";
import { AiPanel } from "./AiPanel";
import { Explorer } from "./Explorer";
import { FileTabs, type TabMeta } from "./FileTabs";
import { AuthExpiredError, authApi, filesApi } from "./filesApi";
import { LoginDialog } from "./LoginDialog";
import { formatRunMetric } from "./runMetrics";
import { baseOf, dirOf, gatherFolderRun } from "./runGather";
import {
  duplicateName,
  hasDirtyServerTab,
  isServerFolderRun,
  pathExistsInTree,
  remapKeys,
  remapPath,
  resolveStopped,
  savableScratch,
  type DebugFileMap
} from "./serverPaths";

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
  // Selected toolchain version for languages that expose one (e.g. Java JDK).
  // undefined ⇒ no picker / runner uses the capability default.
  const [toolchainVersion, setToolchainVersion] = useState<string | undefined>(initialLanguage.defaultVersion);
  const [files, setFiles] = useState<ProjectFile[]>(() => [
    { path: defaultFileName(initialLanguage.id), content: initialLanguage.defaultSource }
  ]);
  const [activePath, setActivePath] = useState(() => defaultFileName(initialLanguage.id));
  const [stdin, setStdin] = useState("");
  const [argvInput, setArgvInput] = useState("");
  const [breakpointsByPath, setBreakpointsByPath] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<ActiveTab>("output");
  const [runStatus, setRunStatus] = useState("Idle");
  const [debugStatus, setDebugStatus] = useState("Idle");
  // True only between a real `stopped` event and the next resume/exit. Drives the
  // step/continue controls — `Ready` is NOT stopped, so they stay disabled until the
  // adapter actually halts (otherwise an early click hits a running adapter → notStopped,
  // ISSUE-060).
  const [debugStopped, setDebugStopped] = useState(false);
  const [output, setOutput] = useState<TerminalLine[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [debugConsole, setDebugConsole] = useState<TerminalLine[]>([]);
  const [variables, setVariables] = useState<DebugVariable[]>([]);
  const [expandedRefs, setExpandedRefs] = useState<Set<number>>(() => new Set());
  const [childrenByRef, setChildrenByRef] = useState<Record<number, DebugVariable[]>>({});
  const [frames, setFrames] = useState<DebugFrame[]>([]);
  const [watches, setWatches] = useState<WatchValue[]>([]);
  const [watchInput, setWatchInput] = useState("");
  const [rawCommand, setRawCommand] = useState("");
  const [stoppedLine, setStoppedLine] = useState<number | undefined>();
  const [stoppedPath, setStoppedPath] = useState<string | undefined>();
  const [isRunActive, setIsRunActive] = useState(false);
  const [isDebugActive, setIsDebugActive] = useState(false);
  const [runElapsed, setRunElapsed] = useState(0);
  const [debugPanelTab, setDebugPanelTab] = useState<"variables" | "stack">("variables");
  const [editorHeight, setEditorHeight] = useState(58);
  const [isDragging, setIsDragging] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(30);
  const [isDraggingX, setIsDraggingX] = useState(false);
  const [variablesHeight, setVariablesHeight] = useState<number | undefined>(undefined);
  const [isDraggingVSplit, setIsDraggingVSplit] = useState(false);
  // Advanced C/C++ suggestions switch — default ON, not persisted (always ON on
  // load). `monacoReady` flips on editor mount so the registration effect re-runs
  // (monacoRef alone doesn't trigger a render).
  const [suggestEnabled, setSuggestEnabled] = useState(true);
  const [monacoReady, setMonacoReady] = useState(false);

  // --- Accounts + file explorer (Phase 2) ---------------------------------
  const [user, setUser] = useState<string | null>(null);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [showLogin, setShowLogin] = useState(false);
  // Presence of a path here marks it as a server-backed (explorer) tab; the
  // value is the last-saved content, so dirty = current content !== savedContent.
  const [serverTabs, setServerTabs] = useState<Record<string, { savedContent: string }>>({});

  const clientIdRef = useRef(createClientId());
  const workspaceRef = useRef<HTMLElement | null>(null);
  const contentAreaRef = useRef<HTMLDivElement | null>(null);
  const runSocket = useRef<WebSocket | null>(null);
  const runEvents = useRef<EventSource | null>(null);
  const runIdRef = useRef<string | null>(null);
  const runPhaseRef = useRef<RunPhase>("idle");
  const runLanguageRef = useRef<Language>(initialLanguage.id);
  const compileWarningsRef = useRef(0);
  const compileErrorsRef = useRef(0);
  const debugSocket = useRef<WebSocket | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const decorationIdsByPath = useRef<Record<string, string[]>>({});
  const activePathRef = useRef(activePath);
  const filesRef = useRef(files);
  const serverTabsRef = useRef(serverTabs);
  // Basename → server path/content for the folder of the active server debug run;
  // lets a stop in a secondary file activate the right tab (ISSUE-052).
  const debugFileMapRef = useRef<DebugFileMap>(new Map());
  // Set by "Run/Debug this file" to override the folder + entrypoint + language
  // for one dispatch (read by buildRunPayload/startRun/startDebug, then cleared).
  // Decoupled from React state so the override is correct even before the
  // setActivePath/setLanguage it triggers have re-rendered.
  const runTargetRef = useRef<{ path: string; language: Language; entrypoint?: string } | null>(null);

  const capability = useMemo(
    () => LANGUAGE_CAPABILITIES.find((item) => item.id === language) ?? initialLanguage,
    [language]
  );
  // Logged-in users always get the tab bar (server files of any language live in
  // tabs); anonymous behavior is unchanged (tabs hidden for single-buffer Python).
  const showTabs = user !== null || language !== "python";
  const activeFile = useMemo(
    () => files.find((file) => file.path === activePath) ?? files[0],
    [files, activePath]
  );
  const activeContent = activeFile?.content ?? "";
  const breakpointText = breakpointsByPath[activePath] ?? "";
  const breakpoints = useMemo(() => parseBreakpointText(breakpointText), [breakpointText]);
  const allBreakpoints = useMemo<Breakpoint[]>(
    () =>
      Object.entries(breakpointsByPath).flatMap(([path, text]) =>
        parseBreakpointText(text).map((line) => ({ path, line }))
      ),
    [breakpointsByPath]
  );

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    serverTabsRef.current = serverTabs;
  }, [serverTabs]);

  const setActiveContent = useCallback(
    (content: string) => {
      const path = activePathRef.current;
      setFiles((current) => current.map((file) => (file.path === path ? { ...file, content } : file)));
    },
    []
  );

  const setActiveBreakpointText = useCallback((updater: (current: string) => string) => {
    const path = activePathRef.current;
    setBreakpointsByPath((current) => ({ ...current, [path]: updater(current[path] ?? "") }));
  }, []);

  const isValidFileName = useCallback(
    (name: string, ignorePath?: string) => {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(name) || name.startsWith(".")) {
        return false;
      }
      if (!LANGUAGE_EXTENSIONS[language].includes(fileExtension(name))) {
        return false;
      }
      const lower = name.toLowerCase();
      return !files.some((file) => file.path.toLowerCase() === lower && file.path !== ignorePath);
    },
    [files, language]
  );

  const addFile = useCallback(() => {
    const ext =
      language === "cpp"
        ? ".cpp"
        : language === "c"
          ? ".c"
          : language === "javascript"
            ? ".js"
            : language === "java"
              ? ".java"
              : language === "go"
                ? ".go"
                : language === "rust"
                  ? ".rs"
                  : ".py";
    let index = 1;
    let name = `untitled${index}${ext}`;
    while (files.some((file) => file.path.toLowerCase() === name.toLowerCase())) {
      index += 1;
      name = `untitled${index}${ext}`;
    }
    setFiles((current) => [...current, { path: name, content: "" }]);
    setActivePath(name);
  }, [files, language]);

  const renameFile = useCallback(
    (path: string, nextPath: string) => {
      if (!isValidFileName(nextPath, path)) {
        return;
      }
      setFiles((current) => current.map((file) => (file.path === path ? { ...file, path: nextPath } : file)));
      setBreakpointsByPath((current) => {
        if (!(path in current)) {
          return current;
        }
        const next = { ...current };
        next[nextPath] = next[path] ?? "";
        delete next[path];
        return next;
      });
      setActivePath((current) => (current === path ? nextPath : current));
      setStoppedPath((current) => (current === path ? nextPath : current));
    },
    [isValidFileName]
  );

  const removeFile = useCallback((path: string) => {
    setFiles((current) => {
      if (current.length <= 1) {
        return current;
      }
      const next = current.filter((file) => file.path !== path);
      setActivePath((active) => (active === path ? next[0]!.path : active));
      return next;
    });
    setBreakpointsByPath((current) => {
      if (!(path in current)) {
        return current;
      }
      const next = { ...current };
      delete next[path];
      return next;
    });
    setServerTabs((current) => {
      if (!(path in current)) {
        return current;
      }
      const next = { ...current };
      delete next[path];
      return next;
    });
    setStoppedPath((current) => (current === path ? undefined : current));
  }, []);

  const closeOtherFiles = useCallback((path: string) => {
    setFiles((current) => current.filter((file) => file.path === path));
    setActivePath(path);
    setBreakpointsByPath((current) => (path in current ? { [path]: current[path] ?? "" } : {}));
    setServerTabs((current) => (path in current ? { [path]: current[path]! } : {}));
  }, []);

  const deleteFile = useCallback(
    (path: string) => {
      if (window.confirm(`Delete "${path}"? This cannot be undone.`)) {
        removeFile(path);
      }
    },
    [removeFile]
  );

  const isDebugRunning = isDebugActive && debugStatus === "Running";
  const isDebugStopped = isDebugActive && debugStopped;

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

  // --- Accounts + explorer handlers ---------------------------------------

  const resetToLoggedOut = useCallback(() => {
    setUser(null);
    setTree([]);
    setFiles((current) => {
      const scratch = current.filter((file) => !(file.path in serverTabsRef.current));
      if (scratch.length === 0) {
        const cap = LANGUAGE_CAPABILITIES.find((item) => item.id === language) ?? initialLanguage;
        const name = defaultFileName(cap.id);
        setActivePath(name);
        return [{ path: name, content: cap.defaultSource }];
      }
      setActivePath((active) => (active in serverTabsRef.current ? scratch[0]!.path : active));
      return scratch;
    });
    setServerTabs({});
  }, [language]);

  const handleAuthError = useCallback(
    (error: unknown) => {
      if (error instanceof AuthExpiredError) {
        resetToLoggedOut();
        return true;
      }
      return false;
    },
    [resetToLoggedOut]
  );

  // Snapshot the editor's current file/selection/run output for the AI panel's
  // auto-attached context (each field capped well under the server's limit).
  const collectContext = useCallback((): AiContext => {
    const clip = (text: string, max = 20_000): string => (text.length > max ? text.slice(0, max) : text);
    const context: AiContext = { language };
    if (activePath) {
      context.filename = activePath;
    }
    if (activeContent) {
      context.code = clip(activeContent);
    }
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const model = editor?.getModel();
    if (editor && selection && model && !selection.isEmpty()) {
      context.selection = clip(model.getValueInRange(selection));
    }
    const runOutput = output.map((line) => line.text).join("");
    if (runOutput.trim()) {
      context.runOutput = clip(runOutput);
    }
    return context;
  }, [language, activePath, activeContent, output]);

  const refreshTree = useCallback(async () => {
    try {
      const res = await filesApi.tree();
      setTree(res.entries);
    } catch (error) {
      handleAuthError(error);
    }
  }, [handleAuthError]);

  const openServerFile = useCallback(
    async (path: string) => {
      try {
        const res = await filesApi.read(path);
        setFiles((current) =>
          current.some((file) => file.path === path)
            ? current.map((file) => (file.path === path ? { ...file, content: res.content } : file))
            : [...current, { path, content: res.content }]
        );
        setServerTabs((current) => ({ ...current, [path]: { savedContent: res.content } }));
        setActivePath(path);
        const lang = languageForFile(path);
        if (lang) {
          setLanguage(lang);
        }
      } catch (error) {
        if (!handleAuthError(error)) {
          appendOutput("system", `${messageFromError(error)}\n`);
        }
      }
    },
    [appendOutput, handleAuthError]
  );

  const saveActiveServerTab = useCallback(async () => {
    const path = activePathRef.current;
    const saved = serverTabsRef.current[path];
    if (!saved) {
      return;
    }
    const file = filesRef.current.find((item) => item.path === path);
    if (!file || file.content === saved.savedContent) {
      return;
    }
    try {
      await filesApi.write(path, file.content);
      setServerTabs((current) => ({ ...current, [path]: { savedContent: file.content } }));
    } catch (error) {
      if (!handleAuthError(error)) {
        appendOutput("system", `${messageFromError(error)}\n`);
      }
    }
  }, [appendOutput, handleAuthError]);

  const handleCreate = useCallback(
    async (parentDir: string, name: string, kind: "file" | "folder") => {
      const path = parentDir ? `${parentDir}/${name}` : name;
      try {
        if (kind === "folder") {
          await filesApi.mkdir(path);
          await refreshTree();
        } else {
          await filesApi.write(path, "");
          await refreshTree();
          await openServerFile(path);
        }
      } catch (error) {
        if (!handleAuthError(error)) {
          appendOutput("system", `${messageFromError(error)}\n`);
        }
      }
    },
    [appendOutput, handleAuthError, openServerFile, refreshTree]
  );

  const handleRenameServer = useCallback(
    async (path: string, newName: string) => {
      try {
        const newPath = await filesApi.rename(path, newName);
        await refreshTree();
        // A rename can target a file or a folder; for a folder, every open
        // descendant tab/breakpoint/decoration must follow from `path/...` to
        // `newPath/...` (ISSUE-050), not just the exact path.
        const remap = (p: string) => remapPath(p, path, newPath);
        setFiles((current) => current.map((file) => ({ ...file, path: remap(file.path) })));
        setServerTabs((current) => remapKeys(current, remap));
        setBreakpointsByPath((current) => remapKeys(current, remap));
        setActivePath((active) => remap(active));
        setStoppedPath((stopped) => (stopped ? remap(stopped) : stopped));
        // Hygiene: rekey decoration ids so the old subtree keys don't dangle.
        // The decoration effect re-creates fresh decorations for the new paths.
        decorationIdsByPath.current = remapKeys(decorationIdsByPath.current, remap);
      } catch (error) {
        if (!handleAuthError(error)) {
          appendOutput("system", `${messageFromError(error)}\n`);
        }
      }
    },
    [appendOutput, handleAuthError, refreshTree]
  );

  const handleDeleteServer = useCallback(
    async (node: TreeNode) => {
      const isAffected = (p: string) => p === node.path || p.startsWith(`${node.path}/`);
      // Stronger confirm when a folder delete will close open (esp. unsaved) tabs.
      const openTabs = filesRef.current.filter((file) => isAffected(file.path) && file.path in serverTabsRef.current);
      const dirtyCount = openTabs.filter(
        (file) => file.content !== serverTabsRef.current[file.path]!.savedContent
      ).length;
      const message =
        node.type === "dir" && openTabs.length > 0
          ? `Delete folder "${node.path}" and close ${openTabs.length} open file${openTabs.length === 1 ? "" : "s"}` +
            `${dirtyCount > 0 ? ` (${dirtyCount} with unsaved changes)` : ""}? This cannot be undone.`
          : `Delete "${node.path}"? This cannot be undone.`;
      if (!window.confirm(message)) {
        return;
      }
      try {
        await filesApi.remove(node.path);
        await refreshTree();
        setServerTabs((current) => {
          const next: Record<string, { savedContent: string }> = {};
          for (const [p, value] of Object.entries(current)) {
            if (!isAffected(p)) {
              next[p] = value;
            }
          }
          return next;
        });
        setFiles((current) => {
          const next = current.filter((file) => !isAffected(file.path));
          if (next.length === 0) {
            const cap = LANGUAGE_CAPABILITIES.find((item) => item.id === language) ?? initialLanguage;
            const name = defaultFileName(cap.id);
            setActivePath(name);
            return [{ path: name, content: cap.defaultSource }];
          }
          setActivePath((active) => (isAffected(active) ? next[0]!.path : active));
          return next;
        });
      } catch (error) {
        if (!handleAuthError(error)) {
          appendOutput("system", `${messageFromError(error)}\n`);
        }
      }
    },
    [appendOutput, handleAuthError, language, refreshTree]
  );

  const handleDuplicate = useCallback(
    async (node: TreeNode) => {
      try {
        const src = await filesApi.read(node.path);
        const target = duplicateName(node.path);
        // Authoritative collision check against a fresh tree; never overwrite an
        // existing entry — surface a duplicate error instead (EXPLORER-009a).
        const fresh = await filesApi.tree();
        if (pathExistsInTree(fresh.entries, target)) {
          appendOutput("system", `Cannot duplicate: "${target}" already exists — rename it first.\n`);
          return;
        }
        await filesApi.write(target, src.content);
        await refreshTree();
        await openServerFile(target);
      } catch (error) {
        if (!handleAuthError(error)) {
          appendOutput("system", `${messageFromError(error)}\n`);
        }
      }
    },
    [appendOutput, handleAuthError, openServerFile, refreshTree]
  );

  const handleLogin = useCallback(
    async (username: string, password: string) => {
      const name = await authApi.login(username, password);
      setUser(name);
      setShowLogin(false);
      await refreshTree();

      // Offer to save edited scratch buffers into the user's home (EXPLORER-008).
      // Pristine/empty scratch is left alone (it stays visibly labeled "Scratch").
      const defaults = new Set(LANGUAGE_CAPABILITIES.map((cap) => cap.defaultSource));
      const candidates = savableScratch(filesRef.current, serverTabsRef.current, defaults);
      if (candidates.length === 0) {
        return;
      }
      const list = candidates.map((file) => file.path).join(", ");
      const plural = candidates.length === 1 ? "" : "s";
      if (!window.confirm(`Save your edited scratch file${plural} (${list}) into /home/${name}?`)) {
        return;
      }

      try {
        // Don't overwrite existing home files — skip name collisions and report them.
        const existing = new Set((await filesApi.tree()).entries.map((entry) => entry.name));
        const skipped: string[] = [];
        for (const file of candidates) {
          if (existing.has(file.path)) {
            skipped.push(file.path);
            continue;
          }
          await filesApi.write(file.path, file.content);
          setServerTabs((current) => ({ ...current, [file.path]: { savedContent: file.content } }));
        }
        await refreshTree();
        if (skipped.length > 0) {
          appendOutput("system", `Not saved (a file with that name already exists): ${skipped.join(", ")}\n`);
        }
      } catch (error) {
        if (!handleAuthError(error)) {
          appendOutput("system", `${messageFromError(error)}\n`);
        }
      }
    },
    [appendOutput, handleAuthError, refreshTree]
  );

  const handleLogout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      resetToLoggedOut();
    }
  }, [resetToLoggedOut]);

  // Persist any dirty server tabs in `dir` before a folder run gathers them.
  // `recursive` (Python) also saves dirty files in nested subfolders, since the
  // folder is gathered recursively.
  const saveDirtyInDir = useCallback(async (dir: string, recursive: boolean) => {
    const inDir = (p: string): boolean =>
      recursive ? (dir === "" ? true : p.startsWith(`${dir}/`)) : dirOf(p) === dir;
    const targets = filesRef.current.filter(
      (file) =>
        file.path in serverTabsRef.current &&
        inDir(file.path) &&
        file.content !== serverTabsRef.current[file.path]!.savedContent
    );
    for (const file of targets) {
      await filesApi.write(file.path, file.content);
      setServerTabs((current) => ({ ...current, [file.path]: { savedContent: file.content } }));
    }
  }, []);

  // Build the run/debug file list. Logged-in + active tab is a server file →
  // gather the whole folder; otherwise use the open scratch buffers (the
  // anonymous path, byte-identical to before).
  const buildRunPayload = useCallback(async (): Promise<
    { ok: true; files: ProjectFile[]; breakpoints: Breakpoint[] } | { ok: false; error: string }
  > => {
    // "Run/Debug this file" overrides the active tab + language for one dispatch.
    const target = runTargetRef.current;
    const active = target?.path ?? activePath;
    const effLang = target?.language ?? language;
    const activeIsServer = isServerFolderRun(target !== null, active, serverTabsRef.current);
    if (user && activeIsServer) {
      const dir = dirOf(active);
      // Python projects gather recursively (nested package files); other
      // languages stay flat top-level.
      const recursive = effLang === "python";
      await saveDirtyInDir(dir, recursive);
      const folder = await filesApi.folder(dir, recursive);
      // Remember each gathered file's original server path + content so a debug
      // stop in a secondary file resolves to the correct tab (ISSUE-052). For a
      // recursive Python folder, file.name is the folder-relative path.
      const map: DebugFileMap = new Map();
      for (const file of folder.files) {
        map.set(file.name, { serverPath: dir ? `${dir}/${file.name}` : file.name, content: file.content });
      }
      debugFileMapRef.current = map;
      return gatherFolderRun({
        language: effLang,
        folderDir: dir,
        folderFiles: folder.files,
        activeName: dir === "" ? active : active.slice(dir.length + 1),
        allBreakpoints,
        entryName: target?.entrypoint
      });
    }
    debugFileMapRef.current = new Map();
    const scratch = files.filter((file) => !(file.path in serverTabsRef.current));
    const usable = scratch.length > 0 ? scratch : files;
    const names = new Set(usable.map((file) => file.path));
    return { ok: true, files: usable, breakpoints: allBreakpoints.filter((bp) => names.has(bp.path)) };
  }, [activePath, allBreakpoints, files, language, saveDirtyInDir, user]);

  const tabMeta = useMemo<Record<string, TabMeta>>(() => {
    const meta: Record<string, TabMeta> = {};
    for (const [path, saved] of Object.entries(serverTabs)) {
      const file = files.find((item) => item.path === path);
      meta[path] = {
        label: baseOf(path),
        locked: true,
        dirty: file ? file.content !== saved.savedContent : false
      };
    }
    // When logged in, flag the remaining open buffers as local scratch so they
    // are visibly distinct from /home/<user> files (EXPLORER-008).
    if (user) {
      for (const file of files) {
        if (!(file.path in serverTabs)) {
          meta[file.path] = { ...meta[file.path], scratch: true };
        }
      }
    }
    return meta;
  }, [serverTabs, files, user]);

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

    if (stoppingDebug) {
      if (debugSocket.current?.readyState === WebSocket.OPEN) {
        try {
          debugSocket.current.send(JSON.stringify({ type: "stop" }));
        } catch {
          // Runner ws-close handler sẽ cleanup nếu send fail
        }
      }
      debugSocket.current?.close();
      debugSocket.current = null;
      setDebugStatus("Stopped");
      setDebugStopped(false);
      setIsDebugActive(false);
      appendDebug("system", "\nStopped by user\n");
    }

    if (stoppingRun) {
      const id = runIdRef.current;
      runSocket.current?.close();
      runSocket.current = null;
      setRunStatus("Stopping…");
      appendOutput("system", "\nStopping…\n");
      if (id) {
        // Cancel the server-side container; keep the SSE open so the terminal
        // exit({cancelled}) event closes us out (EXPLORER-005).
        void fetch(`/api/run/${id}/cancel`, { method: "POST" }).catch(() => undefined);
        window.setTimeout(() => {
          // Fallback if the cancelled exit event never arrives.
          if (runIdRef.current === id && runEvents.current) {
            runEvents.current.close();
            runEvents.current = null;
            runIdRef.current = null;
            setRunStatus("Stopped");
            setIsRunActive(false);
          }
        }, 2_000);
      } else {
        runEvents.current?.close();
        runEvents.current = null;
        setRunStatus("Stopped");
        setIsRunActive(false);
      }
    }
  }, [appendDebug, appendOutput]);

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
      // Debug mode keeps the viewport-locked grid → size relative to the workspace box (%).
      // The non-debug run view is a page-scroll layout where the workspace can be taller than
      // the viewport, so size the editor relative to the viewport (vh) instead (ISSUE-068).
      // clientY/rect.top are both viewport coordinates, so this is correct even when scrolled.
      const editorPx = moveEvent.clientY - rect.top;
      const next = isDebugActive ? (editorPx / rect.height) * 100 : (editorPx / window.innerHeight) * 100;
      setEditorHeight(Math.min(85, Math.max(20, next)));
    };

    const onMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      setTimeout(() => editorRef.current?.layout(), 50);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [isDebugActive]);

  const startResizeX = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setIsDraggingX(true);
    let lastRun = 0;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const now = Date.now();
      if (now - lastRun < 16) return;
      lastRun = now;
      const rect = contentAreaRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = ((rect.right - moveEvent.clientX) / rect.width) * 100;
      setInspectorWidth(Math.min(55, Math.max(15, pct)));
    };

    const onMouseUp = () => {
      setIsDraggingX(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      setTimeout(() => editorRef.current?.layout(), 50);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  const startResizeVSplit = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setIsDraggingVSplit(true);
    let lastRun = 0;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const now = Date.now();
      if (now - lastRun < 16) return;
      lastRun = now;
      const stack = (event.target as HTMLElement).closest(".debug-stack");
      if (!stack) return;
      const rect = stack.getBoundingClientRect();
      const y = moveEvent.clientY - rect.top;
      const minH = 40;
      const maxH = rect.height - 80;
      setVariablesHeight(Math.min(maxH, Math.max(minH, y)));
    };

    const onMouseUp = () => {
      setIsDraggingVSplit(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  const sendDebug = useCallback((command: DebugCommand) => {
    if (debugSocket.current?.readyState === WebSocket.OPEN) {
      debugSocket.current.send(JSON.stringify(command));
      // Optimistically leave the stopped state the instant we dispatch a resume/step, so a
      // fast double-click can't fire a second command before the `running` event returns —
      // that second command would hit the adapter mid-run → notStopped (ISSUE-060).
      if (
        command.type === "continue" ||
        command.type === "stepOver" ||
        command.type === "stepInto" ||
        command.type === "stepOut"
      ) {
        setDebugStopped(false);
      }
    }
  }, []);

  const toggleVariable = useCallback(
    (reference: number) => {
      const willExpand = !expandedRefs.has(reference);
      setExpandedRefs((current) => {
        const next = new Set(current);
        if (next.has(reference)) {
          next.delete(reference);
        } else {
          next.add(reference);
        }
        return next;
      });
      if (willExpand && !childrenByRef[reference]) {
        sendDebug({ type: "expand", variablesReference: reference });
      }
    },
    [expandedRefs, childrenByRef, sendDebug]
  );

  const removeWatch = useCallback(
    (expression: string) => {
      sendDebug({ type: "removeWatch", expression });
      setWatches((current) => current.filter((watch) => watch.expression !== expression));
    },
    [sendDebug]
  );

  const startDebugRef = useRef<() => Promise<void>>(async () => {});

  const handleRestart = useCallback(async () => {
    if (!isDebugActive) return;
    handleStop();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await startDebugRef.current();
  }, [isDebugActive, handleStop]);

  const jumpToDiagnostic = useCallback(
    (diagnostic: Diagnostic) => {
      const line = diagnostic.line;
      if (!line) {
        return;
      }

      const doReveal = () => {
        const editor = editorRef.current;
        if (!editor) {
          return;
        }
        editor.focus();
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: diagnostic.column ?? 1 });
      };

      const target = workspaceRelPath(diagnostic.file);
      if (target && target !== activePathRef.current && files.some((file) => file.path === target)) {
        setActivePath(target);
        // Let the editor swap to the target file's model before revealing.
        setTimeout(doReveal, 50);
      } else {
        doReveal();
      }
    },
    [files]
  );

  const appendRunStderr = useCallback(
    (data: string) => {
      // Always show the full compiler transcript in Output (errors + warnings + notes +
      // the `^~~` caret context) so learners see exactly what/where the problem is. The
      // Error List is built in parallel from the parsed diagnostics — it does not replace
      // the raw output anymore (ISSUE-069).
      appendOutput("stderr", data);

      const shouldParseDiagnostics = runPhaseRef.current === "compile" && runLanguageRef.current !== "python";
      if (!shouldParseDiagnostics) {
        return;
      }

      const parsed = parseCompilerDiagnostics(data);
      if (parsed.length > 0) {
        setDiagnostics((current) => [...current, ...parsed]);
        const errors = parsed.filter((diagnostic) => diagnostic.severity === "error").length;
        compileErrorsRef.current += errors;
        compileWarningsRef.current += parsed.length - errors;
        // Only steal focus to the Error List for real compile errors; warning-only
        // compiles stay on Output (ISSUE-017).
        if (errors > 0) {
          setActiveTab("errors");
        }
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
    // "Run this file" can override language + entrypoint for this dispatch.
    const target = runTargetRef.current;
    const effLang = target?.language ?? language;
    const entrypoint = target?.entrypoint;
    runLanguageRef.current = effLang;
    compileWarningsRef.current = 0;
    compileErrorsRef.current = 0;

    let argv: string[];
    try {
      argv = parseArgv(argvInput);
    } catch (error) {
      setRunStatus("Invalid arguments");
      setIsRunActive(false);
      appendOutput("system", `${messageFromError(error)}\n`);
      return;
    }

    let payload: Awaited<ReturnType<typeof buildRunPayload>>;
    try {
      payload = await buildRunPayload();
    } catch (error) {
      setRunStatus("Failed");
      setIsRunActive(false);
      appendOutput("system", `${messageFromError(error)}\n`);
      return;
    }
    if (!payload.ok) {
      setRunStatus("Failed");
      setIsRunActive(false);
      appendOutput("system", `${payload.error}\n`);
      return;
    }

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language: effLang,
          files: payload.files,
          stdin,
          argv,
          toolchainVersion,
          ...(entrypoint ? { entrypoint } : {})
        })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const { id } = (await response.json()) as { id: string };
      runIdRef.current = id;
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
  }, [appendOutput, argvInput, buildRunPayload, language, stdin, stopSockets]);

  const startDebug = useCallback(async () => {
    // "Debug this file" can override language + entrypoint for this dispatch.
    const target = runTargetRef.current;
    const effLang = target?.language ?? language;
    const entrypoint = target?.entrypoint;
    const effCapability = LANGUAGE_CAPABILITIES.find((item) => item.id === effLang) ?? capability;
    if (!effCapability.debug) {
      return;
    }

    stopSockets();
    setIsDebugActive(true);
    setIsRunActive(false);
    setActiveTab("debug");
    setDebugConsole([]);
    setVariables([]);
    setExpandedRefs(new Set());
    setChildrenByRef({});
    setFrames([]);
    setWatches([]);
    setStoppedLine(undefined);
    setDebugStatus("Starting");
    setDebugStopped(false);
    if (effLang === "java") {
      // Java debug cold-starts jdt.ls before the first breakpoint; set expectations so the
      // ~10-15s wait reads as progress, not a hang.
      appendDebug("system", "Booting Java debugger (jdt.ls)… first start can take ~10-15s.\n");
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

    let payload: Awaited<ReturnType<typeof buildRunPayload>>;
    try {
      payload = await buildRunPayload();
    } catch (error) {
      setDebugStatus("Failed");
      setIsDebugActive(false);
      appendDebug("system", `${messageFromError(error)}\n`);
      return;
    }
    if (!payload.ok) {
      setDebugStatus("Failed");
      setIsDebugActive(false);
      appendDebug("system", `${payload.error}\n`);
      return;
    }

    if (payload.breakpoints.length === 0) {
      setDebugStatus("No breakpoints");
      setIsDebugActive(false);
      appendDebug("system", "No breakpoints set. Add a breakpoint before starting debug.\n");
      return;
    }

    const lineCountByPath = new Map(payload.files.map((file) => [file.path, file.content.split("\n").length]));
    const outOfRange = payload.breakpoints.filter((bp) => bp.line > (lineCountByPath.get(bp.path) ?? Infinity));
    if (outOfRange.length > 0) {
      setDebugStatus("Invalid breakpoints");
      setIsDebugActive(false);
      appendDebug(
        "system",
        `Breakpoints out of range: ${outOfRange.map((bp) => `${bp.path}:${bp.line}`).join(", ")}\n`
      );
      return;
    }

    try {
      const response = await fetch("/api/debug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language: effLang,
          files: payload.files,
          stdin,
          argv,
          toolchainVersion,
          breakpoints: payload.breakpoints,
          clientId: clientIdRef.current,
          ...(entrypoint ? { entrypoint } : {})
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
  }, [appendDebug, argvInput, buildRunPayload, capability, language, stdin, stopSockets]);

  useEffect(() => {
    startDebugRef.current = startDebug;
  }, [startDebug]);

  // "Run/Debug this file" from the explorer: open the file, then run/debug its
  // folder with that file as the explicit entrypoint (Python). The override is
  // carried via runTargetRef so it is correct even before setActivePath settles.
  const runServerFile = useCallback(
    async (path: string) => {
      const lang = languageForFile(path);
      if (!lang) {
        return;
      }
      await openServerFile(path);
      runTargetRef.current = {
        path,
        language: lang,
        entrypoint: lang === "python" ? baseOf(path) : undefined
      };
      try {
        await startRun();
      } finally {
        runTargetRef.current = null;
      }
    },
    [openServerFile, startRun]
  );

  const debugServerFile = useCallback(
    async (path: string) => {
      const lang = languageForFile(path);
      if (!lang) {
        return;
      }
      await openServerFile(path);
      runTargetRef.current = {
        path,
        language: lang,
        entrypoint: lang === "python" ? baseOf(path) : undefined
      };
      try {
        await startDebug();
      } finally {
        runTargetRef.current = null;
      }
    },
    [openServerFile, startDebug]
  );

  useEffect(() => {
    const timer = setTimeout(() => editorRef.current?.layout(), 50);
    return () => clearTimeout(timer);
  }, [isDebugActive]);

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
        runIdRef.current = null;
        runPhaseRef.current = "idle";
        setIsRunActive(false);
        setRunStatus(event.cancelled ? "Stopped" : event.timedOut ? "Timed out" : `Exited ${event.code ?? ""}`);
        const truncatedSuffix = event.outputTruncated ? " (output truncated)" : "";
        const warnings = compileWarningsRef.current;
        const warningSuffix = warnings > 0 ? `, ${warnings} Warning${warnings === 1 ? "" : "s"}` : "";
        if (event.cancelled) {
          appendOutput("system", `\n■ Stopped${truncatedSuffix}\n`);
        } else if (event.timedOut) {
          appendOutput("system", `\n⚠ Timed out${truncatedSuffix}\n`);
        } else if (event.code === 0) {
          appendOutput("system", `\n✓ Finished${warningSuffix}${truncatedSuffix}\n`);
        } else {
          appendOutput("system", `\n✗ Exited with code ${event.code ?? "unknown"}${truncatedSuffix}\n`);
        }
        return;
      }
      if (event.type === "error") {
        runEvents.current?.close();
        runEvents.current = null;
        runIdRef.current = null;
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
        setDebugStopped(false);
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
        setDebugStopped(false);
        return;
      }
      if (event.type === "stopped") {
        setDebugStatus(event.reason ?? "Stopped");
        setDebugStopped(true);
        setStoppedLine(event.line);
        const base = workspaceRelPath(event.file);
        const resolved = resolveStopped(base, debugFileMapRef.current, filesRef.current.map((file) => file.path));
        if (resolved) {
          // Step-into a folder file whose tab isn't open yet → open it as a server tab.
          if (resolved.content !== undefined) {
            const content = resolved.content;
            setFiles((current) =>
              current.some((file) => file.path === resolved.path)
                ? current
                : [...current, { path: resolved.path, content }]
            );
            setServerTabs((current) =>
              resolved.path in current ? current : { ...current, [resolved.path]: { savedContent: content } }
            );
          }
          setStoppedPath(resolved.path);
          setActivePath(resolved.path);
        } else {
          setStoppedPath(activePathRef.current);
        }
        return;
      }
      if (event.type === "variables") {
        setVariables(event.variables);
        setExpandedRefs(new Set());
        setChildrenByRef({});
        return;
      }
      if (event.type === "variableChildren") {
        setChildrenByRef((current) => ({ ...current, [event.variablesReference]: event.variables }));
        return;
      }
      if (event.type === "stack") {
        setFrames(event.frames);
        return;
      }
      if (event.type === "watch") {
        setWatches((current) => {
          const index = current.findIndex((watch) => watch.expression === event.expression);
          const updated = { expression: event.expression, value: event.value, error: event.error };
          if (index === -1) {
            return [...current, updated];
          }
          const next = [...current];
          next[index] = updated;
          return next;
        });
        return;
      }
      if (event.type === "exit") {
        setIsDebugActive(false);
        setDebugStopped(false);
        setDebugStatus(event.timedOut ? "Timed out" : "Exited");
        appendDebug("system", `\ndebug session exited${event.code === null ? "" : ` with code ${event.code}`}\n`);
        return;
      }
      if (event.type === "error") {
        setIsDebugActive(false);
        setDebugStopped(false);
        setDebugStatus("Error");
        appendDebug("system", `${event.message}\n`);
      }
    },
    [appendDebug]
  );

  const onEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setMonacoReady(true);
    (window as unknown as { __monacoEditor?: typeof editor }).__monacoEditor = editor;

    editor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS || !event.target.position) {
        return;
      }

      const line = event.target.position.lineNumber;
      setActiveBreakpointText((current) => toggleBreakpointText(current, line));
    });
  };

  // Register static stdlib completion + signature help while the switch is ON and
  // the current language has a symbol table. Disposing on toggle-off or language
  // change returns the editor to Monaco's default word-based suggestions.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !monacoReady) return;
    if (!suggestEnabled || !languageHasSuggestions(language)) return;
    const disposable = registerSuggestions(monaco, language);
    return () => disposable?.dispose();
  }, [suggestEnabled, language, monacoReady]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      return;
    }

    const lineCount = editor.getModel()?.getLineCount() ?? Infinity;
    const validBreakpoints = breakpoints.filter((line) => line <= lineCount);
    const showStopped = stoppedLine !== undefined && stoppedPath === activePath;
    const previous = decorationIdsByPath.current[activePath] ?? [];
    decorationIdsByPath.current[activePath] = editor.deltaDecorations(previous, [
      ...validBreakpoints.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: "breakpoint-glyph"
        }
      })),
      ...(showStopped
        ? [
            {
              range: new monaco.Range(stoppedLine!, 1, stoppedLine!, 1),
              options: {
                isWholeLine: true,
                className: "current-debug-line"
              }
            }
          ]
        : [])
    ]);

    if (showStopped) {
      editor.revealLineInCenter(stoppedLine!);
    }
  }, [breakpoints, stoppedLine, stoppedPath, activePath]);

  useEffect(() => () => stopSockets(), [stopSockets]);

  // Restore an existing session on load (cookie → /me), then load the tree.
  useEffect(() => {
    authApi
      .me()
      .then((name) => {
        if (!name) {
          return undefined;
        }
        setUser(name);
        return filesApi.tree();
      })
      .then((res) => {
        if (res) {
          setTree(res.entries);
        }
      })
      .catch(() => {});
  }, []);

  // Ctrl/Cmd+S saves the active server-backed tab (no-op for scratch buffers).
  useEffect(() => {
    if (!user) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        void saveActiveServerTab();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user, saveActiveServerTab]);

  // Guard against losing unsaved server-tab edits on tab close/reload (ISSUE-048).
  // Attached only while something is dirty; cleared when clean or on logout.
  useEffect(() => {
    if (!hasDirtyServerTab(files, serverTabs)) {
      return undefined;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [files, serverTabs]);

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
        {user && (
          <button
            type="button"
            className="topbar-icon-btn"
            aria-label="Toggle explorer"
            title="Explorer"
            aria-pressed={explorerOpen}
            onClick={() => setExplorerOpen((value) => !value)}
          >
            <PanelLeft size={16} />
          </button>
        )}
        {user && (
          <button
            type="button"
            className="topbar-icon-btn"
            data-testid="btn-ai-toggle"
            aria-label="Toggle learning assistant"
            title="Learning assistant"
            aria-pressed={aiOpen}
            onClick={() => setAiOpen((value) => !value)}
          >
            <GraduationCap size={16} />
          </button>
        )}
        <select
          aria-label="Language"
          value={language}
          onChange={(event) => {
            const next = event.target.value as Language;
            if (next === language) {
              return;
            }
            setToolchainVersion(LANGUAGE_CAPABILITIES.find((item) => item.id === next)?.defaultVersion);
            // Logged-in users keep their open files (server tabs persist on the
            // host); the picker only changes how Run/Debug compiles. The
            // clear-on-switch flow stays for the anonymous single-buffer mode.
            if (user !== null) {
              setLanguage(next);
              return;
            }
            const currentCap = LANGUAGE_CAPABILITIES.find((item) => item.id === language);
            const pristine = files.length === 1 && files[0]?.content === (currentCap?.defaultSource ?? "");
            if (!pristine && !window.confirm("Switching language will clear all files. Continue?")) {
              event.target.value = language;
              return;
            }
            const cap = LANGUAGE_CAPABILITIES.find((item) => item.id === next);
            const name = defaultFileName(next);
            setLanguage(next);
            setFiles([{ path: name, content: cap?.defaultSource ?? "" }]);
            setActivePath(name);
            setBreakpointsByPath({});
            decorationIdsByPath.current = {};
            setStoppedLine(undefined);
            setStoppedPath(undefined);
          }}
        >
          {LANGUAGE_CAPABILITIES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {capability.versions && (
          <select
            aria-label="Version"
            value={toolchainVersion ?? capability.defaultVersion ?? capability.versions[0]}
            onChange={(event) => setToolchainVersion(event.target.value)}
          >
            {capability.versions.map((version) => (
              <option key={version} value={version}>
                {`${capability.label} ${version}`}
              </option>
            ))}
          </select>
        )}
        {supportsSuggestionToggle(language) && (
          <button
            type="button"
            className="topbar-icon-btn"
            data-testid="btn-suggest-toggle"
            aria-label="Advanced suggestions"
            title={`Advanced suggestions: ${suggestEnabled ? "on" : "off"}`}
            aria-pressed={suggestEnabled}
            onClick={() => setSuggestEnabled((value) => !value)}
          >
            <Sparkles size={16} />
          </button>
        )}
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
        {isDebugActive && (
          <div className="debug-toolbar">
            <div className="debug-group">
              {isDebugRunning ? (
                <button className="btn-continue" aria-label="Pause" onClick={() => sendDebug({ type: "pause" })} title="Pause">
                  <Pause size={15} fill="currentColor" />
                </button>
              ) : (
                <button className="btn-continue" aria-label="Continue" disabled={!isDebugStopped} onClick={() => sendDebug({ type: "continue" })} title="Continue">
                  <Play size={15} fill="currentColor" />
                </button>
              )}
            </div>
            <div className="toolbar-separator" aria-hidden="true" />
            <div className="debug-group">
              <button className="btn-step" aria-label="Step over" disabled={!isDebugStopped} onClick={() => sendDebug({ type: "stepOver" })} title="Step over">
                <SkipForward size={15} fill="currentColor" />
              </button>
              <button className="btn-step" aria-label="Step into" disabled={!isDebugStopped} onClick={() => sendDebug({ type: "stepInto" })} title="Step into">
                <ArrowDownToLine size={15} />
              </button>
              <button className="btn-step" aria-label="Step out" disabled={!isDebugStopped} onClick={() => sendDebug({ type: "stepOut" })} title="Step out">
                <ArrowUpFromLine size={15} />
              </button>
            </div>
            <div className="toolbar-separator" aria-hidden="true" />
            <div className="debug-group">
              <button className="btn-restart" aria-label="Restart" disabled={!isDebugActive} onClick={handleRestart} title="Restart">
                <RotateCcw size={15} />
              </button>
              <button className="btn-stop" aria-label="Stop" disabled={!isDebugActive} onClick={() => sendDebug({ type: "stop" })} title="Stop">
                <Square size={15} fill="currentColor" />
              </button>
            </div>
            {isDebugStopped && <div className="active-indicator" aria-hidden="true" title="Stopped at breakpoint" />}
          </div>
        )}
        <span className={`status-pill ${statusClass}${isRunActive && runElapsed >= 3 ? " running-long" : ""}`}>
          {activeTab === "debug"
            ? debugStatus
            : isRunActive && runElapsed >= 3
              ? `Running ${runElapsed}s…`
              : runStatus}
        </span>
        {user ? (
          <button type="button" className="auth-btn" onClick={handleLogout} title={`Signed in as ${user} — sign out`}>
            <LogOut size={16} />
            <span>{user}</span>
          </button>
        ) : (
          <button type="button" className="auth-btn" onClick={() => setShowLogin(true)} title="Sign in">
            <LogIn size={16} />
            <span>Sign in</span>
          </button>
        )}
      </header>

      {showLogin && <LoginDialog onClose={() => setShowLogin(false)} onSubmit={handleLogin} />}

      <div
        className={`content-area ${isDebugActive ? "debug-active" : ""} ${user && explorerOpen ? "explorer-open" : ""}`}
        ref={contentAreaRef}
        style={{ "--inspector-width": `${inspectorWidth}%` } as CSSProperties}
      >
        {user && explorerOpen && (
          <Explorer
            username={user}
            entries={tree}
            activePath={activePath in serverTabs ? activePath : null}
            onOpenFile={openServerFile}
            onRefresh={refreshTree}
            onCreate={handleCreate}
            onRename={handleRenameServer}
            onDelete={handleDeleteServer}
            onDuplicate={handleDuplicate}
            onRunFile={runServerFile}
            onDebugFile={debugServerFile}
          />
        )}
        <main
          className="workspace"
          ref={workspaceRef}
          style={
            {
              "--editor-height": `${editorHeight}%`,
              // Viewport-relative twin of --editor-height, used by the non-debug page-scroll
              // layout where a `%` height would have no definite parent to resolve against
              // (ISSUE-068).
              "--editor-vh": `${editorHeight}vh`
            } as CSSProperties
          }
        >
          <section className="editor-panel">
          {showTabs && (
            <FileTabs
              files={files}
              activePath={activePath}
              language={language}
              meta={tabMeta}
              onSelect={setActivePath}
              onAdd={addFile}
              onRename={renameFile}
              onClose={removeFile}
              onCloseOthers={closeOtherFiles}
              onDelete={deleteFile}
            />
          )}
          <div className="editor-host">
          <Editor
            height="100%"
            language={language === "cpp" ? "cpp" : language}
            theme="vs-dark"
            path={activePath}
            value={activeContent}
            onChange={(value) => setActiveContent(value ?? "")}
            beforeMount={(monaco) => disableJavascriptWorkerCompletions(monaco)}
            onMount={onEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbersMinChars: 4,
              glyphMargin: true,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 4,
              // Let the wheel bubble to the page once the editor is at its top/bottom edge,
              // so scrolling continues down into the Output panel instead of getting stuck
              // inside Monaco (ISSUE-068).
              scrollbar: { alwaysConsumeMouseWheel: false }
            }}
          />
          </div>

          </section>

          <div
            className={`resize-handle ${isDragging ? "dragging" : ""}`}
            onMouseDown={startResize}
            onDoubleClick={() => setEditorHeight(58)}
          />

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
                onChange={(event) => {
                  const value = event.target.value;
                  setActiveBreakpointText(() => value);
                }}
              />
              <span className="breakpoint-count">
                {breakpoints.length} breakpoint{breakpoints.length !== 1 ? "s" : ""} in {activePath}
                {allBreakpoints.length !== breakpoints.length ? ` (${allBreakpoints.length} total)` : ""} — click the gutter to toggle
              </span>
              {breakpoints.length > 0 && (
                <button type="button" className="breakpoint-clear" onClick={() => setActiveBreakpointText(() => "")} title="Clear breakpoints in this file">
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
                {diagnostics.length > 0 && (
                  <span
                    className={`tab-badge ${
                      diagnostics.some((diagnostic) => diagnostic.severity === "error")
                        ? "tab-badge-error"
                        : "tab-badge-warning"
                    }`}
                  >
                    {diagnostics.length > 9 ? "9+" : diagnostics.length}
                  </span>
                )}
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
              <div className="debug-tab-container">
                <TerminalView lines={debugConsole} />
                {isDebugActive && (
                  <form
                    className="debug-console-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!rawCommand.trim()) {
                        return;
                      }
                      sendDebug({ type: "raw", command: rawCommand.trim() });
                      setRawCommand("");
                    }}
                  >
                    <span className="debug-console-prompt" aria-hidden="true">&gt;</span>
                    <input
                      data-testid="debug-console-input"
                      aria-label="debug console"
                      value={rawCommand}
                      onChange={(event) => setRawCommand(event.target.value)}
                      placeholder="Type a debug command or expression (e.g. print x)"
                    />
                  </form>
                )}
              </div>
            )}
          </div>
        </section>
        </main>

        {isDebugActive && (
          <div
            className={`resize-handle-x ${isDraggingX ? "dragging" : ""}`}
            onMouseDown={startResizeX}
            onDoubleClick={() => setInspectorWidth(30)}
          />
        )}

        {isDebugActive && (
          <aside className="debug-side-panel">
            <div className="debug-side-tabs">
              <button className={debugPanelTab === "variables" ? "selected" : ""} onClick={() => setDebugPanelTab("variables")}>
                <Variable size={14} />
                <span>Variables</span>
              </button>
              <button className={debugPanelTab === "stack" ? "selected" : ""} onClick={() => setDebugPanelTab("stack")}>
                <ListTree size={14} />
                <span>Call Stack</span>
              </button>
            </div>

            <div className="debug-side-body">
              {debugPanelTab === "variables" && (
                <div className="debug-stack">
                  <section className="debug-variables-section" style={variablesHeight !== undefined ? { height: variablesHeight, flex: "0 0 auto" } : { flex: "0 0 auto" }}>
                    <VariablesTree
                      variables={variables}
                      childrenByRef={childrenByRef}
                      expandedRefs={expandedRefs}
                      onToggle={toggleVariable}
                    />
                  </section>
                  <div className={`debug-vsplit ${isDraggingVSplit ? "dragging" : ""}`} onMouseDown={startResizeVSplit} />
                  <section className="debug-watches-section">
                    <WatchList watches={watches} onRemove={removeWatch} />
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
                    </form>
                  </section>
                </div>
              )}
              {debugPanelTab === "stack" && (
                <Inspector
                  title="Call Stack"
                  empty="No frames"
                  rows={frames.map((frame) => [
                    `#${frame.level}`,
                    `${frame.func}${frame.line ? `:${frame.line}` : ""}`
                  ])}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {user && aiOpen && (
        <AiPanel
          onClose={() => setAiOpen(false)}
          onAuthError={handleAuthError}
          collectContext={collectContext}
          currentLanguage={language}
        />
      )}
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

function VariablesTree({
  variables,
  childrenByRef,
  expandedRefs,
  onToggle
}: {
  variables: DebugVariable[];
  childrenByRef: Record<number, DebugVariable[]>;
  expandedRefs: Set<number>;
  onToggle: (reference: number) => void;
}) {
  return (
    <section className="inspector">
      <h2>Variables</h2>
      {variables.length === 0 ? (
        <p>No variables</p>
      ) : (
        <VariableRows
          variables={variables}
          depth={0}
          childrenByRef={childrenByRef}
          expandedRefs={expandedRefs}
          onToggle={onToggle}
        />
      )}
    </section>
  );
}

function VariableRows({
  variables,
  depth,
  childrenByRef,
  expandedRefs,
  onToggle
}: {
  variables: DebugVariable[];
  depth: number;
  childrenByRef: Record<number, DebugVariable[]>;
  expandedRefs: Set<number>;
  onToggle: (reference: number) => void;
}) {
  return (
    <>
      {variables.map((variable, index) => {
        const reference = variable.variablesReference;
        const expandable = reference !== undefined && reference > 0;
        const expanded = expandable && expandedRefs.has(reference);
        const loadedChildren = expanded ? childrenByRef[reference] : undefined;
        return (
          <Fragment key={`${depth}-${variable.name}-${index}`}>
            <div className="tree-row var-row">
              <TreeIndent depth={depth} />
              {expandable ? (
                <button
                  type="button"
                  className={`var-caret${expanded ? " expanded" : ""}`}
                  aria-label={expanded ? "Collapse" : "Expand"}
                  onClick={() => onToggle(reference)}
                >
                  <ChevronRight size={14} />
                </button>
              ) : (
                <span className="var-caret-spacer" />
              )}
              <span className="var-name-after">{variable.name}</span>
              <span className="var-type-equals">:</span>
              <code className={`tree-value ${classifyValue(variable.value)}`}>{variable.value ?? ""}</code>
            </div>
            {expanded && loadedChildren && (
              <VariableRows
                variables={loadedChildren}
                depth={depth + 1}
                childrenByRef={childrenByRef}
                expandedRefs={expandedRefs}
                onToggle={onToggle}
              />
            )}
            {expanded && !loadedChildren && (
              <div className="tree-row var-row">
                <TreeIndent depth={depth + 1} />
                <span className="var-caret-spacer" />
                <span className="var-loading">loading…</span>
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function TreeIndent({ depth }: { depth: number }) {
  if (depth <= 0) {
    return null;
  }

  return (
    <span className="tree-indent" aria-hidden="true">
      {Array.from({ length: depth }, (_, level) => (
        <span key={level} className="indent-guide" />
      ))}
    </span>
  );
}

// Classify a debug value for semantic coloring (ISSUE-037). Scheme confirmed by
// the design owner: quoted → string, plain number/bool → number, anything with
// braces/brackets or a hex pointer → object/complex; otherwise fall back to the
// default text color.
function classifyValue(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (value === "") {
    return "";
  }
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) {
    return "val-string";
  }
  if (/^-?\d+(\.\d+)?$/.test(value) || /^(true|false)$/.test(value)) {
    return "val-number";
  }
  if (/[{[]/.test(value) || /0x[0-9a-fA-F]+/.test(value)) {
    return "val-object";
  }
  return "";
}

function WatchList({ watches, onRemove }: { watches: WatchValue[]; onRemove: (expression: string) => void }) {
  return (
    <section className="inspector">
      <h2>Watches</h2>
      {watches.length === 0 ? (
        <p>No watches</p>
      ) : (
        watches.map((watch) => (
          <div className="kv-row watch-row" key={`watch-${watch.expression}`}>
            <span>{watch.expression}</span>
            <code className={watch.error ? "watch-error" : ""}>{watch.error ?? watch.value ?? ""}</code>
            <button
              type="button"
              className="watch-remove"
              aria-label="Remove watch"
              onClick={() => onRemove(watch.expression)}
            >
              ×
            </button>
          </div>
        ))
      )}
    </section>
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

/** Pick the editor language for a file name by extension (for explorer opens). */
function languageForFile(path: string): Language | undefined {
  const ext = fileExtension(path);
  if (ext === ".py") {
    return "python";
  }
  if (ext === ".cpp" || ext === ".cc" || ext === ".hpp" || ext === ".hh") {
    return "cpp";
  }
  if (ext === ".c") {
    return "c";
  }
  if (ext === ".js" || ext === ".mjs") {
    return "javascript";
  }
  if (ext === ".java") {
    return "java";
  }
  if (ext === ".go") {
    return "go";
  }
  if (ext === ".rs") {
    return "rust";
  }
  return undefined;
}

/**
 * Map a debug frame path like "/workspace/pkg/util.py" to its workspace-relative
 * path ("pkg/util.py") — preserving subfolders for nested Python projects.
 * Falls back to the bare basename for any path without the "/workspace/" prefix.
 */
function workspaceRelPath(filePath?: string): string | undefined {
  if (!filePath) {
    return undefined;
  }
  const marker = "/workspace/";
  const idx = filePath.indexOf(marker);
  if (idx >= 0) {
    return filePath.slice(idx + marker.length);
  }
  const slash = filePath.lastIndexOf("/");
  return slash >= 0 ? filePath.slice(slash + 1) : filePath;
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
