import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExecutableBasename,
  evaluateBuildRunOutcome,
  parseBuildRunArtifactSummary,
  validateBuildRunDocument
} from "../src/gccBuildRun";

test("build/run document validation reuses compile rules", () => {
  const reason = validateBuildRunDocument({
    hasEditor: false,
    isUntitled: false,
    uriScheme: "file",
    isDirty: false,
    filePath: "/tmp/main.c"
  });
  assert.equal(reason, "no_active_editor");
});

test("build executable naming is deterministic", () => {
  assert.equal(
    buildExecutableBasename("gccrun_20261104T000000000Z_0001"),
    "build_gccrun_20261104T000000000Z_0001"
  );
});

test("parse build/run artifact summary", () => {
  const parsed = parseBuildRunArtifactSummary({
    OS4TB_GCC_BUILD_EXIT: "0",
    OS4TB_GCC_EXECUTABLE_STATUS: "present",
    OS4TB_GCC_EXECUTABLE_NAME: "build_req",
    OS4TB_GCC_EXECUTION_MODE: "build_and_run",
    OS4TB_GCC_EXECUTION_SKIPPED: "no",
    OS4TB_PROGRAM_EXIT: "0",
    OS4TB_PROGRAM_FINAL: "PASS"
  });
  assert.equal(parsed.buildExit, 0);
  assert.equal(parsed.executableStatus, "present");
  assert.equal(parsed.executableName, "build_req");
  assert.equal(parsed.executionMode, "build_and_run");
  assert.equal(parsed.executionSkipped, "no");
  assert.equal(parsed.programExitRaw, "0");
  assert.equal(parsed.programExit, 0);
});

test("clean build/run outcome is full pass", () => {
  const outcome = evaluateBuildRunOutcome(
    {
      buildExit: 0,
      executableStatus: "present",
      executableName: "build_req",
      executionMode: undefined,
      executionSkipped: undefined,
      programExitRaw: "0",
      programExit: 0,
      programFinal: "PASS"
    },
    { errorCount: 0, warningCount: 0, noteCount: 0 }
  );
  assert.equal(outcome.buildFinal, "PASS");
  assert.equal(outcome.programFinal, "PASS");
});

test("syntax-error build outcome fails and run is not executed", () => {
  const outcome = evaluateBuildRunOutcome(
    {
      buildExit: 1,
      executableStatus: "missing",
      executableName: "build_req",
      executionMode: undefined,
      executionSkipped: undefined,
      programExitRaw: undefined,
      programExit: undefined,
      programFinal: undefined
    },
    { errorCount: 1, warningCount: 0, noteCount: 0 }
  );
  assert.equal(outcome.buildFinal, "FAIL");
  assert.equal(outcome.programFinal, "NOT_RUN");
});

test("build success with nonzero runtime is run fail", () => {
  const outcome = evaluateBuildRunOutcome(
    {
      buildExit: 0,
      executableStatus: "present",
      executableName: "build_req",
      executionMode: undefined,
      executionSkipped: undefined,
      programExitRaw: "7",
      programExit: 7,
      programFinal: "FAIL"
    },
    { errorCount: 0, warningCount: 0, noteCount: 0 }
  );
  assert.equal(outcome.buildFinal, "PASS");
  assert.equal(outcome.programFinal, "FAIL");
});

test("build exit zero with missing executable is build fail", () => {
  const outcome = evaluateBuildRunOutcome(
    {
      buildExit: 0,
      executableStatus: "missing",
      executableName: "build_req",
      executionMode: undefined,
      executionSkipped: undefined,
      programExitRaw: undefined,
      programExit: undefined,
      programFinal: undefined
    },
    { errorCount: 0, warningCount: 0, noteCount: 0 }
  );
  assert.equal(outcome.buildFinal, "FAIL");
  assert.equal(outcome.buildReason, "executable_missing");
});

test("build-only outcome requires explicit not-run execution evidence", () => {
  const outcome = evaluateBuildRunOutcome(
    {
      buildExit: 0,
      executableStatus: "present",
      executableName: "build_req",
      executionMode: "build_only",
      executionSkipped: "yes",
      programExitRaw: "not_run",
      programExit: undefined,
      programFinal: "NOT_RUN"
    },
    { errorCount: 0, warningCount: 0, noteCount: 0 },
    { requestedExecutionMode: "build_only" }
  );
  assert.equal(outcome.buildFinal, "PASS");
  assert.equal(outcome.programFinal, "NOT_RUN");
});

test("build-only outcome fails closed on missing execution evidence", () => {
  const outcome = evaluateBuildRunOutcome(
    {
      buildExit: 0,
      executableStatus: "present",
      executableName: "build_req",
      executionMode: undefined,
      executionSkipped: undefined,
      programExitRaw: undefined,
      programExit: undefined,
      programFinal: undefined
    },
    { errorCount: 0, warningCount: 0, noteCount: 0 },
    { requestedExecutionMode: "build_only" }
  );
  assert.equal(outcome.buildFinal, "FAIL");
  assert.equal(outcome.buildReason, "execution_evidence_missing");
});

test("build-only outcome fails closed on contradictory execution evidence", () => {
  const outcome = evaluateBuildRunOutcome(
    {
      buildExit: 0,
      executableStatus: "present",
      executableName: "build_req",
      executionMode: "build_and_run",
      executionSkipped: "no",
      programExitRaw: "0",
      programExit: 0,
      programFinal: "PASS"
    },
    { errorCount: 0, warningCount: 0, noteCount: 0 },
    { requestedExecutionMode: "build_only" }
  );
  assert.equal(outcome.buildFinal, "FAIL");
  assert.equal(outcome.buildReason, "execution_evidence_mismatch");
});

test("build-only outcome rejects numeric sentinel exit values", () => {
  const outcome = evaluateBuildRunOutcome(
    {
      buildExit: 0,
      executableStatus: "present",
      executableName: "build_req",
      executionMode: "build_only",
      executionSkipped: "yes",
      programExitRaw: "-1",
      programExit: -1,
      programFinal: "NOT_RUN"
    },
    { errorCount: 0, warningCount: 0, noteCount: 0 },
    { requestedExecutionMode: "build_only" }
  );
  assert.equal(outcome.buildFinal, "FAIL");
  assert.equal(outcome.buildReason, "execution_evidence_mismatch");
});

