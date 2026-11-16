import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import {
  PROJECT_MANIFEST_FILENAME,
  readProjectAssemblerPreferenceForActiveFile,
  setProjectAssemblerPreferenceForActiveFile
} from "../src/gccProjectBuildRun";
import { parseToolchainDiscoveryArtifact } from "../src/toolchainDiscovery";
import { resolveProjectAssembler } from "../src/assemblerProjectBuildRun";

async function writeSource(projectDir: string, relativePath: string): Promise<void> {
  const filePath = path.join(projectDir, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "int x(void){return 0;}\n", "utf8");
}

async function writeManifest(projectDir: string, lines: string[]): Promise<void> {
  await fs.writeFile(path.join(projectDir, PROJECT_MANIFEST_FILENAME), `${lines.join("\n")}\n`, "utf8");
}

function createSnapshot(fields: Partial<Record<string, string>> = {}) {
  return parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_ACTIVE_FRONTEND: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_ACTIVE_VERSION: "11.5.0",
    OS4TB_GCC_COUNT: "1",
    OS4TB_GCC_0_STATUS: "present",
    OS4TB_GCC_0_VERSION: "11.5.0",
    OS4TB_GCC_0_DRIVER: "Work:SDK/gcc/bin/gcc",
    OS4TB_GCC_0_CC1: "Work:SDK/gcc/bin/libexec/gcc/ppc-amigaos/11.5.0/cc1",
    OS4TB_GCC_0_AS: "Work:SDK/gcc/bin/as",
    OS4TB_GCC_0_LD: "Work:SDK/gcc/bin/ld",
    OS4TB_GCC_0_INCLUDE_COUNT: "0",
    OS4TB_GCC_0_LIBRARY_DIR_COUNT: "1",
    OS4TB_GCC_0_LIBRARY_DIR_0: "/SDK/newlib/lib",
    OS4TB_VBCC_STATUS: "present",
    OS4TB_VBCC_VERSION: "0.9g",
    OS4TB_VBCC_DRIVER_COMMAND: "vc",
    OS4TB_VBCC_DRIVER_PATH: "SDK:vbcc/bin/vc",
    OS4TB_VBCC_LINKER_STATUS: "present",
    OS4TB_VBCC_LINKER_PATH: "SDK:vbcc/bin/vlink",
    OS4TB_VBCC_ASSEMBLER_STATUS: "present",
    OS4TB_VBCC_ASSEMBLER_PATH: "SDK:vbcc/bin/vasmppc_std",
    ...fields
  });
}

test("explicit and automatic assembler selections persist", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-asm-persist-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c"]);
  const activeFilePath = path.join(dir, "main.c");

  const autoBefore = await readProjectAssemblerPreferenceForActiveFile(activeFilePath);
  assert.equal(autoBefore.reason, "ok");
  assert.equal(autoBefore.assemblerId, undefined);

  assert.equal((await setProjectAssemblerPreferenceForActiveFile(activeFilePath, "gnu-as-os4")).reason, "ok");
  const explicitReload = await readProjectAssemblerPreferenceForActiveFile(activeFilePath);
  assert.equal(explicitReload.reason, "ok");
  assert.equal(explicitReload.assemblerId, "gnu-as-os4");

  assert.equal((await setProjectAssemblerPreferenceForActiveFile(activeFilePath)).reason, "ok");
  const autoReload = await readProjectAssemblerPreferenceForActiveFile(activeFilePath);
  assert.equal(autoReload.reason, "ok");
  assert.equal(autoReload.assemblerId, undefined);
});

test("toolchain and assembler keys coexist and update independently", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-asm-coexist-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=gcc-11.5.0"]);
  const activeFilePath = path.join(dir, "main.c");

  assert.equal((await setProjectAssemblerPreferenceForActiveFile(activeFilePath, "vasm-ppc-std")).reason, "ok");
  const manifestText = await fs.readFile(path.join(dir, PROJECT_MANIFEST_FILENAME), "utf8");
  assert.match(manifestText, /^toolchain=gcc-11.5.0$/m);
  assert.match(manifestText, /^assembler=vasm-ppc-std$/m);

  assert.equal((await setProjectAssemblerPreferenceForActiveFile(activeFilePath)).reason, "ok");
  const clearedText = await fs.readFile(path.join(dir, PROJECT_MANIFEST_FILENAME), "utf8");
  assert.match(clearedText, /^toolchain=gcc-11.5.0$/m);
  assert.equal(/(^|\n)assembler=/.test(clearedText), false);
});

test("explicit unavailable assembler remains explicit and never falls back", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-asm-unavailable-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "assembler=vasm-ppc-std"]);
  const activeFilePath = path.join(dir, "main.c");

  const preference = await readProjectAssemblerPreferenceForActiveFile(activeFilePath);
  assert.equal(preference.reason, "ok");
  assert.equal(preference.assemblerId, "vasm-ppc-std");

  const missingSnapshot = createSnapshot({
    OS4TB_VBCC_ASSEMBLER_STATUS: "missing",
    OS4TB_VBCC_ASSEMBLER_PATH: "unknown"
  });
  const missingResolve = resolveProjectAssembler({ snapshot: missingSnapshot, assemblerId: preference.assemblerId });
  assert.equal(missingResolve.ok, false);
  if (!missingResolve.ok) {
    assert.equal(missingResolve.reason, "assembler_not_discovered");
  }

  const persistedAfterFailure = await readProjectAssemblerPreferenceForActiveFile(activeFilePath);
  assert.equal(persistedAfterFailure.reason, "ok");
  assert.equal(persistedAfterFailure.assemblerId, "vasm-ppc-std");
});

test("relocated project copy preserves assembler association", async () => {
  const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-asm-copy-src-"));
  await writeSource(srcDir, "main.c");
  await writeSource(srcDir, "helper.c");
  await writeManifest(srcDir, ["source=main.c", "source=helper.c", "assembler=gnu-as-os4"]);

  const dstDir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-asm-copy-dst-"));
  await fs.cp(srcDir, dstDir, { recursive: true });
  const copiedPreference = await readProjectAssemblerPreferenceForActiveFile(path.join(dstDir, "main.c"));
  assert.equal(copiedPreference.reason, "ok");
  assert.equal(copiedPreference.assemblerId, "gnu-as-os4");
});
