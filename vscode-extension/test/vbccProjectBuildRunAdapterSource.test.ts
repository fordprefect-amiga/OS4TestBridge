import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readAdapterSource(): Promise<string> {
  const adapterPath = path.resolve(__dirname, "../../../guest/os4tb_vbcc_project_build_run_adapter.c");
  return fs.readFile(adapterPath, "utf8");
}

test("vbcc adapter emits request-scoped diagnostics sidecars", async () => {
  const source = await readAdapterSource();
  assert.match(source, /OS4TB_GCC_BUILD_DIAGNOSTIC_FILE=%s/);
  assert.match(source, /gcc\.txt/);
  assert.match(source, /project-compile-command-%d\.txt/);
  assert.match(source, /project-compile-%d\.txt/);
  assert.match(source, /project-link-command\.txt/);
  assert.match(source, /project-link\.txt/);
  assert.match(source, /program\.txt/);
  assert.match(source, /append_file_to_diagnostics/);
  assert.match(source, /=== PROJECT_COMPILE_%d ===/);
  assert.match(source, /=== PROJECT_LINK ===/);
});
