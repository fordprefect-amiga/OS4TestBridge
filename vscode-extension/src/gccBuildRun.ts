import { CompileCounts, CompileDocumentCheckInput, validateCompileDocument } from "./gccCompile";

export interface BuildRunArtifactSummary {
  buildExit: number | undefined;
  executableStatus: string | undefined;
  executableName: string | undefined;
  executionMode: string | undefined;
  executionSkipped: string | undefined;
  programExitRaw: string | undefined;
  programExit: number | undefined;
  programFinal: string | undefined;
}

export interface BuildRunOutcome {
  buildFinal: "PASS" | "FAIL";
  buildReason:
    | "build_pass"
    | "build_failed"
    | "executable_missing"
    | "build_exit_missing"
    | "execution_evidence_missing"
    | "execution_evidence_mismatch";
  programFinal: "PASS" | "FAIL" | "NOT_RUN";
  programReason: "program_pass" | "program_failed" | "not_run";
}

export type BuildRunRequestedExecutionMode = "build_and_run" | "build_only";

export function validateBuildRunDocument(input: CompileDocumentCheckInput) {
  return validateCompileDocument(input);
}

export function buildExecutableBasename(requestId: string): string {
  return `build_${requestId}`;
}

export function parseBuildRunArtifactSummary(fields: Record<string, string>): BuildRunArtifactSummary {
  const buildExitRaw = fields.OS4TB_GCC_BUILD_EXIT;
  const programExitRaw = fields.OS4TB_PROGRAM_EXIT;
  let buildExit: number | undefined;
  let programExit: number | undefined;
  if (buildExitRaw !== undefined && /^-?[0-9]+$/.test(buildExitRaw)) {
    buildExit = Number.parseInt(buildExitRaw, 10);
  }
  if (programExitRaw !== undefined && /^-?[0-9]+$/.test(programExitRaw)) {
    programExit = Number.parseInt(programExitRaw, 10);
  }
  return {
    buildExit,
    executableStatus: fields.OS4TB_GCC_EXECUTABLE_STATUS,
    executableName: fields.OS4TB_GCC_EXECUTABLE_NAME,
    executionMode: fields.OS4TB_GCC_EXECUTION_MODE,
    executionSkipped: fields.OS4TB_GCC_EXECUTION_SKIPPED,
    programExitRaw,
    programExit,
    programFinal: fields.OS4TB_PROGRAM_FINAL
  };
}

export function evaluateBuildRunOutcome(
  summary: BuildRunArtifactSummary,
  counts: CompileCounts,
  options: { requestedExecutionMode?: BuildRunRequestedExecutionMode } = {}
): BuildRunOutcome {
  const requestedExecutionMode = options.requestedExecutionMode ?? "build_and_run";
  if (summary.buildExit === undefined) {
    return {
      buildFinal: "FAIL",
      buildReason: "build_exit_missing",
      programFinal: "NOT_RUN",
      programReason: "not_run"
    };
  }
  if (summary.buildExit !== 0 || counts.errorCount > 0) {
    return {
      buildFinal: "FAIL",
      buildReason: "build_failed",
      programFinal: "NOT_RUN",
      programReason: "not_run"
    };
  }
  if (summary.executableStatus !== "present") {
    return {
      buildFinal: "FAIL",
      buildReason: "executable_missing",
      programFinal: "NOT_RUN",
      programReason: "not_run"
    };
  }
  if (requestedExecutionMode === "build_only") {
    if (
      summary.executionMode === undefined ||
      summary.executionSkipped === undefined ||
      summary.programExitRaw === undefined ||
      summary.programFinal === undefined
    ) {
      return {
        buildFinal: "FAIL",
        buildReason: "execution_evidence_missing",
        programFinal: "NOT_RUN",
        programReason: "not_run"
      };
    }
    if (
      summary.executionMode !== "build_only" ||
      summary.executionSkipped !== "yes" ||
      summary.programExitRaw !== "not_run" ||
      summary.programFinal !== "NOT_RUN"
    ) {
      return {
        buildFinal: "FAIL",
        buildReason: "execution_evidence_mismatch",
        programFinal: "NOT_RUN",
        programReason: "not_run"
      };
    }
    return {
      buildFinal: "PASS",
      buildReason: "build_pass",
      programFinal: "NOT_RUN",
      programReason: "not_run"
    };
  }
  if (
    (summary.executionMode !== undefined && summary.executionMode !== "build_and_run") ||
    summary.executionSkipped === "yes"
  ) {
    return {
      buildFinal: "FAIL",
      buildReason: "execution_evidence_mismatch",
      programFinal: "NOT_RUN",
      programReason: "not_run"
    };
  }
  if (summary.programExit === 0) {
    return {
      buildFinal: "PASS",
      buildReason: "build_pass",
      programFinal: "PASS",
      programReason: "program_pass"
    };
  }
  return {
    buildFinal: "PASS",
    buildReason: "build_pass",
    programFinal: "FAIL",
    programReason: "program_failed"
  };
}

export function resolveReportedProgramExit(
  summary: BuildRunArtifactSummary,
  options: { requestedExecutionMode?: BuildRunRequestedExecutionMode } = {}
): string {
  if (
    options.requestedExecutionMode === "build_only" &&
    summary.executionMode === "build_only" &&
    summary.executionSkipped === "yes" &&
    summary.programExitRaw === "not_run" &&
    summary.programFinal === "NOT_RUN"
  ) {
    return "not_run";
  }
  return `${summary.programExit ?? "missing"}`;
}
