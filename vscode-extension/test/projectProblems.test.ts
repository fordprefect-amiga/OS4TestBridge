import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildProjectProblemPublishPlan } from "../src/projectProblems";
import { ProjectDiagnostic } from "../src/projectDiagnostics";

const incomingDir = path.join("/tmp", "os4tb-share", "incoming");

test("vbcc compile diagnostics map by staged basename when unique", () => {
  const diagnostics: ProjectDiagnostic[] = [
    {
      family: "vbcc",
      stage: "compile",
      severity: "error",
      file: "helper.c",
      line: 7,
      code: "82",
      message: "unknown identifier <missing_identifier>",
      raw: "error 82 in line 7 of \"helper.c\": unknown identifier <missing_identifier>"
    }
  ];
  const hostHelper = path.join("/workspace/project/src", "helper.c");
  const plan = buildProjectProblemPublishPlan(diagnostics, incomingDir, {
    stagedBasenameSourceMap: {
      "helper.c": hostHelper
    }
  });
  assert.equal(plan.mappedCount, 1);
  assert.equal(plan.unboundDiagnostics.length, 0);
  assert.equal((plan.entriesByFile[hostHelper] ?? [])[0].lineZero, 6);
});

test("vbcc linker diagnostics remain visible as unbound without fake source location", () => {
  const diagnostics: ProjectDiagnostic[] = [
    {
      family: "vbcc",
      stage: "link",
      severity: "error",
      code: "21",
      message: "libobj_math_sin.o (.text+0x20): Reference to undefined symbol sin.",
      raw: "Error 21: libobj_math_sin.o (.text+0x20): Reference to undefined symbol sin."
    }
  ];
  const plan = buildProjectProblemPublishPlan(diagnostics, incomingDir);
  assert.equal(plan.mappedCount, 0);
  assert.equal(plan.unboundDiagnostics.length, 1);
  assert.equal(plan.unboundDiagnostics[0].file, undefined);
  assert.equal(plan.unboundDiagnostics[0].line, undefined);
});

test("ambiguous basename is not guessed", () => {
  const diagnostics: ProjectDiagnostic[] = [
    {
      family: "vbcc",
      stage: "compile",
      severity: "error",
      file: "types.h",
      line: 4,
      code: "248",
      message: "file 'types.h' not found",
      raw: "error 248 in line 4 of \"types.h\": file 'types.h' not found"
    }
  ];
  const plan = buildProjectProblemPublishPlan(diagnostics, incomingDir, {
    stagedBasenameSourceMap: {}
  });
  assert.equal(plan.mappedCount, 0);
  assert.equal(plan.unboundDiagnostics.length, 1);
  assert.equal(plan.unmappedCount, 1);
});

test("GNU as nested staged source maps back to workspace source path", () => {
  const hostAsm = path.join("/workspace/project/src", "helper.s");
  const diagnostics: ProjectDiagnostic[] = [
    {
      family: "gnu_as",
      stage: "assemble",
      severity: "error",
      file: "src/helper.s",
      line: 5,
      message: "unrecognized opcode",
      raw: "src/helper.s:5: Error: unrecognized opcode"
    }
  ];
  const plan = buildProjectProblemPublishPlan(diagnostics, incomingDir, {
    stagedRelativeSourceMap: {
      "src/helper.s": hostAsm
    }
  });
  assert.equal(plan.mappedCount, 1);
  const only = (plan.entriesByFile[hostAsm] ?? [])[0];
  assert.equal(only.source, "OS4 Test Bridge GNU as");
  assert.match(only.message, /^\[assemble\]\s/);
});

test("VASM diagnostics preserve code and source label in problem entries", () => {
  const hostAsm = path.join("/workspace/project/asm", "foo.s");
  const diagnostics: ProjectDiagnostic[] = [
    {
      family: "vasm",
      stage: "assemble",
      severity: "error",
      file: "asm/foo.s",
      line: 9,
      code: "8",
      message: "unknown mnemonic",
      raw: "error 8 in line 9 of \"asm/foo.s\": unknown mnemonic"
    }
  ];
  const plan = buildProjectProblemPublishPlan(diagnostics, incomingDir, {
    stagedRelativeSourceMap: {
      "asm/foo.s": hostAsm
    }
  });
  assert.equal(plan.mappedCount, 1);
  const only = (plan.entriesByFile[hostAsm] ?? [])[0];
  assert.equal(only.source, "OS4 Test Bridge VASM");
  assert.match(only.message, /^\[assemble\]\s\[8\]\s/);
});
