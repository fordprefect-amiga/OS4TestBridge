import { parseGccDiagnostics } from "./gccDiagnostics";
import { ToolchainFamily } from "./toolchainDiscovery";

export type ProjectDiagnosticStage = "compile" | "assemble" | "link";
export type ProjectDiagnosticSeverity = "error" | "warning" | "info";
export type ProjectDiagnosticFamily = ToolchainFamily | "gnu_as" | "vasm";

export interface ProjectDiagnostic {
  family: ProjectDiagnosticFamily;
  stage: ProjectDiagnosticStage;
  severity: ProjectDiagnosticSeverity;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
  raw: string;
}

export interface ProjectDiagnosticSummary {
  total: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

const VBCC_COMPILE_PATTERN = /^(error|warning)\s+([0-9]+)\s+in line\s+([0-9]+)\s+of\s+"([^"]+)":\s*(.+)$/i;
const VBCC_LINK_PATTERN = /^Error\s+([0-9]+):\s+(.+)$/;
const GNU_AS_PATTERN = /^(.*):([0-9]+):\s*(Error|Warning):\s*(.+)$/;
const MAX_DIAGNOSTIC_LINE_LENGTH = 4096;

export function parseProjectDiagnosticsByFamily(params: {
  family: ProjectDiagnosticFamily;
  gccText?: string;
  vbccCompileTexts?: string[];
  vbccLinkText?: string;
  assemblerTexts?: string[];
  linkText?: string;
}): ProjectDiagnostic[] {
  switch (params.family) {
    case "gcc": {
      const diagnostics = parseGccProjectDiagnostics(params.gccText ?? "");
      if (params.linkText) {
        diagnostics.push(...parseProjectLinkDiagnostics(params.linkText, "gcc"));
      }
      return deduplicateProjectDiagnostics(diagnostics);
    }
    case "vbcc":
      return parseVbccProjectDiagnostics({
        compileTexts: params.vbccCompileTexts ?? [],
        linkText: params.vbccLinkText ?? params.linkText
      });
    case "gnu_as": {
      const diagnostics: ProjectDiagnostic[] = [];
      for (const text of params.assemblerTexts ?? []) {
        diagnostics.push(...parseGnuAssemblerProjectDiagnostics(text));
      }
      if (params.linkText) {
        diagnostics.push(...parseProjectLinkDiagnostics(params.linkText, "gnu_as"));
      }
      return deduplicateProjectDiagnostics(diagnostics);
    }
    case "vasm": {
      const diagnostics: ProjectDiagnostic[] = [];
      for (const text of params.assemblerTexts ?? []) {
        diagnostics.push(...parseVasmProjectDiagnostics(text));
      }
      if (params.linkText) {
        diagnostics.push(...parseProjectLinkDiagnostics(params.linkText, "vasm"));
      }
      return deduplicateProjectDiagnostics(diagnostics);
    }
  }
}

export function parseGccProjectDiagnostics(text: string): ProjectDiagnostic[] {
  return parseGccDiagnostics(text).map((diagnostic) => ({
    family: "gcc",
    stage: "compile",
    severity: diagnostic.severity === "note" ? "info" : diagnostic.severity,
    file: diagnostic.file,
    line: diagnostic.line,
    column: diagnostic.column,
    message: diagnostic.message,
    raw: diagnostic.message
  }));
}

export function parseVbccProjectDiagnostics(params: {
  compileTexts: string[];
  linkText?: string;
}): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = [];
  for (const compileText of params.compileTexts) {
    diagnostics.push(...parseVbccDiagnosticsForStage(compileText, "compile"));
  }
  if (params.linkText) {
    diagnostics.push(...parseVbccDiagnosticsForStage(params.linkText, "link"));
  }
  return deduplicateProjectDiagnostics(diagnostics);
}

export function parseVbccDiagnosticsForStage(
  text: string,
  stage: "compile" | "link"
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length === 0 || rawLine.length > MAX_DIAGNOSTIC_LINE_LENGTH) {
      continue;
    }
    if (stage === "compile") {
      const compileMatch = rawLine.match(VBCC_COMPILE_PATTERN);
      if (!compileMatch) {
        continue;
      }
      const severityRaw = compileMatch[1].toLowerCase();
      const code = compileMatch[2];
      const lineRaw = compileMatch[3];
      const file = compileMatch[4];
      const message = compileMatch[5];
      const line = Number.parseInt(lineRaw, 10);
      if (!Number.isInteger(line) || line < 1) {
        continue;
      }
      const severity: ProjectDiagnosticSeverity = severityRaw === "warning" ? "warning" : "error";
      diagnostics.push({
        family: "vbcc",
        stage: "compile",
        severity,
        file,
        line,
        code,
        message,
        raw: rawLine
      });
      continue;
    }

    diagnostics.push(...parseProjectLinkDiagnostics(rawLine, "vbcc"));
  }
  return diagnostics;
}

export function parseGnuAssemblerProjectDiagnostics(text: string): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length === 0 || rawLine.length > MAX_DIAGNOSTIC_LINE_LENGTH) {
      continue;
    }
    const match = rawLine.match(GNU_AS_PATTERN);
    if (!match) {
      continue;
    }
    const line = Number.parseInt(match[2], 10);
    if (!Number.isInteger(line) || line < 1) {
      continue;
    }
    const severityRaw = match[3].toLowerCase();
    const severity: ProjectDiagnosticSeverity = severityRaw === "warning" ? "warning" : "error";
    diagnostics.push({
      family: "gnu_as",
      stage: "assemble",
      severity,
      file: match[1],
      line,
      message: match[4].trim(),
      raw: rawLine
    });
  }
  return diagnostics;
}

export function parseVasmProjectDiagnostics(text: string): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length === 0 || rawLine.length > MAX_DIAGNOSTIC_LINE_LENGTH) {
      continue;
    }
    const match = rawLine.match(VBCC_COMPILE_PATTERN);
    if (!match) {
      continue;
    }
    const severityRaw = match[1].toLowerCase();
    const line = Number.parseInt(match[3], 10);
    if (!Number.isInteger(line) || line < 1) {
      continue;
    }
    const severity: ProjectDiagnosticSeverity = severityRaw === "warning" ? "warning" : "error";
    diagnostics.push({
      family: "vasm",
      stage: "assemble",
      severity,
      file: match[4],
      line,
      code: match[2],
      message: match[5].trim(),
      raw: rawLine
    });
  }
  return diagnostics;
}

export function parseProjectLinkDiagnostics(
  text: string,
  family: ProjectDiagnosticFamily
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length === 0 || rawLine.length > MAX_DIAGNOSTIC_LINE_LENGTH) {
      continue;
    }
    const linkMatch = rawLine.match(VBCC_LINK_PATTERN);
    if (!linkMatch) {
      continue;
    }
    diagnostics.push({
      family,
      stage: "link",
      severity: "error",
      code: linkMatch[1],
      message: linkMatch[2].trim(),
      raw: rawLine
    });
  }
  return diagnostics;
}

export function deduplicateProjectDiagnostics(diagnostics: ProjectDiagnostic[]): ProjectDiagnostic[] {
  const seen = new Set<string>();
  const deduped: ProjectDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.family,
      diagnostic.stage,
      diagnostic.severity,
      diagnostic.file ?? "",
      diagnostic.line === undefined ? "" : String(diagnostic.line),
      diagnostic.column === undefined ? "" : String(diagnostic.column),
      diagnostic.code ?? "",
      diagnostic.message
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(diagnostic);
  }
  return deduped;
}

export function summarizeProjectDiagnostics(diagnostics: ProjectDiagnostic[]): ProjectDiagnosticSummary {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      errorCount += 1;
    } else if (diagnostic.severity === "warning") {
      warningCount += 1;
    } else {
      infoCount += 1;
    }
  }
  return {
    total: diagnostics.length,
    errorCount,
    warningCount,
    infoCount
  };
}
