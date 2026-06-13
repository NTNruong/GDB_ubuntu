import {
  LANGUAGE_EXTENSIONS,
  MAX_FILES,
  MAX_TOTAL_SOURCE_BYTES,
  defaultFileName,
  fileExtension,
  type Breakpoint,
  type Language,
  type ProjectFile
} from "@internal/shared";

/** Parent directory of a "/"-separated relative path ("" for top level). */
export function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

/** Last segment (basename) of a "/"-separated relative path. */
export function baseOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

const HEADER_EXTENSIONS = new Set([".h", ".hpp", ".hh"]);

export type GatherResult =
  | { ok: true; files: ProjectFile[]; breakpoints: Breakpoint[] }
  | { ok: false; error: string };

/**
 * Build a run/debug payload from every top-level file of one folder ("run the
 * whole folder"). Non-recursive — the run protocol is a flat file list and the
 * compile scripts glob only the workspace root. Filenames become bare basenames
 * (valid run-protocol names); breakpoints in the folder are remapped to those
 * basenames. Returns a friendly error instead of letting the server 400.
 */
export function gatherFolderRun(params: {
  language: Language;
  folderDir: string;
  folderFiles: { name: string; content: string }[];
  activeName: string;
  allBreakpoints: Breakpoint[];
}): GatherResult {
  const { language, folderDir, folderFiles, activeName, allBreakpoints } = params;
  const allowed = LANGUAGE_EXTENSIONS[language];

  const runnable = folderFiles.filter((file) => allowed.includes(fileExtension(file.name)));
  if (runnable.length === 0) {
    return { ok: false, error: `No ${language} source files in this folder (allowed: ${allowed.join(", ")}).` };
  }
  if (runnable.length > MAX_FILES) {
    return { ok: false, error: `Folder has ${runnable.length} ${language} files (max ${MAX_FILES}).` };
  }
  const total = runnable.reduce((sum, file) => sum + file.content.length, 0);
  if (total > MAX_TOTAL_SOURCE_BYTES) {
    return { ok: false, error: `Folder source is ${total} chars (max ${MAX_TOTAL_SOURCE_BYTES}).` };
  }

  if (language === "python") {
    if (!runnable.some((file) => file.name === "main.py")) {
      return { ok: false, error: "Python runs main.py — add a main.py to this folder." };
    }
  } else if (language === "javascript") {
    if (!runnable.some((file) => file.name === "main.js")) {
      return { ok: false, error: "JavaScript runs main.js — add a main.js to this folder." };
    }
  } else if (language === "java") {
    if (!runnable.some((file) => file.name === "Main.java")) {
      return { ok: false, error: "Java runs Main.java — add a Main.java to this folder." };
    }
  } else if (!runnable.some((file) => !HEADER_EXTENSIONS.has(fileExtension(file.name)))) {
    return { ok: false, error: "No compilable source (.c/.cpp/.cc) in this folder — only headers." };
  }

  // Deterministic order (semantically irrelevant to the linker): entry first,
  // then the active file, then alphabetical.
  const entry = defaultFileName(language);
  const ordered = [...runnable].sort((a, b) => rank(a.name, entry, activeName) - rank(b.name, entry, activeName) || a.name.localeCompare(b.name));
  const files: ProjectFile[] = ordered.map((file) => ({ path: file.name, content: file.content }));

  const runnableNames = new Set(runnable.map((file) => file.name));
  const breakpoints: Breakpoint[] = allBreakpoints
    .filter((bp) => dirOf(bp.path) === folderDir && runnableNames.has(baseOf(bp.path)))
    .map((bp) => ({ path: baseOf(bp.path), line: bp.line }));

  return { ok: true, files, breakpoints };
}

function rank(name: string, entry: string, active: string): number {
  if (name === entry) {
    return 0;
  }
  if (name === active) {
    return 1;
  }
  return 2;
}
