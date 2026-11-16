import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readSource(relativePath: string): Promise<string> {
  return fs.readFile(path.resolve(__dirname, "..", relativePath), "utf8");
}

test("project manifest persistence stores only toolchain intent", async () => {
  const source = await readSource("src/gccProjectBuildRun.js");
  assert.doesNotMatch(source, /toolchain=.*TOOLCHAIN_DRIVER/i);
  assert.doesNotMatch(source, /toolchain=.*TOOLCHAIN_CC1_PREFIX/i);
  assert.doesNotMatch(source, /toolchain=.*TOOLCHAIN_GCC_BIN_PREFIX/i);
  assert.doesNotMatch(source, /toolchain=.*TOOLCHAIN_INTERNAL_INCLUDE_DIR/i);
  assert.doesNotMatch(source, /toolchain=.*TOOLCHAIN_RUNTIME_LIBGCC/i);
  assert.doesNotMatch(source, /toolchain=.*TOOLCHAIN_RUNTIME_LIBGCC_EH/i);
  assert.doesNotMatch(source, /toolchain=.*TOOLCHAIN_AS_PATH/i);
  assert.doesNotMatch(source, /toolchain=.*TOOLCHAIN_LD_PATH/i);
  assert.doesNotMatch(source, /toolchain=.*TOOLCHAIN_CRTBEGIN/i);
  assert.doesNotMatch(source, /toolchain=.*TOOLCHAIN_CRTEND/i);
  assert.doesNotMatch(source, /toolchain=.*TOOLCHAIN_LIBRARY_DIR/i);
});

test("persistence logic has no hardcoded supported GCC version inventory", async () => {
  const source = await readSource("src/gccProjectBuildRun.js");
  assert.doesNotMatch(source, /gcc-11\.5\.0/);
  assert.doesNotMatch(source, /gcc-8\.4\.0/);
  assert.doesNotMatch(source, /gcc-6\.4\.0/);
});
