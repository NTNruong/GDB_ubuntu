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

// Linker errors (e.g. missing or duplicate main()) carry no file:line:col, so the GCC
// regex above misses them. Surface them so they reach the Error List, not just Output.
const LINKER_ERROR = /(undefined reference to|multiple definition of)\b.*/;

export function parseCompilerDiagnostics(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trimEnd();
    const match = GCC_DIAGNOSTIC_LINE.exec(raw);
    if (match?.groups) {
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
      continue;
    }

    const linkerMatch = LINKER_ERROR.exec(raw);
    if (linkerMatch) {
      // Drop the "; … first defined here" tail and the leading object-file offset noise.
      const semicolon = linkerMatch[0].indexOf(";");
      const message = (semicolon >= 0 ? linkerMatch[0].slice(0, semicolon) : linkerMatch[0]).trim();
      if (message) {
        diagnostics.push({ severity: "error", message, raw });
      }
    }
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
