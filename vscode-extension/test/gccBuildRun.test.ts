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
    OS4TB_PROGRAM_EXIT: "0",
    OS4TB_PROGRAM_FINAL: "PASS"
  });
  assert.equal(parsed.buildExit, 0);
  assert.equal(parsed.executableStatus, "present");
  assert.equal(parsed.executableName, "build_req");
  assert.equal(parsed.programExit, 0);
});

test("clean build/run outcome is full pass", () => {
  const outcome = evaluateBuildRunOutcome(
    {
      buildExit: 0,
      executableStatus: "present",
      executableName: "build_req",
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
      programExit: undefined,
      programFinal: undefined
    },
    { errorCount: 0, warningCount: 0, noteCount: 0 }
  );
  assert.equal(outcome.buildFinal, "FAIL");
  assert.equal(outcome.buildReason, "executable_missing");
});

