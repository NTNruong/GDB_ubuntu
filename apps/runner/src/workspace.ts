import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FILENAME_PATTERN,
  LANGUAGE_EXTENSIONS,
  RESERVED_FILENAMES,
  basename,
  fileExtension,
  parseUserPath,
  type Language,
  type ProjectFile
} from "@internal/shared";
import type { RunnerConfig } from "./config.js";

export type WorkspacePaths = {
  containerPath: string;
  hostPath: string;
};

/**
 * Defense-in-depth path guard (the zod schema already validates the wire
 * request). Python projects may use nested package folders ("pkg/util.py",
 * validated via parseUserPath); every other language stays single-segment.
 * Rejects path traversal, absolute/hidden names, disallowed extensions, and
 * reserved workspace filenames before anything is written.
 */
export function assertSafeFileName(name: string, language: Language): void {
  if (language === "python") {
    // parseUserPath confines to relative, "/"-separated segments of the file
    // charset (no "..", no leading dot, no backslash, bounded depth).
    if (parseUserPath(name) === null) {
      throw new Error(`Unsafe file path: ${name}`);
    }
  } else if (
    !FILENAME_PATTERN.test(name) ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..")
  ) {
    throw new Error(`Unsafe file name: ${name}`);
  }
  const base = basename(name);
  if (RESERVED_FILENAMES.includes(base.toLowerCase())) {
    throw new Error(`Reserved file name: ${base}`);
  }
  if (!LANGUAGE_EXTENSIONS[language].includes(fileExtension(base))) {
    throw new Error(`Disallowed ${language} file extension: ${name}`);
  }
}

/**
 * Write every project file into the workspace (mode 0o600). Flat for most
 * languages; Python may carry nested paths ("pkg/util.py"), so the parent
 * directory is created first. Paths are guarded by assertSafeFileName.
 */
export async function writeProjectFiles(
  root: string,
  files: ProjectFile[],
  language: Language
): Promise<void> {
  for (const file of files) {
    assertSafeFileName(file.path, language);
    const target = path.join(root, file.path);
    const dir = path.dirname(target);
    if (dir !== root) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    }
    await writeFile(target, file.content, { mode: 0o600 });
  }
}

export async function createWorkspacePaths(config: RunnerConfig, prefix: string): Promise<WorkspacePaths> {
  await mkdir(config.workspaceContainerRoot, { recursive: true });
  const containerPath = await mkdtemp(path.join(config.workspaceContainerRoot, prefix));
  const hostPath =
    config.workspaceHostRoot === config.workspaceContainerRoot
      ? containerPath
      : path.join(config.workspaceHostRoot, path.basename(containerPath));

  return { containerPath, hostPath };
}
