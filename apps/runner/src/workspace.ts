import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import type { RunnerConfig } from "./config.js";

export type WorkspacePaths = {
  containerPath: string;
  hostPath: string;
};

export async function createWorkspacePaths(config: RunnerConfig, prefix: string): Promise<WorkspacePaths> {
  await mkdir(config.workspaceContainerRoot, { recursive: true });
  const containerPath = await mkdtemp(path.join(config.workspaceContainerRoot, prefix));
  const hostPath =
    config.workspaceHostRoot === config.workspaceContainerRoot
      ? containerPath
      : path.join(config.workspaceHostRoot, path.basename(containerPath));

  return { containerPath, hostPath };
}
