import test from "node:test";
import assert from "node:assert/strict";
import {
  buildObjectBasename,
  buildStagedSourceBasename,
  evaluateCompileOutcome,
  isSafeSourceBasename,
  isSupportedCompileSourcePath,
  parseCompileArtifactSummary,
  validateCompileDocument
} from "../src/gccCompile";

test("supported source extension is .c only", () => {
  assert.equal(isSupportedCompileSourcePath("/tmp/a.c"), true);
  assert.equal(isSupportedCompileSourcePath("/tmp/a.C"), true);
  assert.equal(isSupportedCompileSourcePath("/tmp/a.cpp"), false);
  assert.equal(isSupportedCompileSourcePath("/tmp/a.h"), false);
});

test("no active editor is rejected", () => {
  const reason = validateCompileDocument({
    hasEditor: false,
    isUntitled: false,
    uriScheme: "file",
    isDirty: false,
    filePath: "/tmp/main.c"
  });
  assert.equal(reason, "no_active_editor");
});

test("unsupported extension is rejected", () => {
  const reason = validateCompileDocument({
    hasEditor: true,
    isUntitled: false,
    uriScheme: "file",
    isDirty: false,
    filePath: "/tmp/main.cpp"
  });
  assert.equal(reason, "unsupported_extension");
});

test("dirty document is rejected", () => {
  const reason = validateCompileDocument({
    hasEditor: true,
    isUntitled: false,
    uriScheme: "file",
    isDirty: true,
    filePath: "/tmp/main.c"
  });
  assert.equal(reason, "dirty_document");
});

test("safe source basename accepts bounded alnum set", () => {
  assert.equal(isSafeSourceBasename("/tmp/hello_world-1.2.c"), true);
});

test("unsafe source basename rejects traversal and shell-shaped names", () => {
  assert.equal(isSafeSourceBasename("/tmp/foo;touch BAD.c"), false);
  assert.equal(isSafeSourceBasename("/tmp/foo$(cmd).c"), false);
  assert.equal(isSafeSourceBasename("/tmp/foo`cmd`.c"), false);
});

test("unsafe source basename is rejected by compile document validation", () => {
  const reason = validateCompileDocument({
    hasEditor: true,
    isUntitled: false,
    uriScheme: "file",
    isDirty: false,
    filePath: "/tmp/foo;touch BAD.c"
  });
  assert.equal(reason, "unsafe_basename");
});

test("request-specific staged naming is deterministic", () => {
  assert.equal(
    buildStagedSourceBasename("gcccmp_20261103T123456789Z_0001"),
    "compile_gcccmp_20261103T123456789Z_0001_source.c"
  );
});

test("object naming is deterministic", () => {
  assert.equal(
    buildObjectBasename("gcccmp_20261103T123456789Z_0001"),
    "compile_gcccmp_20261103T123456789Z_0001.o"
  );
});

test("compile artifact summary parses compile exit and object metadata", () => {
  const parsed = parseCompileArtifactSummary({
    OS4TB_GCC_COMPILE_EXIT: "0",
    OS4TB_GCC_OBJECT_STATUS: "present",
    OS4TB_GCC_OBJECT_NAME: "compile_id.o"
  });
  assert.equal(parsed.compileExit, 0);
  assert.equal(parsed.objectStatus, "present");
  assert.equal(parsed.objectName, "compile_id.o");
});

test("clean compile outcome is PASS", () => {
  const outcome = evaluateCompileOutcome(
    { compileExit: 0, objectStatus: "present", objectName: "compile_id.o" },
    { errorCount: 0, warningCount: 0, noteCount: 0 }
  );
  assert.equal(outcome.final, "PASS");
});

test("warning compile outcome is PASS", () => {
  const outcome = evaluateCompileOutcome(
    { compileExit: 0, objectStatus: "present", objectName: "compile_id.o" },
    { errorCount: 0, warningCount: 2, noteCount: 0 }
  );
  assert.equal(outcome.final, "PASS");
});

test("syntax-error compile outcome is FAIL", () => {
  const outcome = evaluateCompileOutcome(
    { compileExit: 1, objectStatus: "missing", objectName: "compile_id.o" },
    { errorCount: 1, warningCount: 0, noteCount: 0 }
  );
  assert.equal(outcome.final, "FAIL");
  assert.equal(outcome.reason, "compile_failed");
});

test("exit 0 with missing object is FAIL", () => {
  const outcome = evaluateCompileOutcome(
    { compileExit: 0, objectStatus: "missing", objectName: "compile_id.o" },
    { errorCount: 0, warningCount: 0, noteCount: 0 }
  );
  assert.equal(outcome.final, "FAIL");
  assert.equal(outcome.reason, "object_missing");
});
