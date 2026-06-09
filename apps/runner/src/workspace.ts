import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FILENAME_PATTERN,
  LANGUAGE_EXTENSIONS,
  RESERVED_FILENAMES,
  fileExtension,
  type Language,
  type ProjectFile
} from "@internal/shared";
import type { RunnerConfig } from "./config.js";

export type WorkspacePaths = {
  containerPath: string;
  hostPath: string;
};

/**
 * Defense-in-depth filename guard (the zod schema already validates the wire
 * request). Rejects path traversal, absolute/hidden names, disallowed
 * extensions, and reserved workspace filenames before anything is written.
 */
export function assertSafeFileName(name: string, language: Language): void {
  if (
    !FILENAME_PATTERN.test(name) ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..")
  ) {
    throw new Error(`Unsafe file name: ${name}`);
  }
  if (RESERVED_FILENAMES.includes(name.toLowerCase())) {
    throw new Error(`Reserved file name: ${name}`);
  }
  if (!LANGUAGE_EXTENSIONS[language].includes(fileExtension(name))) {
    throw new Error(`Disallowed ${language} file extension: ${name}`);
  }
}

/** Write every project file flat into the workspace root (mode 0o600). */
export async function writeProjectFiles(
  root: string,
  files: ProjectFile[],
  language: Language
): Promise<void> {
  for (const file of files) {
    assertSafeFileName(file.path, language);
    await writeFile(path.join(root, file.path), file.content, { mode: 0o600 });
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
