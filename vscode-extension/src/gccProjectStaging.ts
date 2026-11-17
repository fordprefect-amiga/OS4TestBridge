import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  buildGuestProjectManifestText,
  isValidProjectRelativePath,
  ProjectBuildProfile,
  ProjectResolvedToolchainProfile,
  ProjectSourceKind
} from "./gccProjectBuildRun";
import { buildGuestAssemblerManifestText, ResolvedProjectAssembler } from "./assemblerProjectBuildRun";

export type ProjectStagingFailureReason =
  | "project_root_missing"
  | "project_root_unreadable"
  | "staging_root_missing"
  | "staging_root_unreadable"
  | "project_directory_staging_failed"
  | "source_path_count_mismatch"
  | "header_path_count_mismatch"
  | "include_path_count_mismatch"
  | "source_staged_path_invalid"
  | "header_staged_path_invalid"
  | "include_staged_path_invalid"
  | "source_outside_project_root"
  | "header_outside_project_root"
  | "destination_path_outside_staging_root"
  | "source_staging_failed"
  | "header_staging_failed"
  | "include_staged_path_not_directory"
  | "project_manifest_staging_failed";

export class ProjectStagingError extends Error {
  constructor(
    public readonly reason: ProjectStagingFailureReason,
    public readonly detail?: string
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "ProjectStagingError";
  }
}

export type StagingManifestMode =
  | {
    kind: "gcc";
    sourceKinds: ProjectSourceKind[];
    defineEntries: string[];
    libraryNames: string[];
    buildProfile: ProjectBuildProfile;
    toolchain?: ProjectResolvedToolchainProfile;
    assembler?: ResolvedProjectAssembler;
  }
  | {
    kind: "assembler";
    assembler: ResolvedProjectAssembler;
    defineEntries: string[];
  };

export interface StageProjectInputs {
  projectRoot: string;
  stagingRoot: string;
  stagedProjectDirectoryBasename: string;
  sourceFilePaths: string[];
  headerFilePaths: string[];
  includeDirectoryPaths: string[];
  sourceStagedRelativePaths: string[];
  headerStagedRelativePaths: string[];
  includeStagedRelativePaths: string[];
  manifestBasename: string;
  manifestMode: StagingManifestMode;
}

export interface StageProjectResult {
  stagedProjectDirectoryPath: string;
  projectManifestPath: string;
  stagedSourcePaths: string[];
  stagedHeaderPaths: string[];
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveExistingDirectoryRoot(
  rootPath: string,
  missingReason: ProjectStagingFailureReason,
  unreadableReason: ProjectStagingFailureReason
): Promise<string> {
  try {
    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) {
      throw new ProjectStagingError(unreadableReason, `${rootPath} is not a directory`);
    }
  } catch (err) {
    const errno = err as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") {
      throw new ProjectStagingError(missingReason, rootPath);
    }
    if (err instanceof ProjectStagingError) {
      throw err;
    }
    throw new ProjectStagingError(unreadableReason, (err as Error).message);
  }

  try {
    return await fs.realpath(rootPath);
  } catch (err) {
    throw new ProjectStagingError(unreadableReason, (err as Error).message);
  }
}

function resolveDestinationPath(
  stagedProjectDirectoryPath: string,
  relativePath: string,
  reason: ProjectStagingFailureReason
): string {
  const destinationPath = path.resolve(stagedProjectDirectoryPath, ...relativePath.split("/"));
  if (!isInside(stagedProjectDirectoryPath, destinationPath)) {
    throw new ProjectStagingError(reason, relativePath);
  }
  return destinationPath;
}

async function ensurePathInsideProjectRoot(
  projectRootReal: string,
  hostPath: string,
  reason: ProjectStagingFailureReason
): Promise<string> {
  let sourceRealPath = "";
  try {
    sourceRealPath = await fs.realpath(hostPath);
  } catch (err) {
    throw new ProjectStagingError(reason, (err as Error).message);
  }
  if (!isInside(projectRootReal, sourceRealPath)) {
    throw new ProjectStagingError(reason, hostPath);
  }
  return sourceRealPath;
}

export async function stageProjectBuildRunInputs(params: StageProjectInputs): Promise<StageProjectResult> {
  const projectRootReal = await resolveExistingDirectoryRoot(
    params.projectRoot,
    "project_root_missing",
    "project_root_unreadable"
  );
  const stagingRootReal = await resolveExistingDirectoryRoot(
    params.stagingRoot,
    "staging_root_missing",
    "staging_root_unreadable"
  );

  if (params.sourceFilePaths.length !== params.sourceStagedRelativePaths.length) {
    throw new ProjectStagingError("source_path_count_mismatch");
  }
  if (params.headerFilePaths.length !== params.headerStagedRelativePaths.length) {
    throw new ProjectStagingError("header_path_count_mismatch");
  }
  if (params.includeDirectoryPaths.length !== params.includeStagedRelativePaths.length) {
    throw new ProjectStagingError("include_path_count_mismatch");
  }
  if (params.manifestMode.kind === "gcc" && params.manifestMode.sourceKinds.length !== params.sourceFilePaths.length) {
    throw new ProjectStagingError("source_path_count_mismatch");
  }

  const stagedProjectDirectoryPath = path.resolve(stagingRootReal, params.stagedProjectDirectoryBasename);
  if (!isInside(stagingRootReal, stagedProjectDirectoryPath)) {
    throw new ProjectStagingError("destination_path_outside_staging_root", params.stagedProjectDirectoryBasename);
  }
  try {
    await fs.mkdir(stagedProjectDirectoryPath, { recursive: false });
  } catch (err) {
    throw new ProjectStagingError("project_directory_staging_failed", (err as Error).message);
  }

  const stagedSourcePaths: string[] = [];
  const stagedHeaderPaths: string[] = [];

  for (let i = 0; i < params.sourceFilePaths.length; i += 1) {
    const stagedRelativePath = params.sourceStagedRelativePaths[i];
    const sourceKind = params.manifestMode.kind === "gcc" ? params.manifestMode.sourceKinds[i] : "asm";
    const expectedExtension = sourceKind === "asm" ? ".s" : ".c";
    if (!isValidProjectRelativePath(stagedRelativePath, expectedExtension)) {
      throw new ProjectStagingError("source_staged_path_invalid", stagedRelativePath);
    }
    await ensurePathInsideProjectRoot(projectRootReal, params.sourceFilePaths[i], "source_outside_project_root");
    const stagedPath = resolveDestinationPath(
      stagedProjectDirectoryPath,
      stagedRelativePath,
      "destination_path_outside_staging_root"
    );
    await fs.mkdir(path.dirname(stagedPath), { recursive: true });
    try {
      await fs.copyFile(params.sourceFilePaths[i], stagedPath, fsSync.constants.COPYFILE_EXCL);
    } catch (err) {
      throw new ProjectStagingError("source_staging_failed", (err as Error).message);
    }
    stagedSourcePaths.push(stagedRelativePath);
  }

  for (let i = 0; i < params.headerFilePaths.length; i += 1) {
    const stagedRelativePath = params.headerStagedRelativePaths[i];
    if (!isValidProjectRelativePath(stagedRelativePath, ".h")) {
      throw new ProjectStagingError("header_staged_path_invalid", stagedRelativePath);
    }
    await ensurePathInsideProjectRoot(projectRootReal, params.headerFilePaths[i], "header_outside_project_root");
    const stagedPath = resolveDestinationPath(
      stagedProjectDirectoryPath,
      stagedRelativePath,
      "destination_path_outside_staging_root"
    );
    await fs.mkdir(path.dirname(stagedPath), { recursive: true });
    try {
      await fs.copyFile(params.headerFilePaths[i], stagedPath, fsSync.constants.COPYFILE_EXCL);
    } catch (err) {
      throw new ProjectStagingError("header_staging_failed", (err as Error).message);
    }
    stagedHeaderPaths.push(stagedRelativePath);
  }

  for (let i = 0; i < params.includeStagedRelativePaths.length; i += 1) {
    const stagedRelativePath = params.includeStagedRelativePaths[i];
    if (!isValidProjectRelativePath(stagedRelativePath)) {
      throw new ProjectStagingError("include_staged_path_invalid", stagedRelativePath);
    }
    const stagedDirectoryPath = resolveDestinationPath(
      stagedProjectDirectoryPath,
      stagedRelativePath,
      "destination_path_outside_staging_root"
    );
    try {
      const includeStat = await fs.stat(stagedDirectoryPath);
      if (!includeStat.isDirectory()) {
        throw new ProjectStagingError("include_staged_path_not_directory", stagedRelativePath);
      }
    } catch (err) {
      if (err instanceof ProjectStagingError) {
        throw err;
      }
      await fs.mkdir(stagedDirectoryPath, { recursive: true });
    }
  }

  const projectManifestPath = resolveDestinationPath(
    stagedProjectDirectoryPath,
    params.manifestBasename,
    "destination_path_outside_staging_root"
  );
  const projectManifestText = params.manifestMode.kind === "assembler"
    ? buildGuestAssemblerManifestText({
      assembler: params.manifestMode.assembler,
      sources: stagedSourcePaths,
      includes: params.includeStagedRelativePaths,
      defines: params.manifestMode.defineEntries,
      runProgram: "yes"
    })
    : buildGuestProjectManifestText(
      stagedSourcePaths,
      params.manifestMode.sourceKinds,
      stagedHeaderPaths,
      params.includeStagedRelativePaths,
      params.manifestMode.defineEntries,
      params.manifestMode.libraryNames,
      params.manifestMode.buildProfile,
      params.manifestMode.toolchain,
      params.manifestMode.assembler
    );
  try {
    await fs.writeFile(projectManifestPath, projectManifestText, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    throw new ProjectStagingError("project_manifest_staging_failed", (err as Error).message);
  }

  return {
    stagedProjectDirectoryPath,
    projectManifestPath,
    stagedSourcePaths,
    stagedHeaderPaths
  };
}
