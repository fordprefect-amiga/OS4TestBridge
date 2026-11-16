import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readExtensionSource(): Promise<string> {
  return fs.readFile(path.resolve(__dirname, "..", "..", "src", "extension.ts"), "utf8");
}

test("project diagnostics parser dispatch is typed by resolved family", async () => {
  const source = await readExtensionSource();
  assert.match(source, /artifactFields\.OS4TB_GCC_PROJECT_TOOLCHAIN_FAMILY === "vbcc"/);
  assert.match(source, /parseProjectDiagnosticsByFamily\(\{\s*family: "vbcc"/);
  assert.match(source, /parseProjectDiagnosticsByFamily\(\{\s*family: "gcc"/);
  assert.match(source, /const sourceType = artifactFields\[`OS4TB_GCC_PROJECT_SOURCE_\$\{i\}_TYPE`\] === "asm" \? "asm" : "c"/);
  assert.match(source, /sourceType === "asm" && assemblerFamily \? assemblerFamily : selectedFamily/);
  assert.match(source, /parseProjectDiagnosticsByFamily\(\{\s*family: "gnu_as"/);
  assert.match(source, /parseProjectDiagnosticsByFamily\(\{\s*family: "vasm"/);
});
