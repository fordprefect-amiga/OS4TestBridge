import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import {
  OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH,
  OS4TB_GCC_PROJECT_DEFINE_VALUE_MAX_LENGTH,
  OS4TB_GCC_PROJECT_MAX_HEADERS,
  OS4TB_GCC_PROJECT_MAX_DEFINES,
  OS4TB_GCC_PROJECT_MAX_INCLUDES,
  OS4TB_GCC_PROJECT_MAX_LIBRARIES,
  OS4TB_GCC_PROJECT_MAX_SOURCES,
  OS4TB_GCC_PROJECT_MIN_DEFINES,
  OS4TB_GCC_PROJECT_MIN_HEADERS,
  OS4TB_GCC_PROJECT_MIN_INCLUDES,
  OS4TB_GCC_PROJECT_MIN_LIBRARIES,
  OS4TB_GCC_PROJECT_MIN_SOURCES,
  OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH,
  OS4TB_GCC_PROJECT_DEFAULT_C_STANDARD,
  OS4TB_GCC_PROJECT_DEFAULT_WARNING_LEVEL,
  OS4TB_GCC_PROJECT_DEFAULT_OPTIMIZATION,
  OS4TB_GCC_PROJECT_DEFAULT_DEBUG_SYMBOLS,
  OS4TB_GCC_PROJECT_TOOLCHAIN_ID_MAX_LENGTH,
  OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS,
  PROJECT_GUEST_MANIFEST_FILENAME,
  PROJECT_MANIFEST_FILENAME,
  buildGuestProjectDirectoryPath,
  buildGuestProjectManifestPath,
  buildGuestProjectManifestText,
  buildProjectManifestBasename,
  buildProjectObjectBasename,
  buildProjectStagedDirectoryBasename,
  buildProjectStagedSourceBasenameForKind,
  buildProjectStagedSourceBasename,
  classifyProjectSourceRelativePath,
  isValidProjectRelativePath,
  locateProjectManifestForActiveFile,
  parseProjectManifestForActiveFile,
  readProjectToolchainPreferenceForActiveFile,
  setProjectToolchainPreferenceForActiveFile,
  type ProjectResolvedToolchainProfile,
  writeProjectManifestAtomically,
  validateResolvedToolchainProfile
} from "../src/gccProjectBuildRun";

async function writeManifest(projectDir: string, lines: string[]): Promise<void> {
  await fs.writeFile(path.join(projectDir, PROJECT_MANIFEST_FILENAME), `${lines.join("\n")}\n`, "utf8");
}

async function writeSource(projectDir: string, relativePath: string): Promise<void> {
  const filePath = path.join(projectDir, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "int x(void){return 0;}\n", "utf8");
}

async function writeHeader(projectDir: string, relativePath: string): Promise<void> {
  const filePath = path.join(projectDir, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "#ifndef X\n#define X\n#endif\n", "utf8");
}

async function writeIncludeDir(projectDir: string, relativePath: string): Promise<void> {
  await fs.mkdir(path.join(projectDir, ...relativePath.split("/")), { recursive: true });
}

test("manifest constants define bounded source/header/include ranges", () => {
  assert.equal(OS4TB_GCC_PROJECT_MIN_SOURCES, 2);
  assert.equal(OS4TB_GCC_PROJECT_MAX_SOURCES, 64);
  assert.equal(OS4TB_GCC_PROJECT_MIN_HEADERS, 0);
  assert.equal(OS4TB_GCC_PROJECT_MAX_HEADERS, 8);
  assert.equal(OS4TB_GCC_PROJECT_MIN_INCLUDES, 0);
  assert.equal(OS4TB_GCC_PROJECT_MAX_INCLUDES, 4);
  assert.equal(OS4TB_GCC_PROJECT_MIN_DEFINES, 0);
  assert.equal(OS4TB_GCC_PROJECT_MAX_DEFINES, 16);
  assert.equal(OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH, 64);
  assert.equal(OS4TB_GCC_PROJECT_DEFINE_VALUE_MAX_LENGTH, 64);
  assert.equal(OS4TB_GCC_PROJECT_MIN_LIBRARIES, 0);
  assert.equal(OS4TB_GCC_PROJECT_MAX_LIBRARIES, 16);
  assert.equal(OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH, 64);
  assert.equal(OS4TB_GCC_PROJECT_DEFAULT_C_STANDARD, "c11");
  assert.equal(OS4TB_GCC_PROJECT_DEFAULT_WARNING_LEVEL, "extra");
  assert.equal(OS4TB_GCC_PROJECT_DEFAULT_OPTIMIZATION, "none");
  assert.equal(OS4TB_GCC_PROJECT_DEFAULT_DEBUG_SYMBOLS, "no");
  assert.equal(OS4TB_GCC_PROJECT_TOOLCHAIN_ID_MAX_LENGTH, 32);
});

async function parseReasonForSourceCount(sourceCount: number, unsafePath?: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-source-count-"));
  await writeSource(dir, "src/active.c");
  const lines: string[] = [];
  for (let i = 0; i < sourceCount; i += 1) {
    const relativePath = `src/source_${i}.c`;
    await writeSource(dir, relativePath);
    lines.push(`source=${relativePath}`);
  }
  if (unsafePath && sourceCount > 0) {
    lines[sourceCount - 1] = `source=${unsafePath}`;
  }
  await writeManifest(dir, lines);
  return (await parseProjectManifestForActiveFile(path.join(dir, "src/active.c"))).reason;
}

test("parser enforces bounded source counts across legacy and canonical scales", async () => {
  assert.equal(await parseReasonForSourceCount(0), "manifest_source_count_out_of_range");
  assert.equal(await parseReasonForSourceCount(1), "manifest_source_count_out_of_range");
  assert.equal(await parseReasonForSourceCount(8), "ok");
  assert.equal(await parseReasonForSourceCount(9), "ok");
  assert.equal(await parseReasonForSourceCount(50), "ok");
  assert.equal(await parseReasonForSourceCount(OS4TB_GCC_PROJECT_MAX_SOURCES), "ok");
  assert.equal(await parseReasonForSourceCount(OS4TB_GCC_PROJECT_MAX_SOURCES + 1), "manifest_source_count_out_of_range");
});

test("parser rejects unsafe source paths even near bounded maximum", async () => {
  assert.equal(await parseReasonForSourceCount(OS4TB_GCC_PROJECT_MAX_SOURCES, "../escape.c"), "manifest_unsafe_source");
  assert.equal(await parseReasonForSourceCount(OS4TB_GCC_PROJECT_MAX_SOURCES, "/absolute/path.c"), "manifest_unsafe_source");
});

test("project naming contracts stay deterministic", () => {
  const requestId = "gccproj_20261107T043527818Z_0001";
  assert.equal(buildProjectStagedSourceBasename("ignored", 0), "source0.c");
  assert.equal(buildProjectStagedDirectoryBasename(requestId), `project_${requestId}`);
  assert.equal(buildProjectObjectBasename(requestId, 0), `build_${requestId}_source0.o`);
  assert.equal(buildProjectManifestBasename(), PROJECT_GUEST_MANIFEST_FILENAME);
  assert.equal(buildGuestProjectDirectoryPath(requestId), `SAMDROP:incoming/project_${requestId}`);
  assert.equal(buildGuestProjectManifestPath(requestId), `SAMDROP:incoming/project_${requestId}/project_manifest.txt`);
  assert.equal(buildProjectStagedSourceBasenameForKind("ignored", 0, "c"), "source0.c");
  assert.equal(buildProjectStagedSourceBasenameForKind("ignored", 1, "asm"), "source1.s");
});

test("classifies project source kinds conservatively", () => {
  assert.equal(classifyProjectSourceRelativePath("src/main.c"), "c");
  assert.equal(classifyProjectSourceRelativePath("src/helper.s"), "asm");
  assert.equal(classifyProjectSourceRelativePath("src/helper.S"), "unsupported");
  assert.equal(classifyProjectSourceRelativePath("../helper.s"), "unsafe");
});

test("guest project manifest text includes source/header/include/define/library arrays", () => {
  const text = buildGuestProjectManifestText(
    ["src/main.c", "src/math.c", "src/expected.c"],
    ["c", "c", "c"],
    ["include/project.h"],
    ["include"],
    ["OS4TB_FEATURE_ENABLED", "OS4TB_EXPECTED_VALUE=42"],
    ["m", "auto"]
  );
  assert.match(text, /^SOURCE_COUNT=3$/m);
  assert.match(text, /^SOURCE_0=src\/main\.c$/m);
  assert.match(text, /^SOURCE_TYPE_0=c$/m);
  assert.match(text, /^HEADER_COUNT=1$/m);
  assert.match(text, /^HEADER_0=include\/project\.h$/m);
  assert.match(text, /^INCLUDE_COUNT=1$/m);
  assert.match(text, /^INCLUDE_0=include$/m);
  assert.match(text, /^DEFINE_COUNT=2$/m);
  assert.match(text, /^DEFINE_0=OS4TB_FEATURE_ENABLED$/m);
  assert.match(text, /^DEFINE_1=OS4TB_EXPECTED_VALUE=42$/m);
  assert.match(text, /^LIBRARY_COUNT=2$/m);
  assert.match(text, /^LIBRARY_0=m$/m);
  assert.match(text, /^LIBRARY_1=auto$/m);
  assert.doesNotMatch(text, /^RUN_PROGRAM=/m);
  assert.match(text, /^C_STANDARD=c11$/m);
  assert.match(text, /^WARNING_LEVEL=extra$/m);
  assert.match(text, /^OPTIMIZATION=none$/m);
  assert.match(text, /^DEBUG_SYMBOLS=no$/m);
});

test("guest project manifest text supports explicit build-only execution policy", () => {
  const text = buildGuestProjectManifestText(
    ["src/main.c", "src/helper.c"],
    ["c", "c"],
    [],
    [],
    [],
    [],
    undefined,
    undefined,
    undefined,
    "build_only"
  );
  assert.match(text, /^RUN_PROGRAM=no$/m);
});

test("guest project manifest text omits execution policy field for build-and-run mode", () => {
  const text = buildGuestProjectManifestText(
    ["src/main.c", "src/helper.c"],
    ["c", "c"],
    [],
    [],
    [],
    [],
    undefined,
    undefined,
    undefined,
    "build_and_run"
  );
  assert.doesNotMatch(text, /^RUN_PROGRAM=/m);
});

test("guest project manifest text supports bounded declarative build profiles", () => {
  const text = buildGuestProjectManifestText(
    ["src/main.c", "src/helper.c"],
    ["c", "c"],
    [],
    [],
    [],
    [],
    {
      cStandard: "c99",
      warningLevel: "strict",
      optimization: "release",
      debugSymbols: "yes"
    }
  );
  assert.match(text, /^C_STANDARD=c99$/m);
  assert.match(text, /^WARNING_LEVEL=strict$/m);
  assert.match(text, /^OPTIMIZATION=release$/m);
  assert.match(text, /^DEBUG_SYMBOLS=yes$/m);
});

test("guest project manifest text includes resolved toolchain profile", () => {
  const text = buildGuestProjectManifestText(
    ["src/main.c", "src/helper.c"],
    ["c", "c"],
    [],
    [],
    [],
    [],
    {
      cStandard: "c11",
      warningLevel: "extra",
      optimization: "none",
      debugSymbols: "no"
    },
    {
      id: "gcc-11.5.0",
      source: "explicit",
      family: "gcc",
      version: "11.5.0",
      driver: "gcc",
      driverPrefixPolicy: "dual_b",
      cc1Prefix: "Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/",
      gccBinPrefix: "Work:SDK/gcc/ppc-amigaos/bin/",
      internalIncludeDirs: ["Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/include"],
      sdkRoot: "Work:SDK",
      asPath: "Work:SDK/gcc/ppc-amigaos/bin/as",
      ldPath: "Work:SDK/gcc/ppc-amigaos/bin/ld",
      runtimeLibgcc: "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc.a",
      runtimeLibgccEh: "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc_eh.a",
      crtbeginPath: "/SDK/newlib/lib/crtbegin.o",
      crtendPath: "/SDK/newlib/lib/crtend.o",
      libraryDirs: ["/SDK/newlib/lib", "/GCC/lib/gcc/ppc-amigaos/11.5.0/newlib/lib"]
    }
  );
  assert.match(text, /^TOOLCHAIN=gcc-11.5.0$/m);
  assert.match(text, /^TOOLCHAIN_SOURCE=explicit$/m);
  assert.match(text, /^TOOLCHAIN_FAMILY=gcc$/m);
  assert.match(text, /^TOOLCHAIN_VERSION=11.5.0$/m);
  assert.match(text, /^TOOLCHAIN_DRIVER=gcc$/m);
  assert.match(text, /^TOOLCHAIN_DRIVER_PREFIX_POLICY=dual_b$/m);
  assert.match(text, /^TOOLCHAIN_CC1_PREFIX=Work:SDK\/gcc\/ppc-amigaos\/bin\/libexec\/gcc\/ppc-amigaos\/11.5.0\/$/m);
  assert.match(text, /^TOOLCHAIN_GCC_BIN_PREFIX=Work:SDK\/gcc\/ppc-amigaos\/bin\/$/m);
  assert.match(text, /^TOOLCHAIN_INTERNAL_INCLUDE_COUNT=1$/m);
  assert.match(text, /^TOOLCHAIN_INTERNAL_INCLUDE_0=Work:SDK\/gcc\/ppc-amigaos\/bin\/lib\/gcc\/ppc-amigaos\/11.5.0\/include$/m);
  assert.match(text, /^TOOLCHAIN_SDK_ROOT=Work:SDK$/m);
  assert.match(text, /^TOOLCHAIN_LD_PATH=Work:SDK\/gcc\/ppc-amigaos\/bin\/ld$/m);
  assert.match(text, /^TOOLCHAIN_LIBRARY_DIR_COUNT=2$/m);
  assert.match(text, /^TOOLCHAIN_LIBRARY_DIR_0=\/SDK\/newlib\/lib$/m);
  assert.match(text, /^TOOLCHAIN_LIBRARY_DIR_1=\/GCC\/lib\/gcc\/ppc-amigaos\/11.5.0\/newlib\/lib$/m);
});

test("guest project manifest text includes resolved vbcc toolchain profile", () => {
  const text = buildGuestProjectManifestText(
    ["src/main.c", "src/helper.c"],
    ["c", "c"],
    [],
    [],
    [],
    ["m"],
    {
      cStandard: "c99",
      warningLevel: "default",
      optimization: "none",
      debugSymbols: "no"
    },
    {
      id: "vbcc-os4",
      source: "explicit",
      family: "vbcc",
      version: "unknown",
      driverCommand: "vc",
      driverPath: "Work:SDK/vbcc/bin/vc",
      compilerCommand: "vbccppc",
      normalBuildAssembler: "vasmppc_std",
      linkerCommand: "vlink",
      linkerPath: "Work:SDK/vbcc/bin/vlink",
      supportedStandards: ["c90", "c99"]
    } satisfies ProjectResolvedToolchainProfile
  );
  assert.match(text, /^TOOLCHAIN=vbcc-os4$/m);
  assert.match(text, /^TOOLCHAIN_FAMILY=vbcc$/m);
  assert.match(text, /^VBCC_DRIVER=vc$/m);
  assert.match(text, /^VBCC_DRIVER_PATH=Work:SDK\/vbcc\/bin\/vc$/m);
  assert.match(text, /^VBCC_COMPILER=vbccppc$/m);
  assert.match(text, /^VBCC_ASSEMBLER=vasmppc_std$/m);
  assert.match(text, /^VBCC_LINKER=vlink$/m);
  assert.match(text, /^VBCC_LINKER_PATH=Work:SDK\/vbcc\/bin\/vlink$/m);
});

test("resolved toolchain profile validation rejects malformed profiles and accepts valid profile", () => {
  const validProfile = {
    id: "gcc-11.5.0",
    source: "explicit" as const,
    family: "gcc" as const,
    version: "11.5.0",
    driver: "gcc",
    driverPrefixPolicy: "dual_b" as const,
    cc1Prefix: "Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/",
    gccBinPrefix: "Work:SDK/gcc/ppc-amigaos/bin/",
    internalIncludeDirs: ["Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/include"],
    sdkRoot: "Work:SDK",
    asPath: "Work:SDK/gcc/ppc-amigaos/bin/as",
    ldPath: "Work:SDK/gcc/ppc-amigaos/bin/ld",
    runtimeLibgcc: "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc.a",
    runtimeLibgccEh: "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc_eh.a",
    crtbeginPath: "/SDK/newlib/lib/crtbegin.o",
    crtendPath: "/SDK/newlib/lib/crtend.o",
    libraryDirs: ["/SDK/newlib/lib", "/GCC/lib/gcc/ppc-amigaos/11.5.0/newlib/lib"]
  };
  assert.equal(validateResolvedToolchainProfile(validProfile), undefined);

  assert.equal(validateResolvedToolchainProfile({ ...validProfile, driver: "" }), "toolchain_driver_invalid");
  assert.equal(
    validateResolvedToolchainProfile({ ...validProfile, driverPrefixPolicy: "none" as "dual_b" }),
    "toolchain_driver_prefix_policy_invalid"
  );
  assert.equal(
    validateResolvedToolchainProfile({ ...validProfile, internalIncludeDirs: [""] }),
    "toolchain_internal_include_dir_invalid"
  );
  assert.equal(
    validateResolvedToolchainProfile({ ...validProfile, internalIncludeDirs: [] }),
    "toolchain_internal_include_dir_count_invalid"
  );
  assert.equal(
    validateResolvedToolchainProfile({
      ...validProfile,
      internalIncludeDirs: [
        "Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/include",
        "Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/include"
      ]
    }),
    "toolchain_internal_include_dir_duplicate"
  );
  assert.equal(
    validateResolvedToolchainProfile({ ...validProfile, sdkRoot: "Work:SDK/../escape" }),
    "toolchain_sdk_root_invalid"
  );
  assert.equal(validateResolvedToolchainProfile({ ...validProfile, runtimeLibgcc: "" }), "toolchain_runtime_libgcc_invalid");
  assert.equal(
    validateResolvedToolchainProfile({
      ...validProfile,
      libraryDirs: Array.from({ length: OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS + 1 }, (_, i) => `/SDK/lib${i}`)
    }),
    "toolchain_library_dir_count_invalid"
  );
  assert.equal(
    validateResolvedToolchainProfile({ ...validProfile, gccBinPrefix: "Work:SDK/gcc/../bin/" }),
    "toolchain_gcc_bin_prefix_invalid"
  );
  assert.equal(validateResolvedToolchainProfile({ ...validProfile, version: "11.5" }), "toolchain_version_invalid");
  assert.equal(
    validateResolvedToolchainProfile({ ...validProfile, id: "vbcc-os4", family: "other" as "gcc" }),
    "toolchain_family_invalid"
  );
  assert.equal(
    validateResolvedToolchainProfile({ ...validProfile, cc1Prefix: "" }),
    "toolchain_cc1_prefix_invalid"
  );
  const validVbccProfile: ProjectResolvedToolchainProfile = {
    id: "vbcc-os4",
    source: "explicit" as const,
    family: "vbcc" as const,
    version: "unknown",
    driverCommand: "vc" as const,
    driverPath: "Work:SDK/vbcc/bin/vc",
    compilerCommand: "vbccppc" as const,
    normalBuildAssembler: "vasmppc_std" as const,
    linkerCommand: "vlink" as const,
    linkerPath: "Work:SDK/vbcc/bin/vlink",
    supportedStandards: ["c90", "c99"] as const
  };
  assert.equal(validateResolvedToolchainProfile(validVbccProfile), undefined);
  assert.equal(validateResolvedToolchainProfile({ ...validVbccProfile, linkerPath: "" }), "toolchain_linker_path_invalid");
  assert.equal(validateResolvedToolchainProfile(validProfile), undefined);
});

test("relative-path validator accepts bounded tree entries", () => {
  assert.equal(isValidProjectRelativePath("src/main.c", ".c"), true);
  assert.equal(isValidProjectRelativePath("include/values.h", ".h"), true);
  assert.equal(isValidProjectRelativePath("include"), true);
});

test("relative-path validator rejects traversal, absolute, and malformed entries", () => {
  const invalid = [
    "../src/main.c",
    "/src/main.c",
    "Work:src/main.c",
    "src\\main.c",
    "src//main.c",
    "src/./main.c",
    "src/../main.c"
  ];
  for (const token of invalid) {
    assert.equal(isValidProjectRelativePath(token, ".c"), false);
  }
});

test("parser returns source/header/include absolute and relative arrays", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-tree-ok-"));
  await writeSource(dir, "src/main.c");
  await writeSource(dir, "src/math.c");
  await writeSource(dir, "src/expected.c");
  await writeHeader(dir, "include/values.h");
  await writeIncludeDir(dir, "include");
  await writeManifest(dir, [
    "source=src/main.c",
    "source=src/math.c",
    "source=src/expected.c",
    "header=include/values.h",
    "include=include",
    "define=OS4TB_FEATURE_ENABLED",
    "define=OS4TB_EXPECTED_VALUE=42",
    "library=m",
    "library=auto"
  ]);
  const parsed = await parseProjectManifestForActiveFile(path.join(dir, "src/main.c"));
  assert.equal(parsed.reason, "ok");
  assert.deepEqual(parsed.manifest?.sourceRelativePaths, ["src/main.c", "src/math.c", "src/expected.c"]);
  assert.deepEqual(parsed.manifest?.headerRelativePaths, ["include/values.h"]);
  assert.deepEqual(parsed.manifest?.includeRelativePaths, ["include"]);
  assert.deepEqual(parsed.manifest?.defineEntries, ["OS4TB_FEATURE_ENABLED", "OS4TB_EXPECTED_VALUE=42"]);
  assert.deepEqual(parsed.manifest?.libraries, ["m", "auto"]);
  assert.deepEqual(parsed.manifest?.defines, [
    { name: "OS4TB_FEATURE_ENABLED", value: null },
    { name: "OS4TB_EXPECTED_VALUE", value: "42" }
  ]);
  assert.equal(parsed.manifest?.cStandard, "c11");
  assert.equal(parsed.manifest?.warningLevel, "extra");
  assert.equal(parsed.manifest?.optimization, "none");
  assert.equal(parsed.manifest?.debugSymbols, "no");
  assert.equal(parsed.manifest?.toolchainId, undefined);
  assert.deepEqual(parsed.manifest?.sources, [
    path.join(dir, "src/main.c"),
    path.join(dir, "src/math.c"),
    path.join(dir, "src/expected.c")
  ]);
  assert.deepEqual(parsed.manifest?.headers, [path.join(dir, "include/values.h")]);
  assert.deepEqual(parsed.manifest?.includes, [path.join(dir, "include")]);
});

test("parser keeps Slice 2 flat manifests valid without headers/includes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-flat-ok-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c"]);
  const parsed = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsed.reason, "ok");
  assert.deepEqual(parsed.manifest?.sourceRelativePaths, ["main.c", "helper.c"]);
  assert.deepEqual(parsed.manifest?.headerRelativePaths, []);
  assert.deepEqual(parsed.manifest?.includeRelativePaths, []);
  assert.deepEqual(parsed.manifest?.defineEntries, []);
  assert.deepEqual(parsed.manifest?.defines, []);
  assert.deepEqual(parsed.manifest?.libraries, []);
  assert.equal(parsed.manifest?.cStandard, "c11");
  assert.equal(parsed.manifest?.warningLevel, "extra");
  assert.equal(parsed.manifest?.optimization, "none");
  assert.equal(parsed.manifest?.debugSymbols, "no");
  assert.equal(parsed.manifest?.toolchainId, undefined);
  assert.deepEqual(parsed.manifest?.sourceKinds, ["c", "c"]);
});

test("parser accepts mixed C and assembler source entries", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-mixed-source-"));
  await writeSource(dir, "main.c");
  await fs.writeFile(path.join(dir, "helper.s"), ".text\n.globl helper\nhelper:\n    li 3,7\n    blr\n", "utf8");
  await writeManifest(dir, ["source=main.c", "source=helper.s", "toolchain=gcc-11.5.0", "assembler=gnu-as-os4"]);
  const parsed = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsed.reason, "ok");
  assert.deepEqual(parsed.manifest?.sourceKinds, ["c", "asm"]);

  await writeManifest(dir, ["source=main.c", "source=helper.S"]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_source_not_supported_file"
  );
});

test("parser accepts explicit gcc toolchain identities", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-toolchain-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, [
    "source=main.c",
    "source=helper.c",
    "toolchain=gcc-11.5.0"
  ]);
  const parsed115 = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsed115.reason, "ok");
  assert.equal(parsed115.manifest?.toolchainId, "gcc-11.5.0");

  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=gcc-8.4.0"]);
  const parsed84 = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsed84.reason, "ok");
  assert.equal(parsed84.manifest?.toolchainId, "gcc-8.4.0");
});

test("parser accepts explicit vbcc toolchain identity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-toolchain-vbcc-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, [
    "source=main.c",
    "source=helper.c",
    "toolchain=vbcc-os4"
  ]);
  const parsed = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsed.reason, "ok");
  assert.equal(parsed.manifest?.toolchainId, "vbcc-os4");
});

test("parser rejects malformed, duplicate, and unsafe toolchain identities", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-toolchain-invalid-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");

  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=gcc"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_unsafe_toolchain");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=gcc-latest"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_unsafe_toolchain");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=vbcc-0.9"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_unsafe_toolchain");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=/System/C/gcc"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_unsafe_toolchain");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=Work:SDK/gcc/ppc-amigaos/bin/gcc"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_unsafe_toolchain");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=gcc-11.5.0", "toolchain=gcc-8.4.0"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_duplicate_toolchain");
});

test("parser accepts explicit assembler identities and coexists with toolchain key", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-assembler-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=gcc-11.5.0", "assembler=gnu-as-os4"]);
  const parsedGnu = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsedGnu.reason, "ok");
  assert.equal(parsedGnu.manifest?.toolchainId, "gcc-11.5.0");
  assert.equal(parsedGnu.manifest?.assemblerId, "gnu-as-os4");

  await writeManifest(dir, ["source=main.c", "source=helper.c", "assembler=vasm-ppc-std"]);
  const parsedVasm = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsedVasm.reason, "ok");
  assert.equal(parsedVasm.manifest?.assemblerId, "vasm-ppc-std");
});

test("parser rejects malformed, duplicate, and unsafe assembler identities", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-assembler-invalid-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "assembler=gnu-as"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_unsafe_assembler");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "assembler=vasm"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_unsafe_assembler");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "assembler=gnu-as-os4", "assembler=vasm-ppc-std"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_duplicate_assembler");
});

test("parser accepts bounded build profile values", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-profile-values-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, [
    "source=main.c",
    "source=helper.c",
    "c_standard=c90",
    "warning_level=default",
    "optimization=none",
    "debug_symbols=no"
  ]);
  const parsedC90 = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsedC90.reason, "ok");
  assert.equal(parsedC90.manifest?.cStandard, "c90");
  assert.equal(parsedC90.manifest?.warningLevel, "default");
  assert.equal(parsedC90.manifest?.optimization, "none");
  assert.equal(parsedC90.manifest?.debugSymbols, "no");

  await writeManifest(dir, [
    "source=main.c",
    "source=helper.c",
    "c_standard=c99",
    "warning_level=extra",
    "optimization=debug",
    "debug_symbols=yes"
  ]);
  const parsedC99 = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsedC99.reason, "ok");
  assert.equal(parsedC99.manifest?.cStandard, "c99");
  assert.equal(parsedC99.manifest?.warningLevel, "extra");
  assert.equal(parsedC99.manifest?.optimization, "debug");
  assert.equal(parsedC99.manifest?.debugSymbols, "yes");

  await writeManifest(dir, [
    "source=main.c",
    "source=helper.c",
    "c_standard=c11",
    "warning_level=strict",
    "optimization=release",
    "debug_symbols=no"
  ]);
  const parsedC11 = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsedC11.reason, "ok");
  assert.equal(parsedC11.manifest?.cStandard, "c11");
  assert.equal(parsedC11.manifest?.warningLevel, "strict");
  assert.equal(parsedC11.manifest?.optimization, "release");
  assert.equal(parsedC11.manifest?.debugSymbols, "no");
});

test("parser rejects invalid or duplicate build profile values", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-profile-invalid-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");

  await writeManifest(dir, ["source=main.c", "source=helper.c", "c_standard=gnu11"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_unsafe_c_standard");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "c_standard=c23"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_unsafe_c_standard");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "c_standard=c11", "c_standard=c99"]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_duplicate_c_standard"
  );

  await writeManifest(dir, ["source=main.c", "source=helper.c", "warning_level=everything"]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_unsafe_warning_level"
  );
  await writeManifest(dir, ["source=main.c", "source=helper.c", "warning_level=-Wall"]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_unsafe_warning_level"
  );
  await writeManifest(dir, ["source=main.c", "source=helper.c", "warning_level=extra", "warning_level=strict"]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_duplicate_warning_level"
  );

  await writeManifest(dir, ["source=main.c", "source=helper.c", "optimization=-O9"]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_unsafe_optimization"
  );
  await writeManifest(dir, ["source=main.c", "source=helper.c", "optimization=fast"]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_unsafe_optimization"
  );
  await writeManifest(dir, ["source=main.c", "source=helper.c", "optimization=none", "optimization=release"]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_duplicate_optimization"
  );

  await writeManifest(dir, ["source=main.c", "source=helper.c", "debug_symbols=maybe"]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_unsafe_debug_symbols"
  );
  await writeManifest(dir, ["source=main.c", "source=helper.c", "debug_symbols=yes", "debug_symbols=no"]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_duplicate_debug_symbols"
  );
});

test("parser rejects include count above bounded maximum", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-include-count-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  const lines = ["source=main.c", "source=helper.c"];
  for (let i = 0; i < 5; i += 1) {
    await writeIncludeDir(dir, `inc${i}`);
    lines.push(`include=inc${i}`);
  }
  await writeManifest(dir, lines);
  const parsed = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsed.reason, "manifest_include_count_out_of_range");
});

test("parser rejects duplicate include", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-include-dup-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeIncludeDir(dir, "include");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "include=include", "include=include"]);
  const parsed = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsed.reason, "manifest_duplicate_include");
});

test("parser rejects include entries that are not directories", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-include-not-dir-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeHeader(dir, "include/values.h");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "include=include/values.h"]);
  const parsed = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsed.reason, "manifest_include_not_directory");
});

test("parser rejects include symlink escaping project root", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-include-escape-"));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-external-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await fs.symlink(external, path.join(dir, "include_outside"), "dir");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "include=include_outside"]);
  const parsed = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsed.reason, "manifest_include_outside_project");
});

test("parser rejects missing and unsafe include entries", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-include-missing-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "include=include"]);
  const missing = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(missing.reason, "manifest_include_missing");

  await writeManifest(dir, ["source=main.c", "source=helper.c", "include=../include"]);
  const unsafe = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(unsafe.reason, "manifest_unsafe_include");
});

test("parser rejects duplicate source/header and unsupported extensions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-dupe-ext-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeHeader(dir, "project.h");
  await writeManifest(dir, ["source=main.c", "source=main.c"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_duplicate_source");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "header=project.h", "header=project.h"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_duplicate_header");
  await writeManifest(dir, ["source=main.c", "source=helper.txt"]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_source_not_supported_file"
  );
  await writeManifest(dir, ["source=main.c", "source=helper.c", "header=project.hpp"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_header_not_h_file");
});

test("parser rejects unknown keys and malformed lines", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-malformed-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "flags=-O2", "source=helper.c"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_unknown_key");
  await writeManifest(dir, ["source=main.c", "source helper.c"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_malformed_line");
});

test("parser validates define name/value grammar and duplicate behavior", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-define-grammar-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  const accepts = [
    "define=DEBUG",
    "define=OS4TB_FEATURE_ENABLED",
    "define=FEATURE2",
    "define=_VERSION",
    "define=LEVEL=3",
    "define=MASK=0x20",
    "define=VERSION=1.2",
    "define=FEATURE_MODE=fast",
    "define=OFFSET=-4"
  ];
  await writeManifest(dir, ["source=main.c", "source=helper.c", ...accepts]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "ok");

  const rejects = [
    "define=2DEBUG",
    "define=DEBUG-NOW",
    "define=DEBUG NOW",
    "define=DEBUG()",
    "define=DEBUG(x)",
    "define=DEBUG;",
    "define=DEBUG|",
    "define=DEBUG$",
    "define=DEBUG`",
    "define=NAME=\"hello world\"",
    "define=NAME='foo'",
    "define=NAME=(1+2)",
    "define=NAME=foo bar",
    "define=NAME=foo;bar",
    "define=NAME=$(foo)",
    "define=NAME=`foo`",
    "define=NAME=foo&bar",
    "define=NAME=foo|bar",
    "define=NAME=foo/bar",
    "define=NAME=foo\\bar",
    "define=NAME=",
    "define=-DDEBUG",
    "define=DEBUG -O3",
    "define=DEBUG(x)"
  ];
  for (const reject of rejects) {
    await writeManifest(dir, ["source=main.c", "source=helper.c", reject]);
    assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_unsafe_define");
  }

  await writeManifest(dir, ["source=main.c", "source=helper.c", "define=DEBUG", "define=DEBUG=1"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_duplicate_define");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "define=LEVEL=1", "define=LEVEL=2"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_duplicate_define");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "define=DEBUG", "define=debug"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "ok");
});

test("parser enforces define count bounds", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-define-count-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  const maxDefines = Array.from({ length: OS4TB_GCC_PROJECT_MAX_DEFINES }, (_value, idx) => `define=MAX_${idx}=1`);
  await writeManifest(dir, ["source=main.c", "source=helper.c", ...maxDefines]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "ok");

  const tooMany = Array.from(
    { length: OS4TB_GCC_PROJECT_MAX_DEFINES + 1 },
    (_value, idx) => `define=TOO_${idx}=1`
  );
  await writeManifest(dir, ["source=main.c", "source=helper.c", ...tooMany]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_define_count_out_of_range"
  );
});

test("parser accepts maximum-sized legal define names and values", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-define-maxlen-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  const name = `A${"B".repeat(OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH - 1)}`;
  const value = `v${"9".repeat(OS4TB_GCC_PROJECT_DEFINE_VALUE_MAX_LENGTH - 1)}`;
  await writeManifest(dir, ["source=main.c", "source=helper.c", `define=${name}=${value}`]);
  const parsed = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsed.reason, "ok");
  assert.deepEqual(parsed.manifest?.defineEntries, [`${name}=${value}`]);
});

test("parser validates library grammar, reserved names, and duplicate behavior", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-library-grammar-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  const accepts = ["library=m", "library=auto", "library=utility", "library=debug", "library=foo_bar", "library=foo-bar", "library=stdc++"];
  await writeManifest(dir, ["source=main.c", "source=helper.c", ...accepts]);
  const ok = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(ok.reason, "ok");
  assert.deepEqual(ok.manifest?.libraries, ["m", "auto", "utility", "debug", "foo_bar", "foo-bar", "stdc++"]);

  const rejects = [
    "library=-lm",
    "library=libm.a",
    "library=../libfoo.a",
    "library=foo/bar",
    "library=Work:foo",
    "library=foo bar",
    "library=foo;bar",
    "library=foo|bar",
    "library=foo&bar",
    "library=foo`bar`",
    "library=foo$(bar)",
    "library=foo\\bar"
  ];
  for (const reject of rejects) {
    await writeManifest(dir, ["source=main.c", "source=helper.c", reject]);
    assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_unsafe_library");
  }

  await writeManifest(dir, ["source=main.c", "source=helper.c", "library=m", "library=m"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_duplicate_library");

  await writeManifest(dir, ["source=main.c", "source=helper.c", "library=c"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_reserved_library");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "library=gcc"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_reserved_library");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "library=gcc_eh"]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "manifest_reserved_library");
});

test("parser enforces library count bounds and preserves order", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-library-count-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");

  const maxLibraries = Array.from({ length: OS4TB_GCC_PROJECT_MAX_LIBRARIES }, (_value, idx) => `library=lib${idx}`);
  await writeManifest(dir, ["source=main.c", "source=helper.c", ...maxLibraries]);
  assert.equal((await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason, "ok");

  const tooMany = Array.from(
    { length: OS4TB_GCC_PROJECT_MAX_LIBRARIES + 1 },
    (_value, idx) => `library=toolong${idx}`
  );
  await writeManifest(dir, ["source=main.c", "source=helper.c", ...tooMany]);
  assert.equal(
    (await parseProjectManifestForActiveFile(path.join(dir, "main.c"))).reason,
    "manifest_library_count_out_of_range"
  );

  await writeManifest(dir, ["source=main.c", "source=helper.c", "library=alpha", "library=beta", "library=gamma"]);
  const parsed = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsed.reason, "ok");
  assert.deepEqual(parsed.manifest?.libraries, ["alpha", "beta", "gamma"]);
});

test("parser accepts maximum-sized legal library names", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-library-maxlen-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  const libraryName = `L${"b".repeat(OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH - 1)}`;
  await writeManifest(dir, ["source=main.c", "source=helper.c", `library=${libraryName}`]);
  const parsed = await parseProjectManifestForActiveFile(path.join(dir, "main.c"));
  assert.equal(parsed.reason, "ok");
  assert.deepEqual(parsed.manifest?.libraries, [libraryName]);
});

test("locates nearest project manifest for active file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-locate-"));
  const nested = path.join(dir, "src", "nested");
  await fs.mkdir(nested, { recursive: true });
  await writeManifest(dir, ["source=main.c", "source=helper.c"]);
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeSource(dir, "src/nested/file.c");

  const located = await locateProjectManifestForActiveFile(path.join(nested, "file.c"));
  assert.equal(located?.projectDirectory, dir);
  assert.equal(located?.manifestPath, path.join(dir, PROJECT_MANIFEST_FILENAME));
});

test("project toolchain preference reads current setting and supports automatic mode persistence", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-toolchain-pref-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=gcc-11.5.0"]);
  const activePath = path.join(dir, "main.c");

  const before = await readProjectToolchainPreferenceForActiveFile(activePath);
  assert.equal(before.reason, "ok");
  assert.equal(before.toolchainId, "gcc-11.5.0");

  const clearResult = await setProjectToolchainPreferenceForActiveFile(activePath);
  assert.equal(clearResult.reason, "ok");
  const afterClear = await readProjectToolchainPreferenceForActiveFile(activePath);
  assert.equal(afterClear.reason, "ok");
  assert.equal(afterClear.toolchainId, undefined);

  const setResult = await setProjectToolchainPreferenceForActiveFile(activePath, "gcc-8.4.0");
  assert.equal(setResult.reason, "ok");
  const afterSet = await readProjectToolchainPreferenceForActiveFile(activePath);
  assert.equal(afterSet.reason, "ok");
  assert.equal(afterSet.toolchainId, "gcc-8.4.0");

  const manifestText = await fs.readFile(path.join(dir, PROJECT_MANIFEST_FILENAME), "utf8");
  assert.equal((manifestText.match(/^toolchain=/gm) ?? []).length, 1);
  assert.match(manifestText, /^toolchain=gcc-8.4.0$/m);
});

test("project toolchain preference rejects malformed toolchain values", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-toolchain-reject-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c"]);

  const result = await setProjectToolchainPreferenceForActiveFile(path.join(dir, "main.c"), "gcc-9.9");
  assert.equal(result.reason, "toolchain_id_invalid");
});

test("project toolchain preference rejects duplicate toolchain keys deterministically", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-toolchain-dup-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  await writeManifest(dir, ["source=main.c", "source=helper.c", "toolchain=gcc-11.5.0", "toolchain=gcc-8.4.0"]);
  const activePath = path.join(dir, "main.c");

  const readResult = await readProjectToolchainPreferenceForActiveFile(activePath);
  assert.equal(readResult.reason, "manifest_duplicate_toolchain");

  const setResult = await setProjectToolchainPreferenceForActiveFile(activePath, "gcc-6.4.0");
  assert.equal(setResult.reason, "manifest_duplicate_toolchain");
});

test("toolchain setter preserves unrelated settings and comments", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-toolchain-preserve-"));
  await writeSource(dir, "main.c");
  await writeSource(dir, "helper.c");
  const manifestPath = path.join(dir, PROJECT_MANIFEST_FILENAME);
  const originalText = [
    "# keep this comment",
    "source=main.c",
    "source=helper.c",
    "define=FEATURE=1",
    "library=m",
    "c_standard=c99",
    "warning_level=default",
    "optimization=none",
    "debug_symbols=no",
    "toolchain=gcc-11.5.0",
    "unknown_future_key=value",
    ""
  ].join("\n");
  await fs.writeFile(manifestPath, originalText, "utf8");

  const setResult = await setProjectToolchainPreferenceForActiveFile(path.join(dir, "main.c"), "gcc-8.4.0");
  assert.equal(setResult.reason, "ok");

  const updatedText = await fs.readFile(manifestPath, "utf8");
  assert.match(updatedText, /^# keep this comment$/m);
  assert.match(updatedText, /^define=FEATURE=1$/m);
  assert.match(updatedText, /^unknown_future_key=value$/m);
  assert.match(updatedText, /^toolchain=gcc-8.4.0$/m);
  assert.equal((updatedText.match(/^toolchain=/gm) ?? []).length, 1);
});

test("atomic manifest write failure preserves existing manifest content", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-proj-toolchain-atomic-"));
  const manifestPath = path.join(dir, PROJECT_MANIFEST_FILENAME);
  await fs.writeFile(manifestPath, "source=main.c\nsource=helper.c\ntoolchain=gcc-11.5.0\n", "utf8");
  const initialText = await fs.readFile(manifestPath, "utf8");

  const writeOps = {
    async writeFile(filePath: string, data: string, encoding: BufferEncoding): Promise<void> {
      await fs.writeFile(filePath, data, encoding);
    },
    async rename(_fromPath: string, _toPath: string): Promise<void> {
      throw new Error("rename_failed");
    },
    async unlink(filePath: string): Promise<void> {
      await fs.unlink(filePath);
    }
  };

  let thrown = false;
  try {
    await writeProjectManifestAtomically(manifestPath, "source=main.c\nsource=helper.c\n", writeOps);
  } catch {
    thrown = true;
  }
  assert.equal(thrown, true);
  const afterText = await fs.readFile(manifestPath, "utf8");
  assert.equal(afterText, initialText);
});
