import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProjectAssemblerSelectionItems,
  formatProjectAssemblerStatusLabel,
  resolveSelectionAssemblerId
} from "../src/assemblerSelection";
import { parseToolchainDiscoveryArtifact } from "../src/toolchainDiscovery";

function createSnapshotFields(): Record<string, string> {
  return {
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
    OS4TB_AS_STATUS: "present",
    OS4TB_AS_PATH: "Work:SDK/gcc/bin/as",
    OS4TB_AS_VERSION: "2.40",
    OS4TB_LD_STATUS: "present",
    OS4TB_LD_PATH: "Work:SDK/gcc/bin/ld",
    OS4TB_LD_VERSION: "2.40"
  };
}

function createSnapshot() {
  return parseToolchainDiscoveryArtifact(createSnapshotFields());
}

test("assembler selection model is discovery-driven and typed", () => {
  const items = buildProjectAssemblerSelectionItems(createSnapshot(), "gnu-as-os4");
  assert.equal(items[0].selectionKind, "automatic");
  assert.equal(items[1].selectionKind, "gnu");
  assert.equal(items[2].selectionKind, "vasm");
  assert.equal(resolveSelectionAssemblerId(items[0]), undefined);
  assert.equal(resolveSelectionAssemblerId(items[1]), "gnu-as-os4");
  assert.equal(resolveSelectionAssemblerId(items[2]), "vasm-ppc-std");
});

test("assembler selection exposes unavailable explicit selection", () => {
  const snapshot = parseToolchainDiscoveryArtifact({
    ...createSnapshotFields(),
    OS4TB_VBCC_ASSEMBLER_STATUS: "missing",
    OS4TB_VBCC_ASSEMBLER_PATH: "unknown"
  });
  const items = buildProjectAssemblerSelectionItems(snapshot, "vasm-ppc-std");
  assert.equal(items[1].selectionKind, "unavailable");
  assert.match(items[1].label, /VASM PPC Standard/);
  assert.match(items[1].label, /unavailable/i);
});

test("assembler status label reflects automatic and unavailable states", () => {
  const snapshot = createSnapshot();
  assert.equal(formatProjectAssemblerStatusLabel(true, undefined, snapshot), "Auto (GNU Assembler)");
  assert.equal(formatProjectAssemblerStatusLabel(true, "gnu-as-os4", snapshot), "GNU Assembler");
  assert.equal(formatProjectAssemblerStatusLabel(true, "vasm-ppc-std", snapshot), "VASM PPC Standard");
  const gnuMissingSnapshot = parseToolchainDiscoveryArtifact({
    ...createSnapshotFields(),
    OS4TB_AS_STATUS: "missing",
    OS4TB_AS_PATH: "unknown"
  });
  assert.equal(formatProjectAssemblerStatusLabel(true, undefined, gnuMissingSnapshot), "Auto (VASM PPC Standard)");
  const allMissingSnapshot = parseToolchainDiscoveryArtifact({
    ...createSnapshotFields(),
    OS4TB_AS_STATUS: "missing",
    OS4TB_AS_PATH: "unknown",
    OS4TB_VBCC_ASSEMBLER_STATUS: "missing",
    OS4TB_VBCC_ASSEMBLER_PATH: "unknown"
  });
  assert.equal(formatProjectAssemblerStatusLabel(true, undefined, allMissingSnapshot), "Auto (!unavailable)");
  assert.equal(
    formatProjectAssemblerStatusLabel(true, "vasm-ppc-std", allMissingSnapshot),
    "VASM PPC Standard (!unavailable)"
  );
  assert.equal(formatProjectAssemblerStatusLabel(false, undefined, snapshot), "No project");
  assert.equal(formatProjectAssemblerStatusLabel(true, undefined, undefined), "Discovery unavailable");
});
