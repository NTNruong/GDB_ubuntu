export function parseBreakpointText(value: string): number[] {
  if (/^\s*e\.?g\.?/i.test(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  ).sort((a, b) => a - b);
}

export function toggleBreakpointText(current: string, line: number): string {
  const currentLines = new Set(parseBreakpointText(current));
  if (currentLines.has(line)) {
    currentLines.delete(line);
  } else {
    currentLines.add(line);
  }

  return Array.from(currentLines)
    .sort((a, b) => a - b)
    .join(", ");
}
