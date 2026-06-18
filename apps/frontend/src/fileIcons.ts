// Pure resolver for Material-Icon-Theme-style file/folder icon names.
//
// This module is intentionally free of `import.meta.glob`, asset imports and
// JSX so it can be unit-tested under Vitest's `environment: "node"` without any
// Vite asset transform. The thin component layer (glob name->URL map +
// <FileTypeIcon>/<FolderTypeIcon>) lives in fileTypeIcons.tsx.
//
// Icon names map 1:1 to vendored SVG basenames under
// src/icons/material/{files,folders}/<name>.svg (Material Icon Theme, MIT).
import { fileExtension, type Language } from "@internal/shared";

/** Every file icon basename vendored under icons/material/files. */
export const FILE_ICON_NAMES = [
  "c",
  "cpp",
  "python",
  "javascript",
  "java",
  "go",
  "rust",
  "json",
  "yaml",
  "markdown",
  "document",
  "image",
  "html",
  "css",
  "git",
  "docker",
  "nodejs",
  "readme",
  "lock",
  "console",
  "settings",
  "tsconfig",
  "file"
] as const;

/** Every folder icon basename vendored under icons/material/folders. */
export const FOLDER_ICON_NAMES = [
  "folder",
  "folder-open",
  "folder-src",
  "folder-src-open",
  "folder-test",
  "folder-test-open",
  "folder-dist",
  "folder-dist-open",
  "folder-node",
  "folder-node-open",
  "folder-public",
  "folder-public-open",
  "folder-docs",
  "folder-docs-open",
  "folder-vscode",
  "folder-vscode-open",
  "folder-git",
  "folder-git-open"
] as const;

const FOLDER_ICON_SET = new Set<string>(FOLDER_ICON_NAMES);

/** Generic fallbacks — always present in the vendored set. */
const DEFAULT_FILE_ICON = "file";
const DEFAULT_FOLDER_ICON = "folder";

/** Last path segment, lowercased — defensive against full paths reaching here. */
function basename(p: string): string {
  const segments = p.split(/[\\/]/);
  const last = segments[segments.length - 1] ?? p;
  return last.toLowerCase();
}

// Exact-filename matches take priority over extension (e.g. package.json is the
// Node icon, not the generic JSON icon).
const FILENAME_ICONS: Record<string, string> = {
  "package.json": "nodejs",
  "package-lock.json": "lock",
  "yarn.lock": "lock",
  "pnpm-lock.yaml": "lock",
  dockerfile: "docker",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git",
  "tsconfig.json": "tsconfig",
  readme: "readme",
  "readme.md": "readme"
};

const EXTENSION_ICONS: Record<string, string> = {
  ".c": "c",
  ".h": "c", // ambiguous C/C++ header — neutral default; see `language` override
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".py": "python",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".java": "java",
  ".go": "go",
  ".rs": "rust",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "document",
  ".text": "document",
  ".log": "document",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".svg": "image",
  ".webp": "image",
  ".ico": "image",
  ".bmp": "image",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".sh": "console",
  ".bash": "console",
  ".zsh": "console",
  ".lock": "lock",
  ".ini": "settings",
  ".cfg": "settings",
  ".conf": "settings",
  ".toml": "settings",
  ".env": "settings"
};

// Special-folder names (lowercased) -> closed-state icon basename. The matching
// `<base>-open` variant is used when the folder is expanded (guarded below).
const FOLDER_ICONS: Record<string, string> = {
  src: "folder-src",
  source: "folder-src",
  sources: "folder-src",
  test: "folder-test",
  tests: "folder-test",
  __tests__: "folder-test",
  spec: "folder-test",
  specs: "folder-test",
  dist: "folder-dist",
  build: "folder-dist",
  out: "folder-dist",
  output: "folder-dist",
  node_modules: "folder-node",
  public: "folder-public",
  static: "folder-public",
  docs: "folder-docs",
  doc: "folder-docs",
  documentation: "folder-docs",
  ".vscode": "folder-vscode",
  ".git": "folder-git"
};

/**
 * Resolve the icon basename for a file. `language` disambiguates the `.h`
 * header (C by default, C++ when the active tab language is `cpp`); the
 * explorer omits it and gets the neutral default.
 */
export function resolveFileIconName(filename: string, language?: Language): string {
  const name = basename(filename);
  const byName = FILENAME_ICONS[name];
  if (byName) {
    return byName;
  }
  const ext = fileExtension(name);
  if (ext === ".h" && language === "cpp") {
    return "cpp";
  }
  return EXTENSION_ICONS[ext] ?? DEFAULT_FILE_ICON;
}

/** Resolve the icon basename for a folder, honoring its open/closed state. */
export function resolveFolderIconName(name: string, open: boolean): string {
  const base = FOLDER_ICONS[basename(name)] ?? DEFAULT_FOLDER_ICON;
  if (!open) {
    return base;
  }
  const openVariant = `${base}-open`;
  return FOLDER_ICON_SET.has(openVariant) ? openVariant : base;
}
