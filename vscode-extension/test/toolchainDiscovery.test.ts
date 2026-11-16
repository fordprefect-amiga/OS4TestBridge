import test from "node:test";
import assert from "node:assert/strict";
import {
  buildToolchainDiscoverySummary,
  isValidProjectToolchainId,
  parseToolchainDiscoveryArtifact,
  resolveProjectToolchain,
  resolveProjectGccToolchain,
  validateDiscoveryArtifactText
} from "../src/toolchainDiscovery";

test("parses single gcc discovery artifact", () => {
  const parsed = parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_ACTIVE_FRONTEND: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_ACTIVE_VERSION: "11.5.0",
    OS4TB_GCC_COUNT: "1",
    OS4TB_GCC_0_STATUS: "present",
    OS4TB_GCC_0_VERSION: "11.5.0",
    OS4TB_GCC_0_DRIVER: "/System/C/gcc",
    OS4TB_GCC_0_CC1: "Work:SDK/gcc/cc1",
    OS4TB_GCC_0_AS: "Work:SDK/gcc/as",
    OS4TB_GCC_0_LD: "Work:SDK/gcc/ld",
    OS4TB_GCC_0_INCLUDE_COUNT: "2",
    OS4TB_GCC_0_INCLUDE_0: "/SDK/newlib/include",
    OS4TB_GCC_0_INCLUDE_0_KIND: "sdk-newlib",
    OS4TB_GCC_0_INCLUDE_1: "/SDK/gcc/internal/include",
    OS4TB_GCC_0_INCLUDE_1_KIND: "gcc-internal",
    OS4TB_GCC_0_LIBRARY_DIR_COUNT: "1",
    OS4TB_GCC_0_LIBRARY_DIR_0: "/SDK/newlib/lib",
    OS4TB_GCC_0_LIBRARY_INVENTORY_COUNT: "2",
    OS4TB_GCC_0_LIBRARY_INVENTORY_0: "m",
    OS4TB_GCC_0_LIBRARY_INVENTORY_1: "auto",
    OS4TB_GCC_0_LIBRARY_INVENTORY_TRUNCATED: "0",
    OS4TB_GCC_0_RUNTIME_LIBGCC: "GCC:libgcc.a",
    OS4TB_GCC_0_RUNTIME_LIBGCC_STATUS: "present",
    OS4TB_GCC_0_RUNTIME_LIBGCC_EH: "GCC:libgcc_eh.a",
    OS4TB_GCC_0_RUNTIME_LIBGCC_EH_STATUS: "present",
    OS4TB_GCC_0_CRTBEGIN: "/SDK/newlib/lib/crtbegin.o",
    OS4TB_GCC_0_CRTBEGIN_STATUS: "present",
    OS4TB_GCC_0_CRTEND: "/SDK/newlib/lib/crtend.o",
    OS4TB_GCC_0_CRTEND_STATUS: "present",
    OS4TB_VBCC_STATUS: "missing",
    OS4TB_VBCC_VERSION: "unknown",
    OS4TB_AS_STATUS: "present",
    OS4TB_AS_PATH: "Work:SDK/gcc/as",
    OS4TB_AS_VERSION: "GNU assembler 2.24",
    OS4TB_LD_STATUS: "present",
    OS4TB_LD_PATH: "Work:SDK/gcc/ld",
    OS4TB_LD_VERSION: "GNU ld 2.24"
  });
  assert.equal(parsed.gccToolchains.length, 1);
  assert.equal(parsed.gccToolchains[0].version, "11.5.0");
  assert.equal(parsed.gccActiveVersion, "11.5.0");
  assert.equal(parsed.vbccDriverCommand, "unknown");
  assert.equal(parsed.vbccDriverPath, "unknown");
  assert.equal(parsed.vbccLinkerStatus, "unknown");
  assert.deepEqual(parsed.gccToolchains[0].includePaths, ["/SDK/newlib/include", "/SDK/gcc/internal/include"]);
});

test("parses multiple gcc discovery entries preserving include order", () => {
  const parsed = parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_COUNT: "2",
    OS4TB_GCC_0_STATUS: "present",
    OS4TB_GCC_0_VERSION: "8.4.0",
    OS4TB_GCC_0_DRIVER: "/System/C/gcc8",
    OS4TB_GCC_0_CC1: "SDK:gcc8/cc1",
    OS4TB_GCC_0_AS: "SDK:gcc8/as",
    OS4TB_GCC_0_LD: "SDK:gcc8/ld",
    OS4TB_GCC_0_INCLUDE_COUNT: "2",
    OS4TB_GCC_0_INCLUDE_0: "A",
    OS4TB_GCC_0_INCLUDE_1: "B",
    OS4TB_GCC_0_LIBRARY_DIR_COUNT: "0",
    OS4TB_GCC_1_STATUS: "present",
    OS4TB_GCC_1_VERSION: "11.5.0",
    OS4TB_GCC_1_DRIVER: "/System/C/gcc",
    OS4TB_GCC_1_CC1: "SDK:gcc11/cc1",
    OS4TB_GCC_1_AS: "SDK:gcc11/as",
    OS4TB_GCC_1_LD: "SDK:gcc11/ld",
    OS4TB_GCC_1_INCLUDE_COUNT: "1",
    OS4TB_GCC_1_INCLUDE_0: "C",
    OS4TB_GCC_1_LIBRARY_DIR_COUNT: "0"
  });
  assert.equal(parsed.gccToolchains.length, 2);
  assert.deepEqual(parsed.gccToolchains[0].includePaths, ["A", "B"]);
});

test("handles missing sdk and vbcc unknown", () => {
  const parsed = parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "missing",
    OS4TB_SDK_ROOT: "unknown",
    OS4TB_GCC_COUNT: "0",
    OS4TB_VBCC_STATUS: "missing"
  });
  assert.equal(parsed.sdkStatus, "missing");
  assert.equal(parsed.vbccStatus, "missing");
});

test("validates project toolchain identity grammar", () => {
  assert.equal(isValidProjectToolchainId("gcc-11.5.0"), true);
  assert.equal(isValidProjectToolchainId("gcc-8.4.0"), true);
  assert.equal(isValidProjectToolchainId("vbcc-os4"), true);
  assert.equal(isValidProjectToolchainId("gcc"), false);
  assert.equal(isValidProjectToolchainId("gcc-latest"), false);
  assert.equal(isValidProjectToolchainId("vbcc-0.9"), false);
  assert.equal(isValidProjectToolchainId("Work:SDK/gcc"), false);
});

test("resolves explicit discovered vbcc profile", () => {
  const snapshot = parseToolchainDiscoveryArtifact({
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
    OS4TB_VBCC_ASSEMBLER_STATUS: "missing",
    OS4TB_VBCC_ASSEMBLER_PATH: "unknown"
  });
  const resolved = resolveProjectToolchain({ snapshot, toolchainId: "vbcc-os4" });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.toolchain.family, "vbcc");
    assert.equal(resolved.toolchain.id, "vbcc-os4");
    assert.equal(resolved.toolchain.driverCommand, "vc");
    assert.equal(resolved.toolchain.linkerCommand, "vlink");
  }
});

test("resolves explicit discovered gcc profile and derives bounded prefixes", () => {
  const snapshot = parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_ACTIVE_FRONTEND: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_ACTIVE_VERSION: "11.5.0",
    OS4TB_GCC_COUNT: "2",
    OS4TB_GCC_0_STATUS: "present",
    OS4TB_GCC_0_VERSION: "8.4.0",
    OS4TB_GCC_0_DRIVER: "Work:SDK/gcc8/bin/gcc",
    OS4TB_GCC_0_CC1: "Work:SDK/gcc8/bin/libexec/gcc/ppc-amigaos/8.4.0/cc1",
    OS4TB_GCC_0_AS: "Work:SDK/gcc8/bin/as",
    OS4TB_GCC_0_LD: "Work:SDK/gcc8/bin/ld",
    OS4TB_GCC_0_INCLUDE_COUNT: "0",
    OS4TB_GCC_0_INTERNAL_INCLUDE_DIR_COUNT: "1",
    OS4TB_GCC_0_INTERNAL_INCLUDE_DIR_0: "Work:SDK/gcc8/bin/lib/gcc/ppc-amigaos/8.4.0/include",
    OS4TB_GCC_0_LIBRARY_DIR_COUNT: "2",
    OS4TB_GCC_0_LIBRARY_DIR_0: "/SDK/newlib/lib",
    OS4TB_GCC_0_LIBRARY_DIR_1: "/GCC/lib/gcc/ppc-amigaos/8.4.0/newlib/lib",
    OS4TB_GCC_0_RUNTIME_LIBGCC: "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/8.4.0/libgcc.a",
    OS4TB_GCC_0_RUNTIME_LIBGCC_STATUS: "present",
    OS4TB_GCC_0_RUNTIME_LIBGCC_EH: "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/8.4.0/libgcc_eh.a",
    OS4TB_GCC_0_RUNTIME_LIBGCC_EH_STATUS: "present",
    OS4TB_GCC_0_CRTBEGIN: "/SDK/newlib/lib/crtbegin.o",
    OS4TB_GCC_0_CRTBEGIN_STATUS: "present",
    OS4TB_GCC_0_CRTEND: "/SDK/newlib/lib/crtend.o",
    OS4TB_GCC_0_CRTEND_STATUS: "present",
    OS4TB_GCC_1_STATUS: "present",
    OS4TB_GCC_1_VERSION: "11.5.0",
    OS4TB_GCC_1_DRIVER: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_1_CC1: "Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/cc1",
    OS4TB_GCC_1_AS: "Work:SDK/gcc/ppc-amigaos/bin/as",
    OS4TB_GCC_1_LD: "Work:SDK/gcc/ppc-amigaos/bin/ld",
    OS4TB_GCC_1_INCLUDE_COUNT: "0",
    OS4TB_GCC_1_INTERNAL_INCLUDE_DIR_COUNT: "1",
    OS4TB_GCC_1_INTERNAL_INCLUDE_DIR_0: "Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/include",
    OS4TB_GCC_1_LIBRARY_DIR_COUNT: "2",
    OS4TB_GCC_1_LIBRARY_DIR_0: "/SDK/newlib/lib",
    OS4TB_GCC_1_LIBRARY_DIR_1: "/GCC/lib/gcc/ppc-amigaos/11.5.0/newlib/lib",
    OS4TB_GCC_1_RUNTIME_LIBGCC: "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc.a",
    OS4TB_GCC_1_RUNTIME_LIBGCC_STATUS: "present",
    OS4TB_GCC_1_RUNTIME_LIBGCC_EH: "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc_eh.a",
    OS4TB_GCC_1_RUNTIME_LIBGCC_EH_STATUS: "present",
    OS4TB_GCC_1_CRTBEGIN: "/SDK/newlib/lib/crtbegin.o",
    OS4TB_GCC_1_CRTBEGIN_STATUS: "present",
    OS4TB_GCC_1_CRTEND: "/SDK/newlib/lib/crtend.o",
    OS4TB_GCC_1_CRTEND_STATUS: "present"
  });
  const resolved = resolveProjectGccToolchain({ snapshot, toolchainId: "gcc-8.4.0" });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.toolchain.id, "gcc-8.4.0");
    assert.equal(resolved.toolchain.source, "explicit");
    assert.equal(resolved.toolchain.sdkRoot, "Work:SDK");
    assert.equal(resolved.toolchain.driver, "Work:SDK/gcc8/bin/8.4.0/ppc-amigaos-gcc-8");
    assert.equal(resolved.toolchain.driverPrefixPolicy, "bin_only");
    assert.equal(resolved.toolchain.cc1Prefix, "Work:SDK/gcc8/bin/libexec/gcc/ppc-amigaos/8.4.0/");
    assert.equal(resolved.toolchain.gccBinPrefix, "Work:SDK/gcc8/bin/");
    assert.deepEqual(resolved.toolchain.internalIncludeDirs, ["Work:SDK/gcc8/bin/lib/gcc/ppc-amigaos/8.4.0/include"]);
  }
});

test("resolves omitted toolchain to active discovered gcc", () => {
  const snapshot = parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_ACTIVE_FRONTEND: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_ACTIVE_VERSION: "11.5.0",
    OS4TB_GCC_COUNT: "1",
    OS4TB_GCC_0_STATUS: "present",
    OS4TB_GCC_0_VERSION: "11.5.0",
    OS4TB_GCC_0_DRIVER: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_0_CC1: "Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/cc1",
    OS4TB_GCC_0_AS: "Work:SDK/gcc/ppc-amigaos/bin/as",
    OS4TB_GCC_0_LD: "Work:SDK/gcc/ppc-amigaos/bin/ld",
    OS4TB_GCC_0_INCLUDE_COUNT: "0",
    OS4TB_GCC_0_INTERNAL_INCLUDE_DIR_COUNT: "1",
    OS4TB_GCC_0_INTERNAL_INCLUDE_DIR_0: "Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/include",
    OS4TB_GCC_0_LIBRARY_DIR_COUNT: "1",
    OS4TB_GCC_0_LIBRARY_DIR_0: "/SDK/newlib/lib",
    OS4TB_GCC_0_RUNTIME_LIBGCC: "GCC:.../11.5.0/libgcc.a",
    OS4TB_GCC_0_RUNTIME_LIBGCC_STATUS: "present",
    OS4TB_GCC_0_RUNTIME_LIBGCC_EH: "GCC:.../11.5.0/libgcc_eh.a",
    OS4TB_GCC_0_RUNTIME_LIBGCC_EH_STATUS: "present",
    OS4TB_GCC_0_CRTBEGIN: "/SDK/newlib/lib/crtbegin.o",
    OS4TB_GCC_0_CRTBEGIN_STATUS: "present",
    OS4TB_GCC_0_CRTEND: "/SDK/newlib/lib/crtend.o",
    OS4TB_GCC_0_CRTEND_STATUS: "present"
  });
  const resolved = resolveProjectGccToolchain({ snapshot });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.toolchain.id, "gcc-11.5.0");
    assert.equal(resolved.toolchain.source, "default_active");
    assert.equal(resolved.toolchain.sdkRoot, "Work:SDK");
    assert.equal(resolved.toolchain.driver, "gcc");
    assert.equal(resolved.toolchain.driverPrefixPolicy, "dual_b");
  }
});

test("rejects unknown or malformed toolchain identities", () => {
  const snapshot = parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_ACTIVE_FRONTEND: "unknown",
    OS4TB_GCC_ACTIVE_VERSION: "unknown",
    OS4TB_GCC_COUNT: "0"
  });

  const malformedVersionSnapshot = parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_ACTIVE_FRONTEND: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_ACTIVE_VERSION: "11.5.0",
    OS4TB_GCC_COUNT: "1",
    OS4TB_GCC_0_STATUS: "present",
    OS4TB_GCC_0_VERSION: "11.5",
    OS4TB_GCC_0_DRIVER: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_0_CC1: "Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/cc1",
    OS4TB_GCC_0_AS: "Work:SDK/gcc/ppc-amigaos/bin/as",
    OS4TB_GCC_0_LD: "Work:SDK/gcc/ppc-amigaos/bin/ld",
    OS4TB_GCC_0_INCLUDE_COUNT: "0",
    OS4TB_GCC_0_INTERNAL_INCLUDE_DIR_COUNT: "1",
    OS4TB_GCC_0_INTERNAL_INCLUDE_DIR_0: "Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/include",
    OS4TB_GCC_0_LIBRARY_DIR_COUNT: "1",
    OS4TB_GCC_0_LIBRARY_DIR_0: "/SDK/newlib/lib",
    OS4TB_GCC_0_RUNTIME_LIBGCC: "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc.a",
    OS4TB_GCC_0_RUNTIME_LIBGCC_EH: "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc_eh.a",
    OS4TB_GCC_0_CRTBEGIN: "/SDK/newlib/lib/crtbegin.o",
    OS4TB_GCC_0_CRTEND: "/SDK/newlib/lib/crtend.o"
  });
  const malformedVersionResolved = resolveProjectGccToolchain({ snapshot: malformedVersionSnapshot });
  assert.equal(malformedVersionResolved.ok, false);
  if (!malformedVersionResolved.ok) {
    assert.equal(malformedVersionResolved.reason, "toolchain_profile_incomplete");
  }

  const unsafePathSnapshot = parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_ACTIVE_FRONTEND: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_ACTIVE_VERSION: "11.5.0",
    OS4TB_GCC_COUNT: "1",
    OS4TB_GCC_0_STATUS: "present",
    OS4TB_GCC_0_VERSION: "11.5.0",
    OS4TB_GCC_0_DRIVER: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_0_CC1: "Work:SDK/gcc/../escape/cc1",
    OS4TB_GCC_0_AS: "Work:SDK/gcc/ppc-amigaos/bin/as",
    OS4TB_GCC_0_LD: "Work:SDK/gcc/ppc-amigaos/bin/ld",
    OS4TB_GCC_0_INCLUDE_COUNT: "0",
    OS4TB_GCC_0_INTERNAL_INCLUDE_DIR_COUNT: "1",
    OS4TB_GCC_0_INTERNAL_INCLUDE_DIR_0: "Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/include",
    OS4TB_GCC_0_LIBRARY_DIR_COUNT: "1",
    OS4TB_GCC_0_LIBRARY_DIR_0: "/SDK/newlib/lib",
    OS4TB_GCC_0_RUNTIME_LIBGCC: "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc.a",
    OS4TB_GCC_0_RUNTIME_LIBGCC_EH: "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc_eh.a",
    OS4TB_GCC_0_CRTBEGIN: "/SDK/newlib/lib/crtbegin.o",
    OS4TB_GCC_0_CRTEND: "/SDK/newlib/lib/crtend.o"
  });
  const unsafePathResolved = resolveProjectGccToolchain({ snapshot: unsafePathSnapshot });
  assert.equal(unsafePathResolved.ok, false);
  if (!unsafePathResolved.ok) {
    assert.equal(unsafePathResolved.reason, "toolchain_profile_incomplete");
  }
  assert.deepEqual(resolveProjectGccToolchain({ snapshot, toolchainId: "gcc-latest" }), {
    ok: false,
    reason: "toolchain_identity_invalid"
  });
  assert.deepEqual(resolveProjectGccToolchain({ snapshot, toolchainId: "gcc-9.9.9" }), {
    ok: false,
    reason: "toolchain_not_discovered"
  });
});

test("rejects malformed discovery artifact", () => {
  assert.throws(
    () =>
      parseToolchainDiscoveryArtifact({
        OS4TB_DISCOVERY_VERSION: "1",
        OS4TB_SDK_STATUS: "present",
        OS4TB_SDK_ROOT: "Work:SDK",
        OS4TB_GCC_COUNT: "9"
      }),
    /OS4TB_GCC_COUNT_out_of_range/
  );
});

test("rejects unsupported schema version", () => {
  assert.throws(
    () =>
      parseToolchainDiscoveryArtifact({
        OS4TB_DISCOVERY_VERSION: "2",
        OS4TB_SDK_STATUS: "present",
        OS4TB_SDK_ROOT: "Work:SDK",
        OS4TB_GCC_COUNT: "0"
      }),
    /discovery_schema_version_unsupported/
  );
});

test("enforces line length bounds", () => {
  const longLine = `K=${"x".repeat(513)}`;
  assert.throws(() => validateDiscoveryArtifactText(longLine), /discovery_line_too_long/);
});

test("tracks library inventory truncation and runtime symlink statuses", () => {
  const parsed = parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_COUNT: "1",
    OS4TB_GCC_0_STATUS: "present",
    OS4TB_GCC_0_VERSION: "11.5.0",
    OS4TB_GCC_0_DRIVER: "/System/C/gcc",
    OS4TB_GCC_0_CC1: "cc1",
    OS4TB_GCC_0_AS: "as",
    OS4TB_GCC_0_LD: "ld",
    OS4TB_GCC_0_INCLUDE_COUNT: "0",
    OS4TB_GCC_0_LIBRARY_DIR_COUNT: "1",
    OS4TB_GCC_0_LIBRARY_DIR_0: "dir0",
    OS4TB_GCC_0_LIBRARY_INVENTORY_COUNT: "1",
    OS4TB_GCC_0_LIBRARY_INVENTORY_0: "m",
    OS4TB_GCC_0_LIBRARY_INVENTORY_TRUNCATED: "1",
    OS4TB_GCC_0_RUNTIME_LIBGCC_STATUS: "broken_symlink",
    OS4TB_GCC_0_RUNTIME_LIBGCC_EH_STATUS: "symlink",
    OS4TB_GCC_0_CRTBEGIN_STATUS: "present",
    OS4TB_GCC_0_CRTEND_STATUS: "present"
  });
  assert.equal(parsed.gccToolchains[0].libraryInventoryTruncated, true);
  assert.equal(parsed.gccToolchains[0].runtimeLibgccStatus, "broken_symlink");
  assert.equal(parsed.gccToolchains[0].runtimeLibgccEhStatus, "symlink");
});

test("captures include probe stream and discovery status semantics", () => {
  const parsed = parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_COUNT: "1",
    OS4TB_GCC_0_STATUS: "present",
    OS4TB_GCC_0_VERSION: "11.5.0",
    OS4TB_GCC_0_DRIVER: "/System/C/gcc",
    OS4TB_GCC_0_CC1: "cc1",
    OS4TB_GCC_0_AS: "as",
    OS4TB_GCC_0_LD: "ld",
    OS4TB_GCC_0_INCLUDE_COUNT: "1",
    OS4TB_GCC_0_INCLUDE_0: "Work:SDK/newlib/include",
    OS4TB_GCC_0_INCLUDE_PROBE_STREAM: "stderr",
    OS4TB_GCC_0_INCLUDE_DISCOVERY_STATUS: "found",
    OS4TB_GCC_0_INCLUDE_PROBE_STDOUT_HAS_BLOCK: "0",
    OS4TB_GCC_0_INCLUDE_PROBE_STDERR_HAS_BLOCK: "1",
    OS4TB_GCC_0_INTERNAL_INCLUDE_DIR_COUNT: "2",
    OS4TB_GCC_0_INTERNAL_INCLUDE_DIR_0: "Work:SDK/gcc/.../include",
    OS4TB_GCC_0_INTERNAL_INCLUDE_DIR_1: "Work:SDK/gcc/.../include-fixed",
    OS4TB_GCC_0_INTERNAL_STDDEF_DIR: "Work:SDK/gcc/.../include",
    OS4TB_GCC_0_INTERNAL_STDARG_DIR: "Work:SDK/gcc/.../include",
    OS4TB_GCC_0_INTERNAL_STDINT_DIR: "Work:SDK/gcc/.../include",
    OS4TB_GCC_0_LIBRARY_DIR_COUNT: "0"
  });
  assert.equal(parsed.gccToolchains[0].includeProbeStream, "stderr");
  assert.equal(parsed.gccToolchains[0].includeDiscoveryStatus, "found");
  assert.equal(parsed.gccToolchains[0].includeProbeStdoutHasBlock, false);
  assert.equal(parsed.gccToolchains[0].includeProbeStderrHasBlock, true);
  assert.equal(parsed.gccToolchains[0].internalIncludeDirs.length, 2);
});

test("accepts AS/LD present with unknown version strings", () => {
  const parsed = parseToolchainDiscoveryArtifact({
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_COUNT: "0",
    OS4TB_AS_STATUS: "present",
    OS4TB_AS_VERSION: "unknown",
    OS4TB_LD_STATUS: "present",
    OS4TB_LD_VERSION: "unknown"
  });
  assert.equal(parsed.asStatus, "present");
  assert.equal(parsed.asVersion, "unknown");
  assert.equal(parsed.ldStatus, "present");
  assert.equal(parsed.ldVersion, "unknown");
});

test("preserves 28-entry library inventory ordering", () => {
  const fields: Record<string, string> = {
    OS4TB_DISCOVERY_VERSION: "1",
    OS4TB_SDK_STATUS: "present",
    OS4TB_SDK_ROOT: "Work:SDK",
    OS4TB_GCC_COUNT: "1",
    OS4TB_GCC_0_STATUS: "present",
    OS4TB_GCC_0_VERSION: "11.5.0",
    OS4TB_GCC_0_DRIVER: "Work:SDK/gcc/ppc-amigaos/bin/gcc",
    OS4TB_GCC_0_CC1: "Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/cc1",
    OS4TB_GCC_0_AS: "Work:SDK/gcc/ppc-amigaos/bin/as",
    OS4TB_GCC_0_LD: "Work:SDK/gcc/ppc-amigaos/bin/ld",
    OS4TB_GCC_0_INCLUDE_COUNT: "0",
    OS4TB_GCC_0_LIBRARY_DIR_COUNT: "1",
    OS4TB_GCC_0_LIBRARY_DIR_0: "Work:SDK/newlib/lib",
    OS4TB_GCC_0_LIBRARY_INVENTORY_COUNT: "28"
  };
  for (let i = 0; i < 28; i += 1) {
    fields[`OS4TB_GCC_0_LIBRARY_INVENTORY_${i}`] = `lib${i}`;
  }
  const parsed = parseToolchainDiscoveryArtifact(fields);
  assert.equal(parsed.gccToolchains[0].libraryInventory.length, 28);
  assert.equal(parsed.gccToolchains[0].libraryInventory[0], "lib0");
  assert.equal(parsed.gccToolchains[0].libraryInventory[27], "lib27");
});

test("builds concise discovery summary", () => {
  const summary = buildToolchainDiscoverySummary(
    parseToolchainDiscoveryArtifact({
      OS4TB_DISCOVERY_VERSION: "1",
      OS4TB_SDK_STATUS: "present",
      OS4TB_SDK_ROOT: "Work:SDK",
      OS4TB_GCC_COUNT: "1",
      OS4TB_GCC_0_STATUS: "present",
      OS4TB_GCC_0_VERSION: "11.5.0",
      OS4TB_GCC_0_DRIVER: "/System/C/gcc",
      OS4TB_GCC_0_CC1: "cc1",
      OS4TB_GCC_0_AS: "as",
      OS4TB_GCC_0_LD: "ld",
      OS4TB_GCC_0_INCLUDE_COUNT: "1",
      OS4TB_GCC_0_INCLUDE_0: "inc0",
      OS4TB_GCC_0_LIBRARY_DIR_COUNT: "1",
      OS4TB_GCC_0_LIBRARY_DIR_0: "lib0",
      OS4TB_GCC_0_LIBRARY_INVENTORY_COUNT: "1",
      OS4TB_GCC_0_LIBRARY_INVENTORY_0: "m",
      OS4TB_AS_STATUS: "present",
      OS4TB_LD_STATUS: "present",
      OS4TB_VBCC_STATUS: "missing",
      OS4TB_VBCC_DRIVER_COMMAND: "vc"
    })
  );
  assert.match(summary, /SDK: Work:SDK/);
  assert.match(summary, /GCC: 11\.5\.0/);
  assert.match(summary, /Libraries discovered: 1/);
  assert.match(summary, /VBCC: not detected \(vc\)/);
});

test("parses vbcc component fields when present", () => {
  const parsed = parseToolchainDiscoveryArtifact({
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
    OS4TB_VBCC_ASSEMBLER_STATUS: "missing",
    OS4TB_VBCC_ASSEMBLER_PATH: "unknown"
  });
  assert.equal(parsed.vbccStatus, "present");
  assert.equal(parsed.vbccDriverCommand, "vc");
  assert.equal(parsed.vbccDriverPath, "Work:SDK/vbcc/bin/vc");
  assert.equal(parsed.vbccLinkerStatus, "present");
  assert.equal(parsed.vbccLinkerPath, "Work:SDK/vbcc/bin/vlink");
});

test("rejects unsafe vbcc discovered paths", () => {
  assert.throws(
    () =>
      parseToolchainDiscoveryArtifact({
        OS4TB_DISCOVERY_VERSION: "1",
        OS4TB_SDK_STATUS: "present",
        OS4TB_SDK_ROOT: "Work:SDK",
        OS4TB_GCC_COUNT: "0",
        OS4TB_VBCC_STATUS: "present",
        OS4TB_VBCC_DRIVER_PATH: "../unsafe/path"
      }),
    /vbcc_path_invalid/
  );
});
