import { CompileCounts, CompileDocumentCheckInput, validateCompileDocument } from "./gccCompile";

export interface BuildRunArtifactSummary {
  buildExit: number | undefined;
  executableStatus: string | undefined;
  executableName: string | undefined;
  programExit: number | undefined;
  programFinal: string | undefined;
}

export interface BuildRunOutcome {
  buildFinal: "PASS" | "FAIL";
  buildReason: "build_pass" | "build_failed" | "executable_missing" | "build_exit_missing";
  programFinal: "PASS" | "FAIL" | "NOT_RUN";
  programReason: "program_pass" | "program_failed" | "not_run";
}

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
    programExit,
    programFinal: fields.OS4TB_PROGRAM_FINAL
  };
}

export function evaluateBuildRunOutcome(
  summary: BuildRunArtifactSummary,
  counts: CompileCounts
): BuildRunOutcome {
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
