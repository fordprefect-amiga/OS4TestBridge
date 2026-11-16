import * as path from "node:path";
import { GCCDiagnostic } from "./gccDiagnostics";

const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const SAMDROP_INCOMING_PREFIX = "SAMDROP:incoming/";
const GCC_PROBLEM_SOURCE = "OS4 Test Bridge GCC";

export interface ParsedBridgeConfig {
  shareRoot?: string;
  incomingDir?: string;
}

export interface MappedProblemEntry {
  filePath: string;
  lineZero: number;
  startColumnZero: number;
  endColumnZero: number;
  severity: "error" | "warning" | "information";
  message: string;
  source: string;
}

export interface ProblemPublishPlan {
  entriesByFile: Record<string, MappedProblemEntry[]>;
  mappedCount: number;
  errorCount: number;
  warningCount: number;
  noteCount: number;
  unmappedCount: number;
}

export interface ProblemPublishPlanOptions {
  sourceRemap?: Record<string, string>;
}

export function normalizeSamdropIncomingPath(guestPath: string): string | undefined {
  if (!guestPath.startsWith(SAMDROP_INCOMING_PREFIX)) {
    return undefined;
  }

  const relativePath = guestPath.slice(SAMDROP_INCOMING_PREFIX.length);
  if (relativePath.length === 0 || relativePath.startsWith("/")) {
    return undefined;
  }

  const segments = relativePath.split("/");
  if (segments.length === 0) {
    return undefined;
  }

  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      return undefined;
    }
    if (!SAFE_SEGMENT_PATTERN.test(segment)) {
      return undefined;
    }
  }

  return `${SAMDROP_INCOMING_PREFIX}${segments.join("/")}`;
}

export function parseBridgeConfig(text: string): ParsedBridgeConfig {
  let shareRoot: string | undefined;
  let incomingDir: string | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (value.length === 0) {
      continue;
    }
    if (key === "share_root" && shareRoot === undefined) {
      shareRoot = value;
    } else if (key === "incoming_dir" && incomingDir === undefined) {
      incomingDir = value;
    }
  }

  return { shareRoot, incomingDir };
}

export function resolveIncomingDirectoryFromConfig(config: ParsedBridgeConfig): string | undefined {
  if (config.incomingDir && config.incomingDir.length > 0) {
    return config.incomingDir;
  }
  if (config.shareRoot && config.shareRoot.length > 0) {
    return path.join(config.shareRoot, "incoming");
  }
  return undefined;
}

export function mapBridgeDiagnosticPathToHost(
  diagnosticPath: string,
  incomingDirectory: string
): string | undefined {
  const normalizedGuestPath = normalizeSamdropIncomingPath(diagnosticPath);
  if (!normalizedGuestPath) {
    return undefined;
  }

  const relativePath = normalizedGuestPath.slice(SAMDROP_INCOMING_PREFIX.length);
  const segments = relativePath.split("/");

  const base = path.resolve(incomingDirectory);
  const mapped = path.resolve(base, ...segments);
  if (mapped !== base && !mapped.startsWith(`${base}${path.sep}`)) {
    return undefined;
  }

  return mapped;
}

function mapSeverity(severity: GCCDiagnostic["severity"]): "error" | "warning" | "information" {
  if (severity === "error") {
    return "error";
  }
  if (severity === "warning") {
    return "warning";
  }
  return "information";
}

function toProblemEntry(diagnostic: GCCDiagnostic, hostFilePath: string): MappedProblemEntry {
  const lineZero = Math.max(0, diagnostic.line - 1);
  const startColumnZero = diagnostic.column !== undefined ? Math.max(0, diagnostic.column - 1) : 0;
  const endColumnZero = startColumnZero + 1;

  return {
    filePath: hostFilePath,
    lineZero,
    startColumnZero,
    endColumnZero,
    severity: mapSeverity(diagnostic.severity),
    message: diagnostic.message,
    source: GCC_PROBLEM_SOURCE
  };
}

export function buildProblemPublishPlan(
  diagnostics: GCCDiagnostic[],
  incomingDirectory: string,
  options?: ProblemPublishPlanOptions
): ProblemPublishPlan {
  const entriesByFile: Record<string, MappedProblemEntry[]> = {};
  let mappedCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  let noteCount = 0;
  let unmappedCount = 0;

  const normalizedSourceRemap: Record<string, string> = {};
  if (options?.sourceRemap) {
    for (const [key, value] of Object.entries(options.sourceRemap)) {
      const normalizedKey = normalizeSamdropIncomingPath(key);
      if (normalizedKey) {
        normalizedSourceRemap[normalizedKey] = value;
      }
    }
  }

  for (const diagnostic of diagnostics) {
    const normalizedDiagnosticPath = normalizeSamdropIncomingPath(diagnostic.file);
    const remappedPath = normalizedDiagnosticPath ? normalizedSourceRemap[normalizedDiagnosticPath] : undefined;
    const hostFilePath = options?.sourceRemap
      ? remappedPath
      : remappedPath ?? mapBridgeDiagnosticPathToHost(diagnostic.file, incomingDirectory);
    if (!hostFilePath) {
      unmappedCount += 1;
      continue;
    }

    const entry = toProblemEntry(diagnostic, hostFilePath);
    if (!entriesByFile[entry.filePath]) {
      entriesByFile[entry.filePath] = [];
    }
    entriesByFile[entry.filePath].push(entry);
    mappedCount += 1;

    if (diagnostic.severity === "error") {
      errorCount += 1;
    } else if (diagnostic.severity === "warning") {
      warningCount += 1;
    } else {
      noteCount += 1;
    }
  }

  return {
    entriesByFile,
    mappedCount,
    errorCount,
    warningCount,
    noteCount,
    unmappedCount
  };
}

export interface CollectionLike<T> {
  clear(): void;
  set(entries: Array<[string, T[]]>): void;
}

export function selectProblemSummaryLabel(
  plan: { entriesByFile: Record<string, Array<{ severity: string }>> },
  preferredMultiFileLabel = "project"
): string {
  const errorFiles = Object.entries(plan.entriesByFile)
    .filter(([, entries]) => entries.some((entry) => entry.severity === "error"))
    .map(([filePath]) => filePath);
  if (errorFiles.length === 1) {
    return path.basename(errorFiles[0]);
  }
  return preferredMultiFileLabel;
}

export function clearProblemsCollection<T>(collection: CollectionLike<T>): void {
  collection.clear();
}

export function replaceProblemsCollection<T>(
  collection: CollectionLike<T>,
  entriesByFile: Record<string, T[]>
): void {
  collection.clear();
  const entries = Object.entries(entriesByFile);
  collection.set(entries);
}
