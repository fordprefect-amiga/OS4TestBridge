import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import {
  PROJECT_MANIFEST_FILENAME,
  readProjectToolchainPreferenceForActiveFile,
  setProjectToolchainPreferenceForActiveFile
} from "../src/gccProjectBuildRun";
import {
  parseToolchainDiscoveryArtifact,
  resolveProjectGccToolchain,
  resolveProjectToolchain
} from "../src/toolchainDiscovery";

async function writeSource(projectDir: string, relativePath: string): Promise<void> {
  const filePath = path.join(projectDir, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "int x(void){return 0;}\n", "utf8");
}

async function writeManifest(projectDir: string, lines: string[]): Promise<void> {
  await fs.writeFile(path.join(projectDir, PROJECT_MANIFEST_FILENAME), `${lines.join("\n")}\n`, "utf8");
}

function createSnapshot(activeVersion: string, discoveredVersions: string[]) {
  return parseToolchainDiscoveryArtifact(createSnapshotFields(activeVersion, discoveredVersions));
}

function createSnapshotFields(activeVersion: string, discoveredVersions: string[]): Record<string, string> {
  const fields: Record<string, string> = {
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_ACTIVE_FRONTEND: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_ACTIVE_VERSION: activeVersion,
    OS4TB_GCC_COUNT: String(discoveredVersions.length),
    OS4TB_VBCC_STATUS: "present",
    OS4TB_VBCC_VERSION: "0.9g",
    OS4TB_VBCC_DRIVER_COMMAND: "vc",
    OS4TB_VBCC_DRIVER_PATH: "SDK:vbcc/bin/vc",
    OS4TB_VBCC_LINKER_STATUS: "present",
    OS4TB_VBCC_LINKER_PATH: "SDK:vbcc/bin/vlink",
    OS4TB_VBCC_ASSEMBLER_STATUS: "present",
    OS4TB_VBCC_ASSEMBLER_PATH: "SDK:vbcc/bin/vasmppc_std"
  };
  discoveredVersions.forEach((version, idx) => {
    fields[`OS4TB_GCC_${idx}_STATUS`] = "present";
    fields[`OS4TB_GCC_${idx}_VERSION`] = version;
    fields[`OS4TB_GCC_${idx}_DRIVER`] = `Work:SDK/gcc/${version}/gcc`;
    fields[`OS4TB_GCC_${idx}_CC1`] = `Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/${version}/cc1`;
    fields[`OS4TB_GCC_${idx}_AS`] = "Work:SDK/gcc/ppc-amigaos/bin/as";
    fields[`OS4TB_GCC_${idx}_LD`] = "Work:SDK/gcc/ppc-amigaos/bin/ld";
    fields[`OS4TB_GCC_${idx}_INCLUDE_COUNT`] = "0";
    fields[`OS4TB_GCC_${idx}_INTERNAL_INCLUDE_DIR_COUNT`] = "1";
    fields[`OS4TB_GCC_${idx}_INTERNAL_INCLUDE_DIR_0`] = `Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/${version}/include`;
    fields[`OS4TB_GCC_${idx}_LIBRARY_DIR_COUNT`] = "1";
    fields[`OS4TB_GCC_${idx}_LIBRARY_DIR_0`] = `Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/${version}`;
    fields[`OS4TB_GCC_${idx}_RUNTIME_LIBGCC`] = `GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/${version}/libgcc.a`;
    fields[`OS4TB_GCC_${idx}_RUNTIME_LIBGCC_STATUS`] = "present";
    fields[`OS4TB_GCC_${idx}_RUNTIME_LIBGCC_EH`] = `GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/${version}/libgcc_eh.a`;
    fields[`OS4TB_GCC_${idx}_RUNTIME_LIBGCC_EH_STATUS`] = "present";
    fields[`OS4TB_GCC_${idx}_CRTBEGIN`] = "Work:SDK/newlib/lib/crtbegin.o";
    fields[`OS4TB_GCC_${idx}_CRTBEGIN_STATUS`] = "present";
    fields[`OS4TB_GCC_${idx}_CRTEND`] = "Work:SDK/newlib/lib/crtend.o";
    fields[`OS4TB_GCC_${idx}_CRTEND_STATUS`] = "present";
  });
  return fields;
}

test("explicit and auto selections survive reload semantics", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-persist-reload-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c"]);
  const activeFilePath = path.join(dir, "main.c");

  const autoBefore = await readProjectToolchainPreferenceForActiveFile(activeFilePath);
  assert.equal(autoBefore.reason, "ok");
  assert.equal(autoBefore.toolchainId, undefined);

  assert.equal((await setProjectToolchainPreferenceForActiveFile(activeFilePath, "gcc-8.4.0")).reason, "ok");
  const explicitReload = await readProjectToolchainPreferenceForActiveFile(activeFilePath);
  assert.equal(explicitReload.reason, "ok");
  assert.equal(explicitReload.toolchainId, "gcc-8.4.0");

  assert.equal((await setProjectToolchainPreferenceForActiveFile(activeFilePath)).reason, "ok");
  const autoReload = await readProjectToolchainPreferenceForActiveFile(activeFilePath);
  assert.equal(autoReload.reason, "ok");
  assert.equal(autoReload.toolchainId, undefined);
});

test("auto follows active rediscovery while explicit ignores active changes", async () => {
  const snapshotA = createSnapshot("11.5.0", ["11.5.0", "8.4.0", "6.4.0"]);
  const snapshotB = createSnapshot("6.4.0", ["11.5.0", "8.4.0", "6.4.0"]);

  const autoResolvedA = resolveProjectGccToolchain({ snapshot: snapshotA, toolchainId: undefined });
  const autoResolvedB = resolveProjectGccToolchain({ snapshot: snapshotB, toolchainId: undefined });
  assert.equal(autoResolvedA.ok, true);
  assert.equal(autoResolvedB.ok, true);
  if (autoResolvedA.ok && autoResolvedB.ok) {
    assert.equal(autoResolvedA.toolchain.id, "gcc-11.5.0");
    assert.equal(autoResolvedB.toolchain.id, "gcc-6.4.0");
  }

  const explicitA = resolveProjectGccToolchain({ snapshot: snapshotA, toolchainId: "gcc-8.4.0" });
  const explicitB = resolveProjectGccToolchain({ snapshot: snapshotB, toolchainId: "gcc-8.4.0" });
  assert.equal(explicitA.ok, true);
  assert.equal(explicitB.ok, true);
  if (explicitA.ok && explicitB.ok) {
    assert.equal(explicitA.toolchain.id, "gcc-8.4.0");
    assert.equal(explicitB.toolchain.id, "gcc-8.4.0");
  }
});

test("explicit unavailable remains explicit with no fallback and resolves when reappearing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-persist-unavailable-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=gcc-8.4.0"]);
  const activeFilePath = path.join(dir, "main.c");

  const preference = await readProjectToolchainPreferenceForActiveFile(activeFilePath);
  assert.equal(preference.reason, "ok");
  assert.equal(preference.toolchainId, "gcc-8.4.0");

  const missingSnapshot = createSnapshot("11.5.0", ["11.5.0", "6.4.0"]);
  const missingResolve = resolveProjectGccToolchain({ snapshot: missingSnapshot, toolchainId: preference.toolchainId });
  assert.equal(missingResolve.ok, false);
  if (!missingResolve.ok) {
    assert.equal(missingResolve.reason, "toolchain_not_discovered");
  }

  const persistedAfterFailure = await readProjectToolchainPreferenceForActiveFile(activeFilePath);
  assert.equal(persistedAfterFailure.reason, "ok");
  assert.equal(persistedAfterFailure.toolchainId, "gcc-8.4.0");

  const restoredSnapshot = createSnapshot("11.5.0", ["11.5.0", "8.4.0", "6.4.0"]);
  const restoredResolve = resolveProjectGccToolchain({ snapshot: restoredSnapshot, toolchainId: persistedAfterFailure.toolchainId });
  assert.equal(restoredResolve.ok, true);
  if (restoredResolve.ok) {
    assert.equal(restoredResolve.toolchain.id, "gcc-8.4.0");
  }
});

test("project copy preserves toolchain association intent", async () => {
  const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-persist-copy-src-"));
  await writeSource(srcDir, "main.c");
  await writeSource(srcDir, "helper.c");
  await writeManifest(srcDir, ["source=main.c", "source=helper.c", "toolchain=gcc-6.4.0"]);

  const dstDir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-persist-copy-dst-"));
  await fs.cp(srcDir, dstDir, { recursive: true });
  const copiedPreference = await readProjectToolchainPreferenceForActiveFile(path.join(dstDir, "main.c"));
  assert.equal(copiedPreference.reason, "ok");
  assert.equal(copiedPreference.toolchainId, "gcc-6.4.0");
});

test("vbcc explicit selection persists and resolves without gcc fallback", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-persist-vbcc-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=vbcc-os4"]);
  const activeFilePath = path.join(dir, "main.c");

  const preference = await readProjectToolchainPreferenceForActiveFile(activeFilePath);
  assert.equal(preference.reason, "ok");
  assert.equal(preference.toolchainId, "vbcc-os4");

  const snapshot = createSnapshot("11.5.0", ["11.5.0", "8.4.0", "6.4.0"]);
  const resolved = resolveProjectToolchain({ snapshot, toolchainId: preference.toolchainId });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.toolchain.id, "vbcc-os4");
  }
});

test("explicit unavailable vbcc remains explicit and never falls back", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-persist-vbcc-missing-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=vbcc-os4"]);
  const activeFilePath = path.join(dir, "main.c");

  const preference = await readProjectToolchainPreferenceForActiveFile(activeFilePath);
  assert.equal(preference.reason, "ok");
  assert.equal(preference.toolchainId, "vbcc-os4");

  const missingSnapshot = parseToolchainDiscoveryArtifact({
    ...createSnapshotFields("11.5.0", ["11.5.0", "8.4.0", "6.4.0"]),
    OS4TB_VBCC_STATUS: "missing"
  });
  const missingResolve = resolveProjectToolchain({ snapshot: missingSnapshot, toolchainId: preference.toolchainId });
  assert.equal(missingResolve.ok, false);
  if (!missingResolve.ok) {
    assert.equal(missingResolve.reason, "vbcc_not_discovered");
  }
});

test("separate projects keep independent explicit and auto selections", async () => {
  const projectA = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-persist-multi-a-"));
  const projectB = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-persist-multi-b-"));
  await writeSource(projectA, "main.c");
  await writeSource(projectA, "helper.c");
  await writeManifest(projectA, ["source=main.c", "source=helper.c", "toolchain=gcc-8.4.0"]);
  await writeSource(projectB, "main.c");
  await writeSource(projectB, "helper.c");
  await writeManifest(projectB, ["source=main.c", "source=helper.c"]);

  const prefA = await readProjectToolchainPreferenceForActiveFile(path.join(projectA, "main.c"));
  const prefB = await readProjectToolchainPreferenceForActiveFile(path.join(projectB, "main.c"));
  assert.equal(prefA.reason, "ok");
  assert.equal(prefA.toolchainId, "gcc-8.4.0");
  assert.equal(prefB.reason, "ok");
  assert.equal(prefB.toolchainId, undefined);

  const snapshot = createSnapshot("11.5.0", ["11.5.0", "8.4.0", "6.4.0"]);
  const resolvedA = resolveProjectGccToolchain({ snapshot, toolchainId: prefA.toolchainId });
  const resolvedB = resolveProjectGccToolchain({ snapshot, toolchainId: prefB.toolchainId });
  assert.equal(resolvedA.ok, true);
  assert.equal(resolvedB.ok, true);
  if (resolvedA.ok && resolvedB.ok) {
    assert.equal(resolvedA.toolchain.id, "gcc-8.4.0");
    assert.equal(resolvedB.toolchain.id, "gcc-11.5.0");
  }
});
