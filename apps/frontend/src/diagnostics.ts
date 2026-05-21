export type DiagnosticSeverity = "error" | "warning";

export type Diagnostic = {
  severity: DiagnosticSeverity;
  file?: string;
  line?: number;
  column?: number;
  message: string;
  raw: string;
};

const GCC_DIAGNOSTIC_LINE =
  /^(?<file>.+?):(?<line>\d+)(?::(?<column>\d+))?:\s*(?<severity>warning|error|fatal error):\s*(?<message>.*)$/;

export function parseCompilerDiagnostics(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trimEnd();
    const match = GCC_DIAGNOSTIC_LINE.exec(raw);
    if (!match?.groups) {
      continue;
    }

    const { file, line, column, message = "", severity: matchedSeverity } = match.groups;
    if (!file || !line) {
      continue;
    }

    const severity = matchedSeverity === "warning" ? "warning" : "error";
    diagnostics.push({
      severity,
      file,
      line: Number(line),
      column: column ? Number(column) : undefined,
      message,
      raw
    });
  }

  return diagnostics;
}

export function isCompilerDiagnosticContext(text: string): boolean {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return true;
  }

  return lines.every((line) =>
    /^\d+\s*\|/.test(line) ||
    /^\|\s*[\^~]/.test(line) ||
    /^.*?:\s+(In function|At top level)/.test(line) ||
    /^(In file included from|from)\s+/.test(line) ||
    line === "compilation terminated."
  );
}
