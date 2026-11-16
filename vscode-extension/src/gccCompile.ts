import * as path from "node:path";

const SAFE_BASENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isSupportedCompileSourcePath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".c";
}

export function isSafeSourceBasename(filePath: string): boolean {
  const base = path.basename(filePath);
  if (base.length === 0 || base.length > 128) {
    return false;
  }
  if (!SAFE_BASENAME_PATTERN.test(base)) {
    return false;
  }
  if (base === "." || base === ".." || base.includes("..") || base.includes("/") || base.includes("\\")) {
    return false;
  }
  return true;
}

export function buildStagedSourceBasename(requestId: string): string {
  return `compile_${requestId}_source.c`;
}

export function buildObjectBasename(requestId: string): string {
  return `compile_${requestId}.o`;
}

export interface CompileArtifactSummary {
  compileExit: number | undefined;
  objectStatus: string | undefined;
  objectName: string | undefined;
}

export interface CompileCounts {
  errorCount: number;
  warningCount: number;
  noteCount: number;
}

export interface CompileOutcome {
  final: "PASS" | "FAIL";
  reason:
    | "compile_pass"
    | "compile_failed"
    | "object_missing"
    | "compile_exit_missing";
}

export interface CompileDocumentCheckInput {
  hasEditor: boolean;
  isUntitled: boolean;
  uriScheme: string;
  isDirty: boolean;
  filePath: string;
}

export type CompileDocumentCheckReason =
  | "ok"
  | "no_active_editor"
  | "not_saved_file"
  | "unsupported_extension"
  | "dirty_document"
  | "unsafe_basename";

export function parseCompileArtifactSummary(fields: Record<string, string>): CompileArtifactSummary {
  const compileExitRaw = fields.OS4TB_GCC_COMPILE_EXIT;
  let compileExit: number | undefined;
  if (compileExitRaw !== undefined && /^-?[0-9]+$/.test(compileExitRaw)) {
    compileExit = Number.parseInt(compileExitRaw, 10);
  }
  return {
    compileExit,
    objectStatus: fields.OS4TB_GCC_OBJECT_STATUS,
    objectName: fields.OS4TB_GCC_OBJECT_NAME
  };
}

export function evaluateCompileOutcome(
  summary: CompileArtifactSummary,
  counts: CompileCounts
): CompileOutcome {
  if (summary.compileExit === undefined) {
    return { final: "FAIL", reason: "compile_exit_missing" };
  }
  if (summary.compileExit !== 0) {
    return { final: "FAIL", reason: "compile_failed" };
  }
  if (summary.objectStatus !== "present") {
    return { final: "FAIL", reason: "object_missing" };
  }
  if (counts.errorCount > 0) {
    return { final: "FAIL", reason: "compile_failed" };
  }
  return { final: "PASS", reason: "compile_pass" };
}

export function validateCompileDocument(input: CompileDocumentCheckInput): CompileDocumentCheckReason {
  if (!input.hasEditor) {
    return "no_active_editor";
  }
  if (input.isUntitled || input.uriScheme !== "file") {
    return "not_saved_file";
  }
  if (!isSupportedCompileSourcePath(input.filePath)) {
    return "unsupported_extension";
  }
  if (input.isDirty) {
    return "dirty_document";
  }
  if (!isSafeSourceBasename(input.filePath)) {
    return "unsafe_basename";
  }
  return "ok";
}
