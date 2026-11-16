import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGuestAssemblerManifestText,
  isValidAssemblerRelativePath,
  isValidProjectAssemblerId,
  resolveProjectAssembler,
  validateAssemblerDefines
} from "../src/assemblerProjectBuildRun";
import { parseToolchainDiscoveryArtifact } from "../src/toolchainDiscovery";

function buildSnapshot() {
  return parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_COUNT: "0",
    OS4TB_VBCC_STATUS: "present",
    OS4TB_VBCC_VERSION: "unknown",
    OS4TB_VBCC_DRIVER_COMMAND: "vc",
    OS4TB_VBCC_DRIVER_PATH: "Work:SDK/vbcc/bin/vc",
    OS4TB_VBCC_LINKER_STATUS: "present",
    OS4TB_VBCC_LINKER_PATH: "Work:SDK/vbcc/bin/vlink",
    OS4TB_VBCC_ASSEMBLER_STATUS: "present",
    OS4TB_VBCC_ASSEMBLER_PATH: "Work:SDK/vbcc/bin/vasmppc_std",
    OS4TB_AS_STATUS: "present",
    OS4TB_AS_PATH: "Work:SDK/gcc/ppc-amigaos/bin/as",
    OS4TB_AS_VERSION: "GNU assembler (GNU Binutils) 2.23.2",
    OS4TB_LD_STATUS: "present",
    OS4TB_LD_PATH: "Work:SDK/gcc/ppc-amigaos/bin/ld",
    OS4TB_LD_VERSION: "GNU ld (GNU Binutils) 2.23.2"
  });
}

test("validates assembler identities", () => {
  assert.equal(isValidProjectAssemblerId("gnu-as-os4"), true);
  assert.equal(isValidProjectAssemblerId("vasm-ppc-std"), true);
  assert.equal(isValidProjectAssemblerId("vasm"), false);
});

test("resolves discovery-driven gnu assembler profile", () => {
  const resolved = resolveProjectAssembler({ snapshot: buildSnapshot(), assemblerId: "gnu-as-os4" });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.assembler.family, "gnu_as");
    assert.equal(resolved.assembler.assemblerPath, "Work:SDK/gcc/ppc-amigaos/bin/as");
    assert.equal(resolved.assembler.linkerPath, "Work:SDK/vbcc/bin/vlink");
    assert.equal(resolved.assembler.defineModel, "--defsym");
  }
});

test("resolves discovery-driven vasm profile", () => {
  const resolved = resolveProjectAssembler({ snapshot: buildSnapshot(), assemblerId: "vasm-ppc-std" });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.assembler.family, "vasm");
    assert.equal(resolved.assembler.assemblerPath, "Work:SDK/vbcc/bin/vasmppc_std");
    assert.equal(resolved.assembler.defineModel, "-D");
  }
});

test("does not cross-family fallback when requested assembler is unavailable", () => {
  const snapshot = parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_COUNT: "0",
    OS4TB_VBCC_STATUS: "present",
    OS4TB_VBCC_LINKER_STATUS: "present",
    OS4TB_VBCC_LINKER_PATH: "Work:SDK/vbcc/bin/vlink",
    OS4TB_VBCC_ASSEMBLER_STATUS: "missing",
    OS4TB_VBCC_ASSEMBLER_PATH: "unknown",
    OS4TB_AS_STATUS: "present",
    OS4TB_AS_PATH: "Work:SDK/gcc/ppc-amigaos/bin/as"
  });
  const resolved = resolveProjectAssembler({ snapshot, assemblerId: "vasm-ppc-std" });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) {
    assert.equal(resolved.reason, "assembler_not_discovered");
  }
});

test("builds bounded assembler guest manifest text", () => {
  const resolved = resolveProjectAssembler({ snapshot: buildSnapshot(), assemblerId: "gnu-as-os4" });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) {
    return;
  }
  const text = buildGuestAssemblerManifestText({
    assembler: resolved.assembler,
    sources: ["src/main.s"],
    includes: ["include"],
    defines: ["VALUE=7"]
  });
  assert.match(text, /^ASSEMBLER_ID=gnu-as-os4$/m);
  assert.match(text, /^ASSEMBLER_FAMILY=gnu_as$/m);
  assert.doesNotMatch(text, /^ASSEMBLER_VERSION=/m);
  assert.match(text, /^LINKER_MODEL=vlink$/m);
  assert.match(text, /^SOURCE_COUNT=1$/m);
  assert.match(text, /^DEFINE_0=VALUE=7$/m);
});

test("validates bounded relative assembler paths", () => {
  assert.equal(isValidAssemblerRelativePath("src/main.s", ".s"), true);
  assert.equal(isValidAssemblerRelativePath("../main.s", ".s"), false);
  assert.equal(isValidAssemblerRelativePath("src/main.c", ".s"), false);
});

test("validates bounded define tokens", () => {
  assert.equal(validateAssemblerDefines(["VALUE=7", "FLAG"]), true);
  assert.equal(validateAssemblerDefines(["../BAD=1"]), false);
});
