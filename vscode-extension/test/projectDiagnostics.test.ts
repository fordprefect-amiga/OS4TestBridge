import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  deduplicateProjectDiagnostics,
  parseGnuAssemblerProjectDiagnostics,
  parseProjectLinkDiagnostics,
  parseProjectDiagnosticsByFamily,
  parseVasmProjectDiagnostics,
  parseVbccDiagnosticsForStage
} from "../src/projectDiagnostics";

async function readFixture(name: string): Promise<string> {
  return fs.readFile(path.join(__dirname, "..", "..", "test", "fixtures", name), "utf8");
}

test("typed parser dispatch uses GCC parser for gcc family", () => {
  const diagnostics = parseProjectDiagnosticsByFamily({
    family: "gcc",
    gccText: "source.c:12:7: error: expected ';' before '}'\n"
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].family, "gcc");
  assert.equal(diagnostics[0].stage, "compile");
  assert.equal(diagnostics[0].line, 12);
  assert.equal(diagnostics[0].column, 7);
});

test("typed parser dispatch uses VBCC parser for vbcc family", async () => {
  const compileText = await readFixture("vbcc-syntax-error.txt");
  const linkText = await readFixture("vbcc-link-error.txt");
  const diagnostics = parseProjectDiagnosticsByFamily({
    family: "vbcc",
    vbccCompileTexts: [compileText],
    vbccLinkText: linkText
  });
  assert.ok(diagnostics.some((entry) => entry.stage === "compile" && entry.code === "82"));
  assert.ok(diagnostics.some((entry) => entry.stage === "link" && entry.code === "21"));
});

test("VBCC compile parser extracts file line code and message", async () => {
  const compileText = await readFixture("vbcc-semantic-error.txt");
  const diagnostics = parseVbccDiagnosticsForStage(compileText, "compile");
  assert.deepEqual(diagnostics, [
    {
      family: "vbcc",
      stage: "compile",
      severity: "error",
      file: "src/helper.c",
      line: 7,
      code: "82",
      message: "unknown identifier <missing_identifier>",
      raw: "error 82 in line 7 of \"src/helper.c\": unknown identifier <missing_identifier>"
    }
  ]);
});

test("VBCC link parser preserves code and does not invent source location", async () => {
  const linkText = await readFixture("vbcc-link-error.txt");
  const diagnostics = parseVbccDiagnosticsForStage(linkText, "link");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].stage, "link");
  assert.equal(diagnostics[0].code, "21");
  assert.equal(diagnostics[0].file, undefined);
  assert.equal(diagnostics[0].line, undefined);
  assert.match(diagnostics[0].message, /undefined symbol sin/i);
});

test("project diagnostic deduplication is deterministic", async () => {
  const compileText = await readFixture("vbcc-semantic-error.txt");
  const diagnostics = parseProjectDiagnosticsByFamily({
    family: "vbcc",
    vbccCompileTexts: [compileText, compileText]
  });
  assert.equal(diagnostics.length, 1);
  const deduped = deduplicateProjectDiagnostics([...diagnostics, diagnostics[0]]);
  assert.equal(deduped.length, 1);
});

test("VBCC parser safely ignores unrecognized or malformed output", () => {
  const diagnostics = parseVbccDiagnosticsForStage(
    [
      "random banner line",
      "error xx in line ? of \"broken.c\": malformed",
      "Error without code",
      "warning 54 in line 0 of \"broken.c\": invalid line number"
    ].join("\n"),
    "compile"
  );
  assert.equal(diagnostics.length, 0);
});

test("GNU as parser extracts source, line, severity and message without fabricating column", () => {
  const diagnostics = parseGnuAssemblerProjectDiagnostics("src/helper.s:5: Error: unrecognized opcode: `this_is_invalid'\n");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].family, "gnu_as");
  assert.equal(diagnostics[0].stage, "assemble");
  assert.equal(diagnostics[0].severity, "error");
  assert.equal(diagnostics[0].file, "src/helper.s");
  assert.equal(diagnostics[0].line, 5);
  assert.equal(diagnostics[0].column, undefined);
});

test("VASM parser extracts numeric code and source line without fabricating column", () => {
  const diagnostics = parseVasmProjectDiagnostics(
    "error 8 in line 5 of \"src/helper.s\": unknown mnemonic <THIS_IS_INVALID>"
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].family, "vasm");
  assert.equal(diagnostics[0].stage, "assemble");
  assert.equal(diagnostics[0].severity, "error");
  assert.equal(diagnostics[0].file, "src/helper.s");
  assert.equal(diagnostics[0].line, 5);
  assert.equal(diagnostics[0].code, "8");
  assert.equal(diagnostics[0].column, undefined);
});

test("typed parser dispatch supports gnu_as and vasm families", () => {
  const gnu = parseProjectDiagnosticsByFamily({
    family: "gnu_as",
    assemblerTexts: ["helper.s:4: Error: bad opcode"]
  });
  const vasm = parseProjectDiagnosticsByFamily({
    family: "vasm",
    assemblerTexts: ["error 8 in line 4 of \"helper.s\": bad opcode"]
  });
  assert.equal(gnu.length, 1);
  assert.equal(gnu[0].family, "gnu_as");
  assert.equal(gnu[0].stage, "assemble");
  assert.equal(vasm.length, 1);
  assert.equal(vasm[0].family, "vasm");
  assert.equal(vasm[0].stage, "assemble");
});

test("typed parser dispatch does not cross-contaminate GNU as and VASM grammars", () => {
  const gnu = parseProjectDiagnosticsByFamily({
    family: "gnu_as",
    assemblerTexts: ["error 8 in line 4 of \"helper.s\": bad opcode"]
  });
  const vasm = parseProjectDiagnosticsByFamily({
    family: "vasm",
    assemblerTexts: ["helper.s:4: Error: bad opcode"]
  });
  assert.equal(gnu.length, 0);
  assert.equal(vasm.length, 0);
});

test("link diagnostics are classified as stage=link without file fabrication", () => {
  const diagnostics = parseProjectLinkDiagnostics(
    "Error 21: build_source0.o (.text+0x14): Reference to undefined symbol missing.",
    "gcc"
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].stage, "link");
  assert.equal(diagnostics[0].file, undefined);
  assert.equal(diagnostics[0].line, undefined);
  assert.equal(diagnostics[0].family, "gcc");
});

test("assembler parser safely ignores unrecognized output", () => {
  const diagnostics = parseProjectDiagnosticsByFamily({
    family: "gnu_as",
    assemblerTexts: ["random banner", "completely unrelated output"]
  });
  assert.equal(diagnostics.length, 0);
});
