import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProjectToolchainSelectionItems,
  formatProjectToolchainStatusLabel,
  resolveSelectionToolchainId
} from "../src/toolchainSelection";
import { parseToolchainDiscoveryArtifact } from "../src/toolchainDiscovery";

function createSnapshotFields(): Record<string, string> {
  return {
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_ACTIVE_FRONTEND: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_ACTIVE_VERSION: "11.5.0",
    OS4TB_GCC_COUNT: "3",
    OS4TB_GCC_0_STATUS: "present",
    OS4TB_GCC_0_VERSION: "6.4.0",
    OS4TB_GCC_0_DRIVER: "Work:SDK/gcc6/bin/gcc",
    OS4TB_GCC_0_CC1: "Work:SDK/gcc6/bin/libexec/gcc/ppc-amigaos/6.4.0/cc1",
    OS4TB_GCC_0_AS: "Work:SDK/gcc6/bin/as",
    OS4TB_GCC_0_LD: "Work:SDK/gcc6/bin/ld",
    OS4TB_GCC_0_INCLUDE_COUNT: "0",
    OS4TB_GCC_0_LIBRARY_DIR_COUNT: "1",
    OS4TB_GCC_0_LIBRARY_DIR_0: "/SDK/newlib/lib",
    OS4TB_GCC_1_STATUS: "present",
    OS4TB_GCC_1_VERSION: "8.4.0",
    OS4TB_GCC_1_DRIVER: "Work:SDK/gcc8/bin/gcc",
    OS4TB_GCC_1_CC1: "Work:SDK/gcc8/bin/libexec/gcc/ppc-amigaos/8.4.0/cc1",
    OS4TB_GCC_1_AS: "Work:SDK/gcc8/bin/as",
    OS4TB_GCC_1_LD: "Work:SDK/gcc8/bin/ld",
    OS4TB_GCC_1_INCLUDE_COUNT: "0",
    OS4TB_GCC_1_LIBRARY_DIR_COUNT: "1",
    OS4TB_GCC_1_LIBRARY_DIR_0: "/SDK/newlib/lib",
    OS4TB_GCC_2_STATUS: "present",
    OS4TB_GCC_2_VERSION: "11.5.0",
    OS4TB_GCC_2_DRIVER: "Work:SDK/gcc/bin/gcc",
    OS4TB_GCC_2_CC1: "Work:SDK/gcc/bin/libexec/gcc/ppc-amigaos/11.5.0/cc1",
    OS4TB_GCC_2_AS: "Work:SDK/gcc/bin/as",
    OS4TB_GCC_2_LD: "Work:SDK/gcc/bin/ld",
    OS4TB_GCC_2_INCLUDE_COUNT: "0",
    OS4TB_GCC_2_LIBRARY_DIR_COUNT: "1",
    OS4TB_GCC_2_LIBRARY_DIR_0: "/SDK/newlib/lib",
    OS4TB_VBCC_STATUS: "present",
    OS4TB_VBCC_VERSION: "0.9g",
    OS4TB_VBCC_DRIVER_COMMAND: "vc",
    OS4TB_VBCC_DRIVER_PATH: "SDK:vbcc/bin/vc",
    OS4TB_VBCC_LINKER_STATUS: "present",
    OS4TB_VBCC_LINKER_PATH: "SDK:vbcc/bin/vlink",
    OS4TB_VBCC_ASSEMBLER_STATUS: "present",
    OS4TB_VBCC_ASSEMBLER_PATH: "SDK:vbcc/bin/vasmppc_std"
  };
}

function createSnapshot() {
  return parseToolchainDiscoveryArtifact(createSnapshotFields());
}

test("toolchain selection model is discovery-driven and typed", () => {
  const items = buildProjectToolchainSelectionItems(createSnapshot(), "gcc-8.4.0");
  assert.equal(items[0].selectionKind, "automatic");
  assert.equal(items[1].selectionKind, "gcc");
  assert.equal(items[2].selectionKind, "gcc");
  assert.equal(items[3].selectionKind, "gcc");
  assert.equal(items[4].selectionKind, "vbcc");
  assert.equal(items.some((item) => item.label === "GCC 11.5.0"), true);
  assert.equal(items[1].toolchainId, "gcc-11.5.0");
  assert.equal(items[2].toolchainId, "gcc-8.4.0");
  assert.equal(items[3].toolchainId, "gcc-6.4.0");
  assert.equal(items[4].toolchainId, "vbcc-os4");
  assert.equal(resolveSelectionToolchainId(items[0]), undefined);
  assert.equal(resolveSelectionToolchainId(items[2]), "gcc-8.4.0");
  assert.equal(resolveSelectionToolchainId(items[4]), "vbcc-os4");
});

test("selection model exposes unavailable current selection", () => {
  const items = buildProjectToolchainSelectionItems(createSnapshot(), "gcc-9.9.9");
  assert.equal(items[1].selectionKind, "unavailable");
  assert.match(items[1].label, /gcc-9.9.9/);
  assert.match(items[1].label, /unavailable/i);
  assert.equal(resolveSelectionToolchainId(items[1]), undefined);
});

test("selection model exposes unavailable explicit vbcc selection", () => {
  const snapshot = parseToolchainDiscoveryArtifact({
    ...createSnapshotFields(),
    OS4TB_VBCC_STATUS: "missing"
  });
  const items = buildProjectToolchainSelectionItems(snapshot, "vbcc-os4");
  assert.equal(items[1].selectionKind, "unavailable");
  assert.match(items[1].label, /vbcc-os4/);
  assert.match(items[1].label, /unavailable/i);
  assert.equal(items.some((item) => item.selectionKind === "vbcc"), false);
});

test("status label marks unavailable explicit toolchain", () => {
  const snapshot = createSnapshot();
  assert.equal(formatProjectToolchainStatusLabel(true, undefined, snapshot), "Auto (GCC 11.5.0)");
  assert.equal(formatProjectToolchainStatusLabel(true, "gcc-8.4.0", snapshot), "GCC 8.4.0");
  assert.equal(formatProjectToolchainStatusLabel(true, "gcc-9.9.9", snapshot), "GCC 9.9.9 (!unavailable)");
  assert.equal(formatProjectToolchainStatusLabel(true, "vbcc-os4", snapshot), "VBCC");
  const missingVbccSnapshot = parseToolchainDiscoveryArtifact({
    ...createSnapshotFields(),
    OS4TB_VBCC_STATUS: "missing"
  });
  assert.equal(formatProjectToolchainStatusLabel(true, "vbcc-os4", missingVbccSnapshot), "VBCC (!unavailable)");
  assert.equal(formatProjectToolchainStatusLabel(true, undefined, undefined), "Discovery unavailable");
  assert.equal(formatProjectToolchainStatusLabel(false, undefined, snapshot), "No project");
  assert.equal(
    formatProjectToolchainStatusLabel(true, undefined, snapshot, "manifest_duplicate_toolchain"),
    "Manifest error (duplicate toolchain)"
  );
  assert.equal(
    formatProjectToolchainStatusLabel(true, undefined, snapshot, "manifest_read_failed"),
    "Manifest read failed"
  );
});
