import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readText(relativePath: string): Promise<string> {
  return fs.readFile(path.resolve(__dirname, "..", relativePath), "utf8");
}

test("inspect toolchains payload has canonical package default for clean installs", async () => {
  const packageText = await readText("../package.json");
  assert.match(
    packageText,
    /"os4TestBridge\.inspectToolchainsPayloadName":\s*\{[\s\S]*?"default": "os4tb_toolchain_discovery_probe"/
  );
});

test("inspect toolchains resolves canonical default payload when override is empty", async () => {
  const extensionSource = await readText("../src/extension.ts");
  assert.match(extensionSource, /const DEFAULT_INSPECT_TOOLCHAINS_PAYLOAD_NAME = "os4tb_toolchain_discovery_probe";/);
  assert.match(
    extensionSource,
    /const inspectToolchainsPayloadName = resolvePayloadSetting\(\s*config,\s*"inspectToolchainsPayloadName",\s*DEFAULT_INSPECT_TOOLCHAINS_PAYLOAD_NAME\s*\);/
  );
  assert.doesNotMatch(extensionSource, /Set os4TestBridge\.inspectToolchainsPayloadName before Inspect AmigaOS 4 SDK \/ Toolchains\./);
});

test("canonical defaults exist for v1 project and diagnostics payload workflows", async () => {
  const packageText = await readText("../package.json");
  assert.match(
    packageText,
    /"os4TestBridge\.gccDiagnosticsPayloadName":\s*\{[\s\S]*?"default": "os4tb_gcc_diagnostics_probe"/
  );
  assert.match(
    packageText,
    /"os4TestBridge\.gccProjectBuildRunPayloadName":\s*\{[\s\S]*?"default": "os4tb_gcc_project_build_run_adapter"/
  );
  assert.match(
    packageText,
    /"os4TestBridge\.vbccProjectBuildRunPayloadName":\s*\{[\s\S]*?"default": "os4tb_vbcc_project_build_run_adapter"/
  );
  assert.match(
    packageText,
    /"os4TestBridge\.assemblerProjectBuildRunPayloadName":\s*\{[\s\S]*?"default": "os4tb_assembler_project_build_run_adapter"/
  );
});
