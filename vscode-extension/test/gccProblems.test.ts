import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { GCCDiagnostic } from "../src/gccDiagnostics";
import { parseGccDiagnostics } from "../src/gccDiagnostics";
import {
  buildProblemPublishPlan,
  clearProblemsCollection,
  mapBridgeDiagnosticPathToHost,
  normalizeSamdropIncomingPath,
  parseBridgeConfig,
  replaceProblemsCollection,
  selectProblemSummaryLabel,
  resolveIncomingDirectoryFromConfig
} from "../src/gccProblems";

class FakeCollection<T> {
  public readonly map = new Map<string, T[]>();

  clear(): void {
    this.map.clear();
  }

  set(entries: Array<[string, T[]]>): void {
    this.map.clear();
    for (const [key, value] of entries) {
      this.map.set(key, value);
    }
  }
}

const incomingDir = path.join("/tmp", "os4tb-share", "incoming");

function buildPlan(diagnostics: GCCDiagnostic[]) {
  return buildProblemPublishPlan(diagnostics, incomingDir);
}

test("error severity maps to problem error", () => {
  const plan = buildPlan([
    { file: "SAMDROP:incoming/error_missing_semicolon.c", line: 4, column: 5, severity: "error", message: "x" }
  ]);
  const only = Object.values(plan.entriesByFile)[0][0];
  assert.equal(only.severity, "error");
});

test("warning severity maps to problem warning", () => {
  const plan = buildPlan([
    { file: "SAMDROP:incoming/warning_unused_variable.c", line: 3, column: 9, severity: "warning", message: "x" }
  ]);
  const only = Object.values(plan.entriesByFile)[0][0];
  assert.equal(only.severity, "warning");
});

test("note severity maps to information", () => {
  const plan = buildPlan([
    { file: "SAMDROP:incoming/warning_unused_variable.c", line: 5, column: 1, severity: "note", message: "x" }
  ]);
  const only = Object.values(plan.entriesByFile)[0][0];
  assert.equal(only.severity, "information");
});

test("1-based line and column convert to 0-based indices", () => {
  const plan = buildPlan([
    { file: "SAMDROP:incoming/error_missing_semicolon.c", line: 4, column: 5, severity: "error", message: "x" }
  ]);
  const only = Object.values(plan.entriesByFile)[0][0];
  assert.equal(only.lineZero, 3);
  assert.equal(only.startColumnZero, 4);
  assert.equal(only.endColumnZero, 5);
});

test("missing column uses minimal bounded range on line", () => {
  const plan = buildPlan([
    { file: "SAMDROP:incoming/error_missing_semicolon.c", line: 4, severity: "error", message: "x" }
  ]);
  const only = Object.values(plan.entriesByFile)[0][0];
  assert.equal(only.startColumnZero, 0);
  assert.equal(only.endColumnZero, 1);
});

test("SAMDROP incoming path maps under configured incoming directory", () => {
  const mapped = mapBridgeDiagnosticPathToHost("SAMDROP:incoming/error_missing_semicolon.c", incomingDir);
  assert.equal(mapped, path.resolve(incomingDir, "error_missing_semicolon.c"));
});

test("nested safe relative path maps under incoming directory", () => {
  const mapped = mapBridgeDiagnosticPathToHost("SAMDROP:incoming/sub/dir/test.c", incomingDir);
  assert.equal(mapped, path.resolve(incomingDir, "sub", "dir", "test.c"));
});

test("path traversal attempt is rejected", () => {
  const mapped = mapBridgeDiagnosticPathToHost("SAMDROP:incoming/../../etc/passwd", incomingDir);
  assert.equal(mapped, undefined);
});

test("unsupported AmigaDOS volume path is rejected", () => {
  const mapped = mapBridgeDiagnosticPathToHost("Work:SDK/foo.c", incomingDir);
  assert.equal(mapped, undefined);
});

test("arbitrary absolute host path is rejected", () => {
  const mapped = mapBridgeDiagnosticPathToHost("/etc/passwd", incomingDir);
  assert.equal(mapped, undefined);
});

test("bridge config incoming_dir overrides share_root", () => {
  const parsed = parseBridgeConfig("share_root=/x/share\nincoming_dir=/y/incoming\n");
  assert.equal(resolveIncomingDirectoryFromConfig(parsed), path.join("/y/incoming"));
});

test("bridge config share_root fallback resolves incoming directory", () => {
  const parsed = parseBridgeConfig("share_root=/x/share\n");
  assert.equal(resolveIncomingDirectoryFromConfig(parsed), path.join("/x/share", "incoming"));
});

test("stale diagnostics are cleared at run start", () => {
  const collection = new FakeCollection<number>();
  collection.map.set("old", [1, 2]);
  clearProblemsCollection(collection);
  assert.equal(collection.map.size, 0);
});

test("successful publish sets exact mapped diagnostic count", () => {
  const collection = new FakeCollection<number>();
  replaceProblemsCollection(collection, {
    a: [1],
    b: [2, 3]
  });
  assert.equal(collection.map.size, 2);
  assert.equal((collection.map.get("a") ?? []).length, 1);
  assert.equal((collection.map.get("b") ?? []).length, 2);
});

test("failed run after clear does not retain stale diagnostics", () => {
  const collection = new FakeCollection<number>();
  collection.map.set("stale", [1]);
  clearProblemsCollection(collection);
  assert.equal(collection.map.size, 0);
});

test("repeated publish replaces instead of duplicates", () => {
  const collection = new FakeCollection<number>();
  replaceProblemsCollection(collection, { a: [1] });
  replaceProblemsCollection(collection, { b: [2] });
  assert.equal(collection.map.size, 1);
  assert.equal(collection.map.has("a"), false);
  assert.equal(collection.map.has("b"), true);
});

test("staged source remaps back to original host source", () => {
  const original = path.join("/workspace", "main.c");
  const plan = buildProblemPublishPlan(
    [{ file: "SAMDROP:incoming/compile_req_source.c", line: 4, column: 5, severity: "error", message: "x" }],
    incomingDir,
    {
      sourceRemap: {
        "SAMDROP:incoming/compile_req_source.c": original
      }
    }
  );
  const only = Object.values(plan.entriesByFile)[0][0];
  assert.equal(only.filePath, original);
});

test("unrelated SAMDROP path is not remapped to original", () => {
  const original = path.join("/workspace", "main.c");
  const plan = buildProblemPublishPlan(
    [{ file: "SAMDROP:incoming/other_source.c", line: 4, column: 5, severity: "error", message: "x" }],
    incomingDir,
    {
      sourceRemap: {
        "SAMDROP:incoming/compile_req_source.c": original
      }
    }
  );
  assert.equal(plan.mappedCount, 0);
  assert.equal(plan.unmappedCount, 1);
});

test("request-scoped remap is replaced on repeated runs", () => {
  const firstSource = path.join("/workspace", "first.c");
  const secondSource = path.join("/workspace", "second.c");
  const first = buildProblemPublishPlan(
    [{ file: "SAMDROP:incoming/compile_req_source.c", line: 1, severity: "warning", message: "x" }],
    incomingDir,
    {
      sourceRemap: {
        "SAMDROP:incoming/compile_req_source.c": firstSource
      }
    }
  );
  const second = buildProblemPublishPlan(
    [{ file: "SAMDROP:incoming/compile_req2_source.c", line: 1, severity: "warning", message: "x" }],
    incomingDir,
    {
      sourceRemap: {
        "SAMDROP:incoming/compile_req2_source.c": secondSource
      }
    }
  );
  const firstOnly = Object.values(first.entriesByFile)[0][0];
  const secondOnly = Object.values(second.entriesByFile)[0][0];
  assert.equal(firstOnly.filePath, firstSource);
  assert.equal(secondOnly.filePath, secondSource);
});

test("request-scoped header diagnostic remaps to original host header", () => {
  const hostHeader = path.join("/workspace", "project.h");
  const plan = buildProblemPublishPlan(
    [{ file: "SAMDROP:incoming/project_req_1/project.h", line: 2, column: 1, severity: "error", message: "x" }],
    incomingDir,
    {
      sourceRemap: {
        "SAMDROP:incoming/project_req_1/project.h": hostHeader
      }
    }
  );
  const only = Object.values(plan.entriesByFile)[0][0];
  assert.equal(only.filePath, hostHeader);
});

test("normalizes and validates SAMDROP incoming paths", () => {
  assert.equal(
    normalizeSamdropIncomingPath("SAMDROP:incoming/project_req_1/project.h"),
    "SAMDROP:incoming/project_req_1/project.h"
  );
  assert.equal(normalizeSamdropIncomingPath("SAMDROP:incoming//project.h"), undefined);
  assert.equal(normalizeSamdropIncomingPath("SAMDROP:incoming/../project.h"), undefined);
});

test("real-Sam mixed source+header diagnostics map to both host files", () => {
  const diagnosticsText = [
    "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/source0.c:4:1: error: expected '=', ',', ';', 'asm' or '__attribute__' before '{' token",
    "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/project.h:4:5: error: old-style parameter declarations in prototyped function definition",
    "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/source0.c:7: error: expected '{' at end of input",
    "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/project.h:4:20: warning: unused parameter 'a' [-Wunused-parameter]",
    "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/project.h:4:27: warning: unused parameter 'b' [-Wunused-parameter]"
  ].join("\n");
  const diagnostics = parseGccDiagnostics(diagnosticsText);
  const hostMain = path.join("/workspace/header_error", "main.c");
  const hostHeader = path.join("/workspace/header_error", "project.h");
  const plan = buildProblemPublishPlan(diagnostics, incomingDir, {
    sourceRemap: {
      "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/source0.c": hostMain,
      "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/project.h": hostHeader
    }
  });
  const mappedFiles = Object.keys(plan.entriesByFile).sort();
  assert.deepEqual(mappedFiles, [hostHeader, hostMain].sort());
  const headerEntries = plan.entriesByFile[hostHeader] ?? [];
  assert.ok(
    headerEntries.some(
      (e) =>
        e.severity === "error" &&
        e.lineZero === 3 &&
        e.startColumnZero === 4 &&
        e.message === "old-style parameter declarations in prototyped function definition"
    )
  );
  assert.ok(headerEntries.some((e) => e.severity === "warning" && e.lineZero === 3 && e.startColumnZero === 19));
  assert.ok(headerEntries.some((e) => e.severity === "warning" && e.lineZero === 3 && e.startColumnZero === 26));
});

test("unknown project diagnostic path remains unmapped", () => {
  const plan = buildProblemPublishPlan(
    [{ file: "SAMDROP:incoming/project_req_1/unknown.h", line: 1, column: 1, severity: "error", message: "x" }],
    incomingDir,
    {
      sourceRemap: {
        "SAMDROP:incoming/project_req_1/source0.c": path.join("/workspace", "main.c")
      }
    }
  );
  assert.equal(plan.mappedCount, 0);
  assert.equal(plan.unmappedCount, 1);
});

test("header-only diagnostics map to host header", () => {
  const hostHeader = path.join("/workspace/header_only", "project.h");
  const plan = buildProblemPublishPlan(
    [{ file: "SAMDROP:incoming/project_req_2/project.h", line: 4, column: 5, severity: "error", message: "x" }],
    incomingDir,
    {
      sourceRemap: {
        "SAMDROP:incoming/project_req_2/project.h": hostHeader
      }
    }
  );
  const headerEntries = plan.entriesByFile[hostHeader] ?? [];
  assert.equal(headerEntries.length, 1);
  assert.equal(headerEntries[0].lineZero, 3);
  assert.equal(headerEntries[0].startColumnZero, 4);
});

test("problem summary label is project for multi-file errors", () => {
  const hostMain = path.join("/workspace/header_error", "main.c");
  const hostHeader = path.join("/workspace/header_error", "project.h");
  const plan = buildProblemPublishPlan(
    [
      { file: "SAMDROP:incoming/project_req_3/source0.c", line: 7, column: 1, severity: "error", message: "x" },
      { file: "SAMDROP:incoming/project_req_3/project.h", line: 4, column: 5, severity: "error", message: "y" }
    ],
    incomingDir,
    {
      sourceRemap: {
        "SAMDROP:incoming/project_req_3/source0.c": hostMain,
        "SAMDROP:incoming/project_req_3/project.h": hostHeader
      }
    }
  );
  assert.equal(selectProblemSummaryLabel(plan, "project"), "project");
});

test("problem summary label is basename for single-file errors", () => {
  const hostMain = path.join("/workspace/onefile", "main.c");
  const plan = buildProblemPublishPlan(
    [{ file: "SAMDROP:incoming/project_req_4/source0.c", line: 7, column: 1, severity: "error", message: "x" }],
    incomingDir,
    {
      sourceRemap: {
        "SAMDROP:incoming/project_req_4/source0.c": hostMain
      }
    }
  );
  assert.equal(selectProblemSummaryLabel(plan, "project"), "main.c");
});

test("nested same-basename headers map by full staged path", () => {
  const hostFoo = path.join("/workspace/tree/include/foo", "types.h");
  const hostBar = path.join("/workspace/tree/include/bar", "types.h");
  const plan = buildProblemPublishPlan(
    [
      { file: "SAMDROP:incoming/project_req_5/include/foo/types.h", line: 3, column: 2, severity: "error", message: "foo" },
      { file: "SAMDROP:incoming/project_req_5/include/bar/types.h", line: 4, column: 6, severity: "warning", message: "bar" }
    ],
    incomingDir,
    {
      sourceRemap: {
        "SAMDROP:incoming/project_req_5/include/foo/types.h": hostFoo,
        "SAMDROP:incoming/project_req_5/include/bar/types.h": hostBar
      }
    }
  );
  assert.equal((plan.entriesByFile[hostFoo] ?? [])[0]?.message, "foo");
  assert.equal((plan.entriesByFile[hostBar] ?? [])[0]?.message, "bar");
});
