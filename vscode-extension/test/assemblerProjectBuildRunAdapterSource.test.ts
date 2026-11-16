import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readAdapterSource(): Promise<string> {
  const adapterPath = path.resolve(__dirname, "../../../guest/os4tb_assembler_project_build_run_adapter.c");
  return fs.readFile(adapterPath, "utf8");
}

test("assembler adapter emits request-scoped diagnostics sidecars", async () => {
  const source = await readAdapterSource();
  assert.match(source, /OS4TB_ASM_BUILD_DIAGNOSTIC_FILE=%s/);
  assert.match(source, /project-assemble-command-%d\.txt/);
  assert.match(source, /project-assemble-%d\.txt/);
  assert.match(source, /project-link-command\.txt/);
  assert.match(source, /project-link\.txt/);
  assert.match(source, /program\.txt/);
  assert.match(source, /append_text_file/);
  assert.match(source, /=== PROJECT_ASSEMBLE ===/);
  assert.match(source, /=== PROJECT_LINK ===/);
});

test("assembler adapter parses bounded relative source/include paths", async () => {
  const source = await readAdapterSource();
  assert.match(source, /is_safe_relative_path/);
  assert.match(source, /strncmp\(key, "SOURCE_", 7\)/);
  assert.match(source, /strncmp\(key, "INCLUDE_", 8\)/);
});
