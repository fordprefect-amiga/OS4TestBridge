import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readProbeSource(): Promise<string> {
  const probePath = path.resolve(__dirname, "../../../guest/os4tb_assembler_characterization_probe.c");
  return fs.readFile(probePath, "utf8");
}

test("assembler characterization probe keeps bounded fixed commands", async () => {
  const source = await readProbeSource();
  assert.match(source, /#define OS4TB_MAX_CMD 900/);
  assert.match(source, /is_safe_basename/);
  assert.match(source, /OS4TB_ASM_GNU_OBJECT_EXIT=/);
  assert.match(source, /OS4TB_ASM_VASM_OBJECT_EXIT=/);
  assert.match(source, /gnu_include\.o gnu_include\.s/);
  assert.match(source, /vasm_main\.o vasm_main\.s/);
  assert.equal(source.includes("gcc -print-search-dirs"), false);
  assert.equal(source.includes("pkill "), false);
  assert.equal(source.includes("killall "), false);
});
