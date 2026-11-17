import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stageProjectBuildRunInputs, ProjectStagingError } from "../src/gccProjectStaging";
import { PROJECT_GUEST_MANIFEST_FILENAME } from "../src/gccProjectBuildRun";

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function createTempRoots(prefix: string): Promise<{ root: string; projectRoot: string; stagingRoot: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const projectRoot = path.join(root, "project");
  const stagingRoot = path.join(root, "staging");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(stagingRoot, { recursive: true });
  return { root, projectRoot, stagingRoot };
}

async function writeFileRelative(root: string, relativePath: string, text: string): Promise<string> {
  const filePath = path.join(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
  return filePath;
}

test("stages valid two-source project and preserves manifest order", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-two-");
  const main = await writeFileRelative(projectRoot, "src/main.c", "int main(void){return 0;}\n");
  const helper = await writeFileRelative(projectRoot, "src/helper.c", "int helper(void){return 1;}\n");

  const result = await stageProjectBuildRunInputs({
    projectRoot,
    stagingRoot,
    stagedProjectDirectoryBasename: "project_req_1",
    sourceFilePaths: [main, helper],
    headerFilePaths: [],
    includeDirectoryPaths: [],
    sourceStagedRelativePaths: ["src/main.c", "src/helper.c"],
    headerStagedRelativePaths: [],
    includeStagedRelativePaths: [],
    manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
    manifestMode: {
      kind: "gcc",
      sourceKinds: ["c", "c"],
      defineEntries: ["FEATURE_X=1"],
      libraryNames: ["auto"],
      buildProfile: {
        cStandard: "c11",
        warningLevel: "strict",
        optimization: "none",
        debugSymbols: "no"
      }
    }
  });

  assert.equal(result.stagedSourcePaths.length, 2);
  const manifest = await fs.readFile(result.projectManifestPath, "utf8");
  assert.match(manifest, /^SOURCE_COUNT=2$/m);
  assert.match(manifest, /^SOURCE_0=src\/main\.c$/m);
  assert.match(manifest, /^SOURCE_1=src\/helper\.c$/m);
  assert.match(manifest, /^DEFINE_0=FEATURE_X=1$/m);
});

test("stages multi-directory project with byte-identical source/header copies", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-multi-");
  const srcA = await writeFileRelative(projectRoot, "src/app/main.c", "int main(void){return 3;}\n");
  const srcB = await writeFileRelative(projectRoot, "src/lib/math.c", "int add(int a,int b){return a+b;}\n");
  const hdr = await writeFileRelative(projectRoot, "include/lib/math.h", "#define X 42\n");

  const result = await stageProjectBuildRunInputs({
    projectRoot,
    stagingRoot,
    stagedProjectDirectoryBasename: "project_req_2",
    sourceFilePaths: [srcA, srcB],
    headerFilePaths: [hdr],
    includeDirectoryPaths: [path.join(projectRoot, "include"), path.join(projectRoot, "src/lib")],
    sourceStagedRelativePaths: ["src/app/main.c", "src/lib/math.c"],
    headerStagedRelativePaths: ["include/lib/math.h"],
    includeStagedRelativePaths: ["include", "src/lib"],
    manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
    manifestMode: {
      kind: "gcc",
      sourceKinds: ["c", "c"],
      defineEntries: ["FEATURE_A=1", "FEATURE_B=2"],
      libraryNames: ["m", "auto"],
      buildProfile: {
        cStandard: "c11",
        warningLevel: "strict",
        optimization: "none",
        debugSymbols: "no"
      }
    }
  });

  const stagedMain = await fs.readFile(path.join(result.stagedProjectDirectoryPath, "src/app/main.c"));
  const stagedMath = await fs.readFile(path.join(result.stagedProjectDirectoryPath, "src/lib/math.c"));
  const stagedHdr = await fs.readFile(path.join(result.stagedProjectDirectoryPath, "include/lib/math.h"));

  assert.equal(sha256(stagedMain), sha256(await fs.readFile(srcA)));
  assert.equal(sha256(stagedMath), sha256(await fs.readFile(srcB)));
  assert.equal(sha256(stagedHdr), sha256(await fs.readFile(hdr)));

  const manifest = await fs.readFile(result.projectManifestPath, "utf8");
  assert.match(manifest, /^SOURCE_0=src\/app\/main\.c$/m);
  assert.match(manifest, /^SOURCE_1=src\/lib\/math\.c$/m);
  assert.match(manifest, /^HEADER_0=include\/lib\/math\.h$/m);
  assert.match(manifest, /^INCLUDE_0=include$/m);
  assert.match(manifest, /^INCLUDE_1=src\/lib$/m);
  assert.match(manifest, /^DEFINE_COUNT=2$/m);
  assert.match(manifest, /^LIBRARY_COUNT=2$/m);
});

test("fails on missing source", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-missing-source-");
  const source = path.join(projectRoot, "src/missing.c");
  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot,
      stagingRoot,
      stagedProjectDirectoryBasename: "project_req_3",
      sourceFilePaths: [source],
      headerFilePaths: [],
      includeDirectoryPaths: [],
      sourceStagedRelativePaths: ["src/missing.c"],
      headerStagedRelativePaths: [],
      includeStagedRelativePaths: [],
      manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "source_outside_project_root"
  );
});

test("fails on missing header", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-missing-header-");
  const src = await writeFileRelative(projectRoot, "src/main.c", "int main(void){return 0;}\n");
  const missingHeader = path.join(projectRoot, "include/missing.h");
  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot,
      stagingRoot,
      stagedProjectDirectoryBasename: "project_req_4",
      sourceFilePaths: [src],
      headerFilePaths: [missingHeader],
      includeDirectoryPaths: [],
      sourceStagedRelativePaths: ["src/main.c"],
      headerStagedRelativePaths: ["include/missing.h"],
      includeStagedRelativePaths: [],
      manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "header_outside_project_root"
  );
});

test("rejects traversal and malformed staged relative paths", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-invalid-rel-");
  const src = await writeFileRelative(projectRoot, "src/main.c", "int main(void){return 0;}\n");
  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot,
      stagingRoot,
      stagedProjectDirectoryBasename: "project_req_5",
      sourceFilePaths: [src],
      headerFilePaths: [],
      includeDirectoryPaths: [],
      sourceStagedRelativePaths: ["../escape.c"],
      headerStagedRelativePaths: [],
      includeStagedRelativePaths: [],
      manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "source_staged_path_invalid"
  );
});

test("rejects source outside explicit project root", async () => {
  const { root, projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-outside-root-");
  const outsideSource = await writeFileRelative(root, "outside/main.c", "int main(void){return 0;}\n");
  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot,
      stagingRoot,
      stagedProjectDirectoryBasename: "project_req_6",
      sourceFilePaths: [outsideSource],
      headerFilePaths: [],
      includeDirectoryPaths: [],
      sourceStagedRelativePaths: ["src/main.c"],
      headerStagedRelativePaths: [],
      includeStagedRelativePaths: [],
      manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "source_outside_project_root"
  );
});

test("rejects staging destination escape", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-escape-");
  const src = await writeFileRelative(projectRoot, "src/main.c", "int main(void){return 0;}\n");
  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot,
      stagingRoot,
      stagedProjectDirectoryBasename: "../escape",
      sourceFilePaths: [src],
      headerFilePaths: [],
      includeDirectoryPaths: [],
      sourceStagedRelativePaths: ["src/main.c"],
      headerStagedRelativePaths: [],
      includeStagedRelativePaths: [],
      manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "destination_path_outside_staging_root"
  );
});

test("rejects pre-existing staged project directory conflict safely", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-copy-fail-");
  const src = await writeFileRelative(projectRoot, "src/main.c", "int main(void){return 0;}\n");
  const stagedDir = path.join(stagingRoot, "project_req_7");
  await fs.mkdir(stagedDir, { recursive: true });

  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot,
      stagingRoot,
      stagedProjectDirectoryBasename: "project_req_7",
      sourceFilePaths: [src],
      headerFilePaths: [],
      includeDirectoryPaths: [],
      sourceStagedRelativePaths: ["src/main.c"],
      headerStagedRelativePaths: [],
      includeStagedRelativePaths: [],
      manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "project_directory_staging_failed"
  );
});

test("propagates source copy failure and does not return success", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-copy-fail-2-");
  const srcA = await writeFileRelative(projectRoot, "src/a.c", "int a(void){return 1;}\n");
  const srcB = await writeFileRelative(projectRoot, "src/b.c", "int b(void){return 2;}\n");

  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot,
      stagingRoot,
      stagedProjectDirectoryBasename: "project_req_7b",
      sourceFilePaths: [srcA, srcB],
      headerFilePaths: [],
      includeDirectoryPaths: [],
      sourceStagedRelativePaths: ["src/collide.c", "src/collide.c"],
      headerStagedRelativePaths: [],
      includeStagedRelativePaths: [],
      manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c", "c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "source_staging_failed"
  );
});

test("fails when include staged path resolves to non-directory", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-include-type-");
  const src = await writeFileRelative(projectRoot, "src/main.c", "int main(void){return 0;}\n");

  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot,
      stagingRoot,
      stagedProjectDirectoryBasename: "project_req_8",
      sourceFilePaths: [src],
      headerFilePaths: [],
      includeDirectoryPaths: [path.join(projectRoot, "src/main.c")],
      sourceStagedRelativePaths: ["src/main.c"],
      headerStagedRelativePaths: [],
      includeStagedRelativePaths: ["src/main.c"],
      manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "include_staged_path_not_directory"
  );
});

test("production workflow delegates to shared staging helper", async () => {
  const extensionSource = await fs.readFile(path.resolve(__dirname, "..", "..", "src", "extension.ts"), "utf8");
  const start = extensionSource.indexOf("async function runProjectBuildAndRunCommand(");
  const boundary = extensionSource.indexOf("const result = await client.runRequest(", start);
  const slice = extensionSource.slice(start, boundary);
  assert.match(slice, /stageProjectBuildRunInputs\(/);
  assert.doesNotMatch(slice, /await fs\.copyFile\(params\.sourceFilePaths\[i\]/);
  assert.doesNotMatch(slice, /buildGuestProjectManifestText\(/);
});

test("stages assembler-mode project and emits assembler manifest contract", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-asm-");
  const srcA = await writeFileRelative(projectRoot, "asm/start.s", ".globl _start\n_start:\n nop\n");
  const srcB = await writeFileRelative(projectRoot, "asm/sub/irq.s", ".globl irq\nirq:\n nop\n");
  await fs.mkdir(path.join(projectRoot, "include"), { recursive: true });

  const result = await stageProjectBuildRunInputs({
    projectRoot,
    stagingRoot,
    stagedProjectDirectoryBasename: "asm_project_req_1",
    sourceFilePaths: [srcA, srcB],
    headerFilePaths: [],
    includeDirectoryPaths: [path.join(projectRoot, "include")],
    sourceStagedRelativePaths: ["asm/start.s", "asm/sub/irq.s"],
    headerStagedRelativePaths: [],
    includeStagedRelativePaths: ["include"],
    manifestBasename: "assembler_project_manifest.txt",
    manifestMode: {
      kind: "assembler",
      assembler: {
        id: "gnu-as-os4",
        family: "gnu_as",
        displayName: "GNU as (OS4)",
        availability: "present",
        assemblerPath: "Work:SDK/gcc/ppc-amigaos/bin/as",
        version: "2.40",
        objectFormat: "elf32-powerpc",
        linkerModel: "vlink",
        linkerPath: "Work:SDK/vbcc/bin/vlink",
        defineModel: "--defsym"
      },
      defineEntries: ["ASM_FEATURE=1"]
    }
  });

  assert.equal(result.stagedSourcePaths[0], "asm/start.s");
  assert.equal(result.stagedSourcePaths[1], "asm/sub/irq.s");
  assert.equal(
    sha256(await fs.readFile(path.join(result.stagedProjectDirectoryPath, "asm/start.s"))),
    sha256(await fs.readFile(srcA))
  );
  assert.equal(
    sha256(await fs.readFile(path.join(result.stagedProjectDirectoryPath, "asm/sub/irq.s"))),
    sha256(await fs.readFile(srcB))
  );

  const manifest = await fs.readFile(result.projectManifestPath, "utf8");
  assert.match(manifest, /^ASSEMBLER_ID=gnu-as-os4$/m);
  assert.match(manifest, /^ASSEMBLER_FAMILY=gnu_as$/m);
  assert.match(manifest, /^SOURCE_COUNT=2$/m);
  assert.match(manifest, /^SOURCE_0=asm\/start\.s$/m);
  assert.match(manifest, /^SOURCE_1=asm\/sub\/irq\.s$/m);
  assert.match(manifest, /^INCLUDE_COUNT=1$/m);
  assert.match(manifest, /^DEFINE_COUNT=1$/m);
  assert.match(manifest, /^RUN_PROGRAM=yes$/m);
  assert.doesNotMatch(manifest, /^C_STANDARD=/m);
  assert.doesNotMatch(manifest, /^WARNING_LEVEL=/m);
});

test("fails when staging root is missing", async () => {
  const { projectRoot, root } = await createTempRoots("os4tb-stage-missing-staging-root-");
  const src = await writeFileRelative(projectRoot, "src/main.c", "int main(void){return 0;}\n");
  const missingStagingRoot = path.join(root, "staging-missing");
  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot,
      stagingRoot: missingStagingRoot,
      stagedProjectDirectoryBasename: "project_req_9",
      sourceFilePaths: [src],
      headerFilePaths: [],
      includeDirectoryPaths: [],
      sourceStagedRelativePaths: ["src/main.c"],
      headerStagedRelativePaths: [],
      includeStagedRelativePaths: [],
      manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "staging_root_missing"
  );
});

test("fails when project root is missing", async () => {
  const { stagingRoot, root } = await createTempRoots("os4tb-stage-missing-project-root-");
  const missingProjectRoot = path.join(root, "project-missing");
  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot: missingProjectRoot,
      stagingRoot,
      stagedProjectDirectoryBasename: "project_req_10",
      sourceFilePaths: [path.join(missingProjectRoot, "src/main.c")],
      headerFilePaths: [],
      includeDirectoryPaths: [],
      sourceStagedRelativePaths: ["src/main.c"],
      headerStagedRelativePaths: [],
      includeStagedRelativePaths: [],
      manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "project_root_missing"
  );
});

test("fails on include path count mismatch", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-include-count-");
  const src = await writeFileRelative(projectRoot, "src/main.c", "int main(void){return 0;}\n");
  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot,
      stagingRoot,
      stagedProjectDirectoryBasename: "project_req_11",
      sourceFilePaths: [src],
      headerFilePaths: [],
      includeDirectoryPaths: [],
      sourceStagedRelativePaths: ["src/main.c"],
      headerStagedRelativePaths: [],
      includeStagedRelativePaths: ["include"],
      manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "include_path_count_mismatch"
  );
});

test("fails on malformed header staged relative path", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-bad-header-rel-");
  const src = await writeFileRelative(projectRoot, "src/main.c", "int main(void){return 0;}\n");
  const hdr = await writeFileRelative(projectRoot, "include/main.h", "#define Z 1\n");
  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot,
      stagingRoot,
      stagedProjectDirectoryBasename: "project_req_12",
      sourceFilePaths: [src],
      headerFilePaths: [hdr],
      includeDirectoryPaths: [],
      sourceStagedRelativePaths: ["src/main.c"],
      headerStagedRelativePaths: ["../escape.h"],
      includeStagedRelativePaths: [],
      manifestBasename: PROJECT_GUEST_MANIFEST_FILENAME,
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "header_staged_path_invalid"
  );
});

test("fails when manifest write cannot create nested path", async () => {
  const { projectRoot, stagingRoot } = await createTempRoots("os4tb-stage-manifest-write-");
  const src = await writeFileRelative(projectRoot, "src/main.c", "int main(void){return 0;}\n");
  await assert.rejects(
    stageProjectBuildRunInputs({
      projectRoot,
      stagingRoot,
      stagedProjectDirectoryBasename: "project_req_13",
      sourceFilePaths: [src],
      headerFilePaths: [],
      includeDirectoryPaths: [],
      sourceStagedRelativePaths: ["src/main.c"],
      headerStagedRelativePaths: [],
      includeStagedRelativePaths: [],
      manifestBasename: "nested/project_manifest.txt",
      manifestMode: {
        kind: "gcc",
        sourceKinds: ["c"],
        defineEntries: [],
        libraryNames: [],
        buildProfile: { cStandard: "c11", warningLevel: "strict", optimization: "none", debugSymbols: "no" }
      }
    }),
    (err: unknown) => err instanceof ProjectStagingError && err.reason === "project_manifest_staging_failed"
  );
});

test("production workflow maps staging errors explicitly and keeps generic fallback", async () => {
  const extensionSource = await fs.readFile(path.resolve(__dirname, "..", "..", "src", "extension.ts"), "utf8");
  const start = extensionSource.indexOf("if (err instanceof ProjectStagingError)");
  const end = extensionSource.indexOf("const sourceRemap", start);
  const slice = extensionSource.slice(start, end);
  for (const reason of [
    "source_path_count_mismatch",
    "header_path_count_mismatch",
    "include_path_count_mismatch",
    "source_staged_path_invalid",
    "header_staged_path_invalid",
    "include_staged_path_invalid",
    "include_staged_path_not_directory"
  ]) {
    assert.match(slice, new RegExp(`err.reason === \\\"${reason}\\\"`));
  }
  assert.match(slice, /reason=\$\{err\.reason\}, detail=\$\{err\.detail \?\? err\.message\}/);
  assert.match(slice, /reason=project_staging_failed, detail=/);
});

test("production assembler call path passes assembler manifest mode to shared helper", async () => {
  const extensionSource = await fs.readFile(path.resolve(__dirname, "..", "..", "src", "extension.ts"), "utf8");
  const start = extensionSource.indexOf("const stagingResult = await stageProjectBuildRunInputs(");
  const end = extensionSource.indexOf("stagedSourcePaths = stagingResult.stagedSourcePaths;", start);
  const slice = extensionSource.slice(start, end);
  assert.match(slice, /payloadKind === "assemblerProjectBuildRun"/);
  assert.match(slice, /kind: "assembler"/);
  assert.match(slice, /assembler: selectedAssembler!/);
  assert.match(slice, /defineEntries: params\.defineEntries/);
});
