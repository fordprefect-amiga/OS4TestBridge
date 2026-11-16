import { ProjectDiagnostic } from "./projectDiagnostics";
import {
  MappedProblemEntry,
  mapBridgeDiagnosticPathToHost,
  normalizeSamdropIncomingPath
} from "./gccProblems";

export interface ProjectProblemPublishPlan {
  entriesByFile: Record<string, MappedProblemEntry[]>;
  mappedCount: number;
  unmappedCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  unboundDiagnostics: ProjectDiagnostic[];
}

export interface ProjectProblemPublishPlanOptions {
  sourceRemap?: Record<string, string>;
  stagedRelativeSourceMap?: Record<string, string>;
  stagedBasenameSourceMap?: Record<string, string>;
}

function mapSeverity(severity: ProjectDiagnostic["severity"]): "error" | "warning" | "information" {
  if (severity === "error") {
    return "error";
  }
  if (severity === "warning") {
    return "warning";
  }
  return "information";
}

function toProblemEntry(diagnostic: ProjectDiagnostic, hostFilePath: string): MappedProblemEntry {
  const lineZero = Math.max(0, (diagnostic.line ?? 1) - 1);
  const startColumnZero = diagnostic.column !== undefined ? Math.max(0, diagnostic.column - 1) : 0;
  const endColumnZero = startColumnZero + 1;
  const codePrefix = diagnostic.code ? `[${diagnostic.code}] ` : "";
  const stagePrefix = `[${diagnostic.stage}] `;
  let source = "OS4 Test Bridge GCC";
  if (diagnostic.family === "vbcc") {
    source = "OS4 Test Bridge VBCC";
  } else if (diagnostic.family === "gnu_as") {
    source = "OS4 Test Bridge GNU as";
  } else if (diagnostic.family === "vasm") {
    source = "OS4 Test Bridge VASM";
  }
  return {
    filePath: hostFilePath,
    lineZero,
    startColumnZero,
    endColumnZero,
    severity: mapSeverity(diagnostic.severity),
    message: `${stagePrefix}${codePrefix}${diagnostic.message}`,
    source
  };
}

function resolveHostPath(
  diagnostic: ProjectDiagnostic,
  incomingDirectory: string,
  options?: ProjectProblemPublishPlanOptions
): string | undefined {
  const file = diagnostic.file;
  if (!file) {
    return undefined;
  }

  const normalizedSourceRemap: Record<string, string> = {};
  if (options?.sourceRemap) {
    for (const [key, value] of Object.entries(options.sourceRemap)) {
      const normalized = normalizeSamdropIncomingPath(key);
      if (normalized) {
        normalizedSourceRemap[normalized] = value;
      }
    }
  }

  const normalizedPath = normalizeSamdropIncomingPath(file);
  if (normalizedPath && normalizedSourceRemap[normalizedPath]) {
    return normalizedSourceRemap[normalizedPath];
  }
  if (normalizedPath) {
    return mapBridgeDiagnosticPathToHost(normalizedPath, incomingDirectory);
  }

  if (options?.stagedRelativeSourceMap && options.stagedRelativeSourceMap[file]) {
    return options.stagedRelativeSourceMap[file];
  }
  if (options?.stagedBasenameSourceMap && options.stagedBasenameSourceMap[file]) {
    return options.stagedBasenameSourceMap[file];
  }
  return undefined;
}

export function buildProjectProblemPublishPlan(
  diagnostics: ProjectDiagnostic[],
  incomingDirectory: string,
  options?: ProjectProblemPublishPlanOptions
): ProjectProblemPublishPlan {
  const entriesByFile: Record<string, MappedProblemEntry[]> = {};
  const unboundDiagnostics: ProjectDiagnostic[] = [];
  let mappedCount = 0;
  let unmappedCount = 0;
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

    if (!diagnostic.file || diagnostic.line === undefined) {
      unboundDiagnostics.push(diagnostic);
      continue;
    }

    const hostFilePath = resolveHostPath(diagnostic, incomingDirectory, options);
    if (!hostFilePath) {
      unmappedCount += 1;
      unboundDiagnostics.push(diagnostic);
      continue;
    }

    const entry = toProblemEntry(diagnostic, hostFilePath);
    if (!entriesByFile[entry.filePath]) {
      entriesByFile[entry.filePath] = [];
    }
    entriesByFile[entry.filePath].push(entry);
    mappedCount += 1;
  }

  return {
    entriesByFile,
    mappedCount,
    unmappedCount,
    errorCount,
    warningCount,
    infoCount,
    unboundDiagnostics
  };
}
