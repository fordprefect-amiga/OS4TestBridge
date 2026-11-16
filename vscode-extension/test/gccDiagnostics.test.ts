import test from "node:test";
import assert from "node:assert/strict";
import { extractGccVersion, parseGccDiagnostics, summarizeGccDiagnostics } from "../src/gccDiagnostics";

test("parses GCC error with line and column", () => {
  const diagnostics = parseGccDiagnostics("source.c:12:7: error: expected ';' before '}'\n");
  assert.deepEqual(diagnostics, [
    { file: "source.c", line: 12, column: 7, severity: "error", message: "expected ';' before '}'" }
  ]);
});

test("parses GCC warning with line and column", () => {
  const diagnostics = parseGccDiagnostics("source.c:8:3: warning: unused variable 'x'\n");
  assert.deepEqual(diagnostics, [
    { file: "source.c", line: 8, column: 3, severity: "warning", message: "unused variable 'x'" }
  ]);
});

test("parses GCC note", () => {
  const diagnostics = parseGccDiagnostics("source.c:14:9: note: previous declaration was here\n");
  assert.deepEqual(diagnostics, [
    { file: "source.c", line: 14, column: 9, severity: "note", message: "previous declaration was here" }
  ]);
});

test("parses diagnostic without column", () => {
  const diagnostics = parseGccDiagnostics("source.c:14: error: expected expression before ')' token\n");
  assert.deepEqual(diagnostics, [
    {
      file: "source.c",
      line: 14,
      severity: "error",
      message: "expected expression before ')' token"
    }
  ]);
});

test("preserves additional colons in message text", () => {
  const diagnostics = parseGccDiagnostics("source.c:20:1: warning: label: value pair is deprecated\n");
  assert.deepEqual(diagnostics, [
    { file: "source.c", line: 20, column: 1, severity: "warning", message: "label: value pair is deprecated" }
  ]);
});

test("ignores unrelated informational text", () => {
  const diagnostics = parseGccDiagnostics("gcc version 11.5.0\ncompilation terminated.\n");
  assert.equal(diagnostics.length, 0);
});

test("ignores malformed line", () => {
  const diagnostics = parseGccDiagnostics("source.c:: error this is malformed\n");
  assert.equal(diagnostics.length, 0);
});

test("ignores invalid line number", () => {
  const diagnostics = parseGccDiagnostics("source.c:0:5: error: bad line\n");
  assert.equal(diagnostics.length, 0);
});

test("ignores invalid column number", () => {
  const diagnostics = parseGccDiagnostics("source.c:5:0: warning: bad column\n");
  assert.equal(diagnostics.length, 0);
});

test("parses multiple diagnostics in one log", () => {
  const diagnostics = parseGccDiagnostics(
    "a.c:1:1: error: first\nb.c:2:2: warning: second\nb.c:3: note: third\n"
  );
  assert.equal(diagnostics.length, 3);
});

test("summarizes mixed warning/error/note counts", () => {
  const diagnostics = parseGccDiagnostics(
    "a.c:1:1: error: first\nb.c:2:2: warning: second\nb.c:3: note: third\n"
  );
  assert.deepEqual(summarizeGccDiagnostics(diagnostics), {
    total: 3,
    errorCount: 1,
    warningCount: 1,
    noteCount: 1
  });
});

test("empty input returns empty diagnostics", () => {
  const diagnostics = parseGccDiagnostics("");
  assert.equal(diagnostics.length, 0);
});

test("CRLF input is handled", () => {
  const diagnostics = parseGccDiagnostics("source.c:10:4: warning: crlf line\r\nsource.c:11: note: follow up\r\n");
  assert.equal(diagnostics.length, 2);
});

test("duplicate lines remain deterministic", () => {
  const diagnostics = parseGccDiagnostics(
    "source.c:12:7: error: expected ';' before '}'\nsource.c:12:7: error: expected ';' before '}'\n"
  );
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0], diagnostics[1]);
});

test("extracts explicit GCC version token", () => {
  const version = extractGccVersion("prefix\nOS4TB_GCC_VERSION=11.5.0\nsuffix\n");
  assert.equal(version, "11.5.0");
});

test("parses real-Sam mixed source and header diagnostics", () => {
  const text = [
    "=== PROJECT_COMPILE_0 ===",
    "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/source0.c: In function 'add_values':",
    "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/source0.c:4:1: error: expected '=', ',', ';', 'asm' or '__attribute__' before '{' token",
    "In file included from SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/source0.c:1:",
    "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/project.h:4:5: error: old-style parameter declarations in prototyped function definition",
    "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/source0.c:7: error: expected '{' at end of input",
    "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/project.h:4:20: warning: unused parameter 'a' [-Wunused-parameter]",
    "SAMDROP:incoming/project_gccproj_20261107T214700002Z_0002/project.h:4:27: warning: unused parameter 'b' [-Wunused-parameter]"
  ].join("\n");
  const diagnostics = parseGccDiagnostics(text);
  const headerError = diagnostics.find(
    (d) => d.file.endsWith("/project.h") && d.line === 4 && d.column === 5 && d.severity === "error"
  );
  const headerWarnA = diagnostics.find(
    (d) => d.file.endsWith("/project.h") && d.line === 4 && d.column === 20 && d.severity === "warning"
  );
  const headerWarnB = diagnostics.find(
    (d) => d.file.endsWith("/project.h") && d.line === 4 && d.column === 27 && d.severity === "warning"
  );
  assert.ok(headerError);
  assert.equal(headerError?.message, "old-style parameter declarations in prototyped function definition");
  assert.ok(headerWarnA);
  assert.ok(headerWarnB);
});
