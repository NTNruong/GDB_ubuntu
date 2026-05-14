import type { DebugFrame, DebugVariable } from "@internal/shared";

export function decodeMiString(value: string): string {
  try {
    return JSON.parse(value) as string;
  } catch {
    return value.replace(/^"/, "").replace(/"$/, "");
  }
}

export function escapeMiString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function parseStopped(line: string): { reason?: string; file?: string; line?: number; func?: string } | null {
  if (!line.startsWith("*stopped")) {
    return null;
  }

  return {
    reason: matchField(line, "reason"),
    file: matchField(line, "fullname") ?? matchField(line, "file"),
    line: toNumber(matchField(line, "line")),
    func: matchField(line, "func")
  };
}

export function parseStack(line: string): DebugFrame[] | null {
  if (!line.includes("^done,stack=")) {
    return null;
  }

  const frames: DebugFrame[] = [];
  const frameRegex = /frame=\{([^}]+)\}/g;
  let match = frameRegex.exec(line);
  while (match) {
    const body = match[1] ?? "";
    frames.push({
      level: toNumber(matchField(body, "level")) ?? frames.length,
      func: matchField(body, "func") ?? "??",
      file: matchField(body, "fullname") ?? matchField(body, "file") ?? undefined,
      line: toNumber(matchField(body, "line"))
    });
    match = frameRegex.exec(line);
  }

  return frames;
}

export function parseVariables(line: string): DebugVariable[] | null {
  if (!line.includes("^done,variables=")) {
    return null;
  }

  const variables: DebugVariable[] = [];
  const variableRegex = /\{name="([^"]+)"(?:,arg="[^"]*")?(?:,value=("(?:\\.|[^"])*"))?[^}]*\}/g;
  let match = variableRegex.exec(line);
  while (match) {
    variables.push({
      name: decodeMiString(`"${match[1]}"`),
      value: match[2] ? decodeMiString(match[2]) : undefined
    });
    match = variableRegex.exec(line);
  }

  return variables;
}

export function parseDoneValue(line: string): string | undefined {
  const value = matchField(line, "value");
  return value;
}

function matchField(input: string, field: string): string | undefined {
  const regex = new RegExp(`${field}="((?:\\\\.|[^"])*)"`);
  const match = regex.exec(input);
  return match?.[1] ? decodeMiString(`"${match[1]}"`) : undefined;
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
