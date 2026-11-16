export interface GCCDiagnostic {
  file: string;
  line: number;
  column?: number;
  severity: "error" | "warning" | "note";
  message: string;
}

const GCC_DIAGNOSTIC_PATTERN = /^(.*):\s*(error|warning|note):\s(.*)$/;

export function parseGccDiagnostics(text: string): GCCDiagnostic[] {
  const diagnostics: GCCDiagnostic[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length === 0) {
      continue;
    }

    const match = rawLine.match(GCC_DIAGNOSTIC_PATTERN);
    if (!match) {
      continue;
    }

    const location = match[1];
    const severity = match[2] as GCCDiagnostic["severity"];
    const message = match[3];
    const locationParts = location.split(":");
    if (locationParts.length < 2) {
      continue;
    }
    const lastPart = locationParts.pop() ?? "";
    if (!/^[0-9]+$/.test(lastPart)) {
      continue;
    }

    let file = "";
    let line = 0;
    let column: number | undefined;
    const previousPart = locationParts[locationParts.length - 1];
    if (previousPart !== undefined && /^[0-9]+$/.test(previousPart)) {
      const columnPart = lastPart;
      const linePart = locationParts.pop() ?? "";
      file = locationParts.join(":");
      line = Number.parseInt(linePart, 10);
      column = Number.parseInt(columnPart, 10);
    } else {
      file = locationParts.join(":");
      line = Number.parseInt(lastPart, 10);
    }
    if (file.length === 0) {
      continue;
    }

    if (!Number.isInteger(line) || line < 1) {
      continue;
    }
    if (column !== undefined && (!Number.isInteger(column) || column < 1)) {
      continue;
    }

    if (column === undefined) {
      diagnostics.push({
        file,
        line,
        severity,
        message
      });
    } else {
      diagnostics.push({
        file,
        line,
        column,
        severity,
        message
      });
    }
  }

  return diagnostics;
}

export function summarizeGccDiagnostics(diagnostics: GCCDiagnostic[]): {
  total: number;
  errorCount: number;
  warningCount: number;
  noteCount: number;
} {
  let errorCount = 0;
  let warningCount = 0;
  let noteCount = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      errorCount += 1;
    } else if (diagnostic.severity === "warning") {
      warningCount += 1;
    } else {
      noteCount += 1;
    }
  }

  return {
    total: diagnostics.length,
    errorCount,
    warningCount,
    noteCount
  };
}

export function extractGccVersion(text: string): string | undefined {
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("OS4TB_GCC_VERSION=")) {
      const value = trimmed.slice("OS4TB_GCC_VERSION=".length).trim();
      if (value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}
