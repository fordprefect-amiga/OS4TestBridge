import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readExtensionSource(): Promise<string> {
  return fs.readFile(path.resolve(__dirname, "..", "..", "src", "extension.ts"), "utf8");
}

test("build-only project reporting prefers validated not_run execution evidence", async () => {
  const source = await readExtensionSource();
  assert.match(source, /resolveReportedProgramExit\(buildSummary/);
  assert.match(source, /requestedExecutionMode: params\.executionPolicy/);
  assert.match(source, /OS4TB_PROGRAM_EXIT=\$\{reportedProgramExit\}/);
});
