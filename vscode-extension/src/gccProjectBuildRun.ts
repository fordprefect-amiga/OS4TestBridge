import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isSafeSourceBasename, isSupportedCompileSourcePath } from "./gccCompile";
import {
  isValidProjectAssemblerId,
  ProjectAssemblerId,
  ProjectAssemblerFamily,
  ProjectLinkerModel
} from "./assemblerProjectBuildRun";
import {
  ResolvedProjectToolchainProfile,
  ResolvedProjectVbccToolchain,
  isValidGccProjectToolchainId,
  isValidProjectToolchainId
} from "./toolchainDiscovery";

export const PROJECT_MANIFEST_FILENAME = ".os4tb-project";
export const PROJECT_GUEST_MANIFEST_FILENAME = "project_manifest.txt";
export const PROJECT_ASSEMBLER_GUEST_MANIFEST_FILENAME = "assembler_project_manifest.txt";
export const OS4TB_GCC_PROJECT_MIN_SOURCES = 2;
export const OS4TB_GCC_PROJECT_MAX_SOURCES = 64;
export const OS4TB_GCC_PROJECT_MIN_HEADERS = 0;
export const OS4TB_GCC_PROJECT_MAX_HEADERS = 8;
export const OS4TB_GCC_PROJECT_MIN_INCLUDES = 0;
export const OS4TB_GCC_PROJECT_MAX_INCLUDES = 4;
export const OS4TB_GCC_PROJECT_MIN_DEFINES = 0;
export const OS4TB_GCC_PROJECT_MAX_DEFINES = 16;
export const OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH = 64;
export const OS4TB_GCC_PROJECT_DEFINE_VALUE_MAX_LENGTH = 64;
export const OS4TB_GCC_PROJECT_MIN_LIBRARIES = 0;
export const OS4TB_GCC_PROJECT_MAX_LIBRARIES = 16;
export const OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH = 64;
export const OS4TB_GCC_PROJECT_DEFAULT_C_STANDARD = "c11";
export const OS4TB_GCC_PROJECT_DEFAULT_WARNING_LEVEL = "extra";
export const OS4TB_GCC_PROJECT_DEFAULT_OPTIMIZATION = "none";
export const OS4TB_GCC_PROJECT_DEFAULT_DEBUG_SYMBOLS = "no";
export const OS4TB_GCC_PROJECT_TOOLCHAIN_ID_MAX_LENGTH = 32;
export const OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH = 320;
export const OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS = 16;
export const OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_INTERNAL_INCLUDE_DIRS = 8;
export const OS4TB_GCC_PROJECT_RELATIVE_PATH_MAX_LENGTH = 160;
export const OS4TB_GCC_PROJECT_RELATIVE_PATH_MAX_SEGMENTS = 4;
export const OS4TB_GCC_PROJECT_SEGMENT_MAX_LENGTH = 64;

const SAFE_RELATIVE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const SAFE_DEFINE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_DEFINE_VALUE_PATTERN = /^[A-Za-z0-9_.+-]+$/;
const SAFE_LIBRARY_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_+-]*$/;
const RESERVED_LIBRARY_NAMES = new Set(["c", "gcc", "gcc_eh"]);

export type ProjectSourceResolveReason =
  | "ok"
  | "main_file_required"
  | "unsupported_extension"
  | "unsafe_basename"
  | "helper_missing"
  | "helper_not_file"
  | "helper_unsupported_extension"
  | "helper_unsafe_basename";

export interface ProjectSourceResolveResult {
  reason: ProjectSourceResolveReason;
  mainPath?: string;
  helperPath?: string;
}

export interface ParsedProjectManifest {
  manifestPath: string;
  projectDirectory: string;
  sources: string[];
  headers: string[];
  includes: string[];
  sourceRelativePaths: string[];
  sourceKinds: ProjectSourceKind[];
  headerRelativePaths: string[];
  includeRelativePaths: string[];
  defines: ProjectManifestDefine[];
  defineEntries: string[];
  libraries: string[];
  toolchainId?: string;
  assemblerId?: string;
  cStandard: ProjectCStandard;
  warningLevel: ProjectWarningLevel;
  optimization: ProjectOptimizationLevel;
  debugSymbols: ProjectDebugSymbols;
}

export type ProjectSourceKind = "c" | "asm";

export interface ProjectManifestDefine {
  name: string;
  value: string | null;
}

export type ProjectManifestParseReason =
  | "ok"
  | "manifest_missing"
  | "manifest_read_failed"
  | "manifest_malformed_line"
  | "manifest_unknown_key"
  | "manifest_empty_value"
  | "manifest_unsafe_source"
  | "manifest_source_not_supported_file"
  | "manifest_duplicate_source"
  | "manifest_unsafe_header"
  | "manifest_header_not_h_file"
  | "manifest_duplicate_header"
  | "manifest_unsafe_include"
  | "manifest_duplicate_include"
  | "manifest_unsafe_define"
  | "manifest_duplicate_define"
  | "manifest_unsafe_library"
  | "manifest_duplicate_library"
  | "manifest_reserved_library"
  | "manifest_duplicate_c_standard"
  | "manifest_duplicate_warning_level"
  | "manifest_duplicate_optimization"
  | "manifest_duplicate_debug_symbols"
  | "manifest_duplicate_toolchain"
  | "manifest_duplicate_assembler"
  | "manifest_unsafe_c_standard"
  | "manifest_unsafe_warning_level"
  | "manifest_unsafe_optimization"
  | "manifest_unsafe_debug_symbols"
  | "manifest_unsafe_toolchain"
  | "manifest_unsafe_assembler"
  | "manifest_source_missing"
  | "manifest_source_not_file"
  | "manifest_source_outside_project"
  | "manifest_source_count_out_of_range"
  | "manifest_header_missing"
  | "manifest_header_not_file"
  | "manifest_header_outside_project"
  | "manifest_header_count_out_of_range"
  | "manifest_include_missing"
  | "manifest_include_not_directory"
  | "manifest_include_outside_project"
  | "manifest_include_count_out_of_range"
  | "manifest_define_count_out_of_range"
  | "manifest_library_count_out_of_range";

export type ProjectCStandard = "c90" | "c99" | "c11";
export type ProjectWarningLevel = "default" | "extra" | "strict";
export type ProjectOptimizationLevel = "none" | "debug" | "release";
export type ProjectDebugSymbols = "yes" | "no";
export interface ProjectBuildProfile {
  cStandard: ProjectCStandard;
  warningLevel: ProjectWarningLevel;
  optimization: ProjectOptimizationLevel;
  debugSymbols: ProjectDebugSymbols;
}

export type ProjectResolvedToolchainProfile = ResolvedProjectToolchainProfile;

export interface ProjectResolvedAssemblerProfile {
  id: ProjectAssemblerId;
  family: ProjectAssemblerFamily;
  assemblerPath: string;
  linkerModel: ProjectLinkerModel;
  linkerPath: string;
}

export interface ParseProjectManifestResult {
  reason: ProjectManifestParseReason;
  manifest?: ParsedProjectManifest;
}

export interface ProjectManifestLocation {
  projectDirectory: string;
  manifestPath: string;
}

export type SetProjectToolchainPreferenceReason =
  | "ok"
  | "manifest_missing"
  | "manifest_read_failed"
  | "manifest_write_failed"
  | "manifest_duplicate_toolchain"
  | "toolchain_id_invalid";

export interface SetProjectToolchainPreferenceResult {
  reason: SetProjectToolchainPreferenceReason;
  location?: ProjectManifestLocation;
}

export type ProjectToolchainPreferenceReason =
  | "ok"
  | "manifest_missing"
  | "manifest_read_failed"
  | "manifest_duplicate_toolchain"
  | "toolchain_id_invalid";

export interface ProjectToolchainPreference {
  reason: ProjectToolchainPreferenceReason;
  toolchainId?: string;
  location?: ProjectManifestLocation;
}

export type SetProjectAssemblerPreferenceReason =
  | "ok"
  | "manifest_missing"
  | "manifest_read_failed"
  | "manifest_write_failed"
  | "manifest_duplicate_assembler"
  | "assembler_id_invalid";

export interface SetProjectAssemblerPreferenceResult {
  reason: SetProjectAssemblerPreferenceReason;
  location?: ProjectManifestLocation;
}

export type ProjectAssemblerPreferenceReason =
  | "ok"
  | "manifest_missing"
  | "manifest_read_failed"
  | "manifest_duplicate_assembler"
  | "assembler_id_invalid";

export interface ProjectAssemblerPreference {
  reason: ProjectAssemblerPreferenceReason;
  assemblerId?: string;
  location?: ProjectManifestLocation;
}

export interface FileWriteOps {
  writeFile(filePath: string, data: string, encoding: BufferEncoding): Promise<void>;
  rename(fromPath: string, toPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
}

const VALID_C_STANDARDS = new Set<ProjectCStandard>(["c90", "c99", "c11"]);
const VALID_WARNING_LEVELS = new Set<ProjectWarningLevel>(["default", "extra", "strict"]);
const VALID_OPTIMIZATION_LEVELS = new Set<ProjectOptimizationLevel>(["none", "debug", "release"]);
const VALID_DEBUG_SYMBOLS = new Set<ProjectDebugSymbols>(["yes", "no"]);
const TOOLCHAIN_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const TOOLCHAIN_SAFE_PATH_PATTERN = /^[A-Za-z0-9:/._+-]+$/;

function isValidCStandard(token: string): token is ProjectCStandard {
  return VALID_C_STANDARDS.has(token as ProjectCStandard);
}

function isValidWarningLevel(token: string): token is ProjectWarningLevel {
  return VALID_WARNING_LEVELS.has(token as ProjectWarningLevel);
}

function isValidOptimizationLevel(token: string): token is ProjectOptimizationLevel {
  return VALID_OPTIMIZATION_LEVELS.has(token as ProjectOptimizationLevel);
}

function isValidDebugSymbols(token: string): token is ProjectDebugSymbols {
  return VALID_DEBUG_SYMBOLS.has(token as ProjectDebugSymbols);
}

function isSafeToolchainPath(token: string): boolean {
  return (
    token.length > 0 &&
    token.length <= OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH &&
    !/(^|\/)\.\.(\/|$)/.test(token) &&
    TOOLCHAIN_SAFE_PATH_PATTERN.test(token)
  );
}

export function validateResolvedToolchainProfile(toolchain: ProjectResolvedToolchainProfile): string | undefined {
  if (toolchain.id.length === 0 || toolchain.id.length > OS4TB_GCC_PROJECT_TOOLCHAIN_ID_MAX_LENGTH) {
    return "toolchain_id_invalid";
  }
  if (toolchain.source !== "default_active" && toolchain.source !== "explicit") {
    return "toolchain_source_invalid";
  }
  if (toolchain.family === "gcc") {
    if (!isValidGccProjectToolchainId(toolchain.id)) {
      return "toolchain_id_invalid";
    }
    if (!TOOLCHAIN_VERSION_PATTERN.test(toolchain.version)) {
      return "toolchain_version_invalid";
    }
    if (toolchain.driverPrefixPolicy !== "dual_b" && toolchain.driverPrefixPolicy !== "bin_only") {
      return "toolchain_driver_prefix_policy_invalid";
    }
    if (!isSafeToolchainPath(toolchain.driver)) {
      return "toolchain_driver_invalid";
    }
    if (!isSafeToolchainPath(toolchain.cc1Prefix)) {
      return "toolchain_cc1_prefix_invalid";
    }
    if (!isSafeToolchainPath(toolchain.gccBinPrefix)) {
      return "toolchain_gcc_bin_prefix_invalid";
    }
    if (
      toolchain.internalIncludeDirs.length < 1 ||
      toolchain.internalIncludeDirs.length > OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_INTERNAL_INCLUDE_DIRS
    ) {
      return "toolchain_internal_include_dir_count_invalid";
    }
    const internalIncludeSeen = new Set<string>();
    for (const dir of toolchain.internalIncludeDirs) {
      if (!isSafeToolchainPath(dir)) {
        return "toolchain_internal_include_dir_invalid";
      }
      if (internalIncludeSeen.has(dir)) {
        return "toolchain_internal_include_dir_duplicate";
      }
      internalIncludeSeen.add(dir);
    }
    if (toolchain.sdkRoot !== undefined && !isSafeToolchainPath(toolchain.sdkRoot)) {
      return "toolchain_sdk_root_invalid";
    }
    if (!isSafeToolchainPath(toolchain.asPath)) {
      return "toolchain_as_path_invalid";
    }
    if (!isSafeToolchainPath(toolchain.ldPath)) {
      return "toolchain_ld_path_invalid";
    }
    if (!isSafeToolchainPath(toolchain.runtimeLibgcc)) {
      return "toolchain_runtime_libgcc_invalid";
    }
    if (!isSafeToolchainPath(toolchain.runtimeLibgccEh)) {
      return "toolchain_runtime_libgcc_eh_invalid";
    }
    if (!isSafeToolchainPath(toolchain.crtbeginPath)) {
      return "toolchain_crtbegin_invalid";
    }
    if (!isSafeToolchainPath(toolchain.crtendPath)) {
      return "toolchain_crtend_invalid";
    }
    if (
      toolchain.libraryDirs.length < 1 ||
      toolchain.libraryDirs.length > OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS
    ) {
      return "toolchain_library_dir_count_invalid";
    }
    const seen = new Set<string>();
    for (const dir of toolchain.libraryDirs) {
      if (!isSafeToolchainPath(dir)) {
        return "toolchain_library_dir_invalid";
      }
      if (seen.has(dir)) {
        return "toolchain_library_dir_duplicate";
      }
      seen.add(dir);
    }
    return undefined;
  }

  if (toolchain.family !== "vbcc") {
    return "toolchain_family_invalid";
  }
  const vbccToolchain = toolchain as ResolvedProjectVbccToolchain;
  if (vbccToolchain.id !== "vbcc-os4") {
    return "toolchain_id_invalid";
  }
  if (vbccToolchain.driverCommand !== "vc") {
    return "toolchain_driver_invalid";
  }
  if (!isSafeToolchainPath(vbccToolchain.driverPath)) {
    return "toolchain_driver_path_invalid";
  }
  if (vbccToolchain.compilerCommand !== "vbccppc") {
    return "toolchain_compiler_invalid";
  }
  if (vbccToolchain.normalBuildAssembler !== "vasmppc_std") {
    return "toolchain_assembler_invalid";
  }
  if (vbccToolchain.linkerCommand !== "vlink") {
    return "toolchain_linker_invalid";
  }
  if (!isSafeToolchainPath(vbccToolchain.linkerPath)) {
    return "toolchain_linker_path_invalid";
  }
  return undefined;
}

function parseManifestDefineToken(token: string): ProjectManifestDefine | undefined {
  const eq = token.indexOf("=");
  if (eq < 0) {
    if (
      token.length === 0 ||
      token.length > OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH ||
      !SAFE_DEFINE_NAME_PATTERN.test(token)
    ) {
      return undefined;
    }
    return { name: token, value: null };
  }
  if (eq === 0 || eq !== token.lastIndexOf("=")) {
    return undefined;
  }
  const name = token.slice(0, eq);
  const value = token.slice(eq + 1);
  if (
    name.length === 0 ||
    name.length > OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH ||
    !SAFE_DEFINE_NAME_PATTERN.test(name)
  ) {
    return undefined;
  }
  if (
    value.length === 0 ||
    value.length > OS4TB_GCC_PROJECT_DEFINE_VALUE_MAX_LENGTH ||
    !SAFE_DEFINE_VALUE_PATTERN.test(value)
  ) {
    return undefined;
  }
  return { name, value };
}

function isValidManifestLibraryName(token: string): boolean {
  return (
    token.length > 0 &&
    token.length <= OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH &&
    SAFE_LIBRARY_NAME_PATTERN.test(token)
  );
}

function isReservedManifestLibraryName(token: string): boolean {
  return RESERVED_LIBRARY_NAMES.has(token.toLowerCase());
}

export function isValidProjectRelativePath(token: string, expectedExtension?: ".c" | ".h" | ".s"): boolean {
  if (token.length === 0 || token.length > OS4TB_GCC_PROJECT_RELATIVE_PATH_MAX_LENGTH) {
    return false;
  }
  if (token.startsWith("/") || token.endsWith("/")) {
    return false;
  }
  if (token.includes("//") || token.includes("\\") || token.includes(":")) {
    return false;
  }
  for (const ch of token) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }

  const segments = token.split("/");
  if (segments.length === 0 || segments.length > OS4TB_GCC_PROJECT_RELATIVE_PATH_MAX_SEGMENTS) {
    return false;
  }
  for (const segment of segments) {
    if (segment.length === 0 || segment.length > OS4TB_GCC_PROJECT_SEGMENT_MAX_LENGTH) {
      return false;
    }
    if (segment === "." || segment === "..") {
      return false;
    }
    if (!SAFE_RELATIVE_SEGMENT_PATTERN.test(segment)) {
      return false;
    }
  }
  if (!expectedExtension) {
    return true;
  }
  return path.extname(token) === expectedExtension;
}

export function classifyProjectSourceRelativePath(token: string): ProjectSourceKind | "unsupported" | "unsafe" {
  if (!isValidProjectRelativePath(token)) {
    return "unsafe";
  }
  const ext = path.extname(token);
  if (ext === ".c") {
    return "c";
  }
  if (ext === ".s") {
    return "asm";
  }
  return "unsupported";
}

function splitRelativePathForJoin(relativePath: string): string[] {
  return relativePath.split("/");
}

function isPathInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function resolveManifestEntryPath(
  projectDirectory: string,
  projectRealDirectory: string,
  relativePath: string
): Promise<{ resolvedPath: string; realPath: string } | undefined> {
  const resolvedPath = path.resolve(projectDirectory, ...splitRelativePathForJoin(relativePath));
  const resolvedProjectDirectory = path.resolve(projectDirectory);
  if (!isPathInside(resolvedProjectDirectory, resolvedPath)) {
    return undefined;
  }
  const realPath = await fs.realpath(resolvedPath);
  if (!isPathInside(projectRealDirectory, realPath)) {
    return undefined;
  }
  return { resolvedPath, realPath };
}

export async function resolveTwoFileProjectSources(mainFilePath: string): Promise<ProjectSourceResolveResult> {
  if (path.basename(mainFilePath) !== "main.c") {
    return { reason: "main_file_required" };
  }
  if (!isSupportedCompileSourcePath(mainFilePath)) {
    return { reason: "unsupported_extension" };
  }
  if (!isSafeSourceBasename(mainFilePath)) {
    return { reason: "unsafe_basename" };
  }

  const helperPath = path.join(path.dirname(mainFilePath), "helper.c");
  let helperStat;
  try {
    helperStat = await fs.stat(helperPath);
  } catch {
    return { reason: "helper_missing" };
  }
  if (!helperStat.isFile()) {
    return { reason: "helper_not_file" };
  }
  if (!isSupportedCompileSourcePath(helperPath)) {
    return { reason: "helper_unsupported_extension" };
  }
  if (!isSafeSourceBasename(helperPath)) {
    return { reason: "helper_unsafe_basename" };
  }

  return {
    reason: "ok",
    mainPath: mainFilePath,
    helperPath
  };
}

export async function locateProjectManifestForActiveFile(
  activeFilePath: string
): Promise<ProjectManifestLocation | undefined> {
  const activeDirectory = path.dirname(activeFilePath);
  const searchRoots: string[] = [];
  let currentDirectory = activeDirectory;
  for (let i = 0; i <= OS4TB_GCC_PROJECT_RELATIVE_PATH_MAX_SEGMENTS; i += 1) {
    if (searchRoots.includes(currentDirectory)) {
      break;
    }
    searchRoots.push(currentDirectory);
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
  }

  for (const candidateRoot of searchRoots) {
    const candidateManifestPath = path.join(candidateRoot, PROJECT_MANIFEST_FILENAME);
    try {
      const stat = await fs.stat(candidateManifestPath);
      if (stat.isFile()) {
        return { projectDirectory: candidateRoot, manifestPath: candidateManifestPath };
      }
    } catch {
      // continue searching parent directories
    }
  }

  return undefined;
}

export async function parseProjectManifestForActiveFile(activeFilePath: string): Promise<ParseProjectManifestResult> {
  const location = await locateProjectManifestForActiveFile(activeFilePath);
  if (!location) {
    return { reason: "manifest_missing" };
  }

  const manifestPath = location.manifestPath;
  const projectDirectory = location.projectDirectory;
  let manifestText = "";
  try {
    manifestText = await fs.readFile(manifestPath, "utf8");
  } catch (err) {
    return { reason: "manifest_read_failed" };
  }

  const sourceRelativePaths: string[] = [];
  const sourceKinds: ProjectSourceKind[] = [];
  const headerRelativePaths: string[] = [];
  const includeRelativePaths: string[] = [];
  const defines: ProjectManifestDefine[] = [];
  const defineEntries: string[] = [];
  const libraries: string[] = [];
  let cStandard: ProjectCStandard = OS4TB_GCC_PROJECT_DEFAULT_C_STANDARD;
  let warningLevel: ProjectWarningLevel = OS4TB_GCC_PROJECT_DEFAULT_WARNING_LEVEL;
  let optimization: ProjectOptimizationLevel = OS4TB_GCC_PROJECT_DEFAULT_OPTIMIZATION;
  let debugSymbols: ProjectDebugSymbols = OS4TB_GCC_PROJECT_DEFAULT_DEBUG_SYMBOLS;
  let toolchainId: string | undefined;
  let assemblerId: string | undefined;
  let seenCStandard = false;
  let seenWarningLevel = false;
  let seenOptimization = false;
  let seenDebugSymbols = false;
  let seenToolchain = false;
  let seenAssembler = false;
  const seenSource = new Set<string>();
  const seenHeader = new Set<string>();
  const seenInclude = new Set<string>();
  const seenDefineName = new Set<string>();
  const seenLibrary = new Set<string>();

  for (const rawLine of manifestText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      return { reason: "manifest_malformed_line" };
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (value.length === 0) {
      return { reason: "manifest_empty_value" };
    }
    if (key !== "define" && eq !== line.lastIndexOf("=")) {
      return { reason: "manifest_malformed_line" };
    }

    const canonicalValue = value.toLowerCase();
    if (key === "source") {
      const sourceKind = classifyProjectSourceRelativePath(value);
      if (sourceKind === "unsupported") {
        return { reason: "manifest_source_not_supported_file" };
      }
      if (sourceKind === "unsafe") {
        return { reason: "manifest_unsafe_source" };
      }
      if (seenSource.has(canonicalValue)) {
        return { reason: "manifest_duplicate_source" };
      }
      seenSource.add(canonicalValue);
      sourceRelativePaths.push(value);
      sourceKinds.push(sourceKind);
      continue;
    }

    if (key === "header") {
      if (!isValidProjectRelativePath(value, ".h")) {
        if (path.extname(value).toLowerCase() !== ".h") {
          return { reason: "manifest_header_not_h_file" };
        }
        return { reason: "manifest_unsafe_header" };
      }
      if (seenHeader.has(canonicalValue)) {
        return { reason: "manifest_duplicate_header" };
      }
      seenHeader.add(canonicalValue);
      headerRelativePaths.push(value);
      continue;
    }

    if (key === "include") {
      if (!isValidProjectRelativePath(value)) {
        return { reason: "manifest_unsafe_include" };
      }
      if (seenInclude.has(canonicalValue)) {
        return { reason: "manifest_duplicate_include" };
      }
      seenInclude.add(canonicalValue);
      includeRelativePaths.push(value);
      continue;
    }

    if (key === "define") {
      const parsedDefine = parseManifestDefineToken(value);
      if (!parsedDefine) {
        return { reason: "manifest_unsafe_define" };
      }
      if (seenDefineName.has(parsedDefine.name)) {
        return { reason: "manifest_duplicate_define" };
      }
      seenDefineName.add(parsedDefine.name);
      defines.push(parsedDefine);
      defineEntries.push(parsedDefine.value === null ? parsedDefine.name : `${parsedDefine.name}=${parsedDefine.value}`);
      continue;
    }

    if (key === "library") {
      if (!isValidManifestLibraryName(value)) {
        return { reason: "manifest_unsafe_library" };
      }
      if (isReservedManifestLibraryName(value)) {
        return { reason: "manifest_reserved_library" };
      }
      if (seenLibrary.has(value)) {
        return { reason: "manifest_duplicate_library" };
      }
      seenLibrary.add(value);
      libraries.push(value);
      continue;
    }

    if (key === "c_standard") {
      if (seenCStandard) {
        return { reason: "manifest_duplicate_c_standard" };
      }
      if (!isValidCStandard(value)) {
        return { reason: "manifest_unsafe_c_standard" };
      }
      seenCStandard = true;
      cStandard = value;
      continue;
    }

    if (key === "warning_level") {
      if (seenWarningLevel) {
        return { reason: "manifest_duplicate_warning_level" };
      }
      if (!isValidWarningLevel(value)) {
        return { reason: "manifest_unsafe_warning_level" };
      }
      seenWarningLevel = true;
      warningLevel = value;
      continue;
    }

    if (key === "optimization") {
      if (seenOptimization) {
        return { reason: "manifest_duplicate_optimization" };
      }
      if (!isValidOptimizationLevel(value)) {
        return { reason: "manifest_unsafe_optimization" };
      }
      seenOptimization = true;
      optimization = value;
      continue;
    }

    if (key === "debug_symbols") {
      if (seenDebugSymbols) {
        return { reason: "manifest_duplicate_debug_symbols" };
      }
      if (!isValidDebugSymbols(value)) {
        return { reason: "manifest_unsafe_debug_symbols" };
      }
      seenDebugSymbols = true;
      debugSymbols = value;
      continue;
    }

    if (key === "toolchain") {
      if (seenToolchain) {
        return { reason: "manifest_duplicate_toolchain" };
      }
      if (!isValidProjectToolchainId(value)) {
        return { reason: "manifest_unsafe_toolchain" };
      }
      seenToolchain = true;
      toolchainId = value;
      continue;
    }

    if (key === "assembler") {
      if (seenAssembler) {
        return { reason: "manifest_duplicate_assembler" };
      }
      if (!isValidProjectAssemblerId(value)) {
        return { reason: "manifest_unsafe_assembler" };
      }
      seenAssembler = true;
      assemblerId = value;
      continue;
    }

    return { reason: "manifest_unknown_key" };
  }

  if (
    sourceRelativePaths.length < OS4TB_GCC_PROJECT_MIN_SOURCES ||
    sourceRelativePaths.length > OS4TB_GCC_PROJECT_MAX_SOURCES
  ) {
    return { reason: "manifest_source_count_out_of_range" };
  }
  if (
    headerRelativePaths.length < OS4TB_GCC_PROJECT_MIN_HEADERS ||
    headerRelativePaths.length > OS4TB_GCC_PROJECT_MAX_HEADERS
  ) {
    return { reason: "manifest_header_count_out_of_range" };
  }
  if (
    includeRelativePaths.length < OS4TB_GCC_PROJECT_MIN_INCLUDES ||
    includeRelativePaths.length > OS4TB_GCC_PROJECT_MAX_INCLUDES
  ) {
    return { reason: "manifest_include_count_out_of_range" };
  }
  if (defines.length < OS4TB_GCC_PROJECT_MIN_DEFINES || defines.length > OS4TB_GCC_PROJECT_MAX_DEFINES) {
    return { reason: "manifest_define_count_out_of_range" };
  }
  if (libraries.length < OS4TB_GCC_PROJECT_MIN_LIBRARIES || libraries.length > OS4TB_GCC_PROJECT_MAX_LIBRARIES) {
    return { reason: "manifest_library_count_out_of_range" };
  }

  const sources: string[] = [];
  const headers: string[] = [];
  const includes: string[] = [];
  const projectRealDirectory = await fs.realpath(projectDirectory);

  for (const relativePath of sourceRelativePaths) {
    let resolvedEntry;
    try {
      resolvedEntry = await resolveManifestEntryPath(projectDirectory, projectRealDirectory, relativePath);
    } catch {
      return { reason: "manifest_source_missing" };
    }
    if (!resolvedEntry) {
      return { reason: "manifest_source_outside_project" };
    }
    let stat;
    try {
      stat = await fs.stat(resolvedEntry.realPath);
    } catch {
      return { reason: "manifest_source_missing" };
    }
    if (!stat.isFile()) {
      return { reason: "manifest_source_not_file" };
    }
    sources.push(resolvedEntry.realPath);
  }

  for (const relativePath of headerRelativePaths) {
    let resolvedEntry;
    try {
      resolvedEntry = await resolveManifestEntryPath(projectDirectory, projectRealDirectory, relativePath);
    } catch {
      return { reason: "manifest_header_missing" };
    }
    if (!resolvedEntry) {
      return { reason: "manifest_header_outside_project" };
    }
    let stat;
    try {
      stat = await fs.stat(resolvedEntry.realPath);
    } catch {
      return { reason: "manifest_header_missing" };
    }
    if (!stat.isFile()) {
      return { reason: "manifest_header_not_file" };
    }
    headers.push(resolvedEntry.realPath);
  }

  for (const relativePath of includeRelativePaths) {
    let resolvedEntry;
    try {
      resolvedEntry = await resolveManifestEntryPath(projectDirectory, projectRealDirectory, relativePath);
    } catch {
      return { reason: "manifest_include_missing" };
    }
    if (!resolvedEntry) {
      return { reason: "manifest_include_outside_project" };
    }
    let stat;
    try {
      stat = await fs.stat(resolvedEntry.realPath);
    } catch {
      return { reason: "manifest_include_missing" };
    }
    if (!stat.isDirectory()) {
      return { reason: "manifest_include_not_directory" };
    }
    includes.push(resolvedEntry.realPath);
  }

  return {
    reason: "ok",
    manifest: {
      manifestPath,
      projectDirectory: projectRealDirectory,
      sources,
      headers,
      includes,
      sourceRelativePaths,
      sourceKinds,
      headerRelativePaths,
      includeRelativePaths,
      defines,
      defineEntries,
      libraries,
      toolchainId,
      assemblerId,
      cStandard,
      warningLevel,
      optimization,
      debugSymbols
    }
  };
}

export async function readProjectToolchainPreferenceForActiveFile(
  activeFilePath: string
): Promise<ProjectToolchainPreference> {
  const location = await locateProjectManifestForActiveFile(activeFilePath);
  if (!location) {
    return { reason: "manifest_missing" };
  }
  let manifestText = "";
  try {
    manifestText = await fs.readFile(location.manifestPath, "utf8");
  } catch {
    return { reason: "manifest_read_failed", location };
  }

  let toolchainId: string | undefined;
  let seenToolchain = false;
  for (const rawLine of manifestText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (key !== "toolchain") {
      continue;
    }
    const value = line.slice(eq + 1).trim();
    if (value.length === 0) {
      continue;
    }
    if (seenToolchain) {
      return { reason: "manifest_duplicate_toolchain", location };
    }
    if (!isValidProjectToolchainId(value)) {
      return { reason: "toolchain_id_invalid", location };
    }
    seenToolchain = true;
    toolchainId = value;
  }
  return { reason: "ok", toolchainId, location };
}

const defaultFileWriteOps: FileWriteOps = {
  writeFile: async (filePath, data, encoding) => fs.writeFile(filePath, data, encoding),
  rename: async (fromPath, toPath) => fs.rename(fromPath, toPath),
  unlink: async (filePath) => fs.unlink(filePath)
};

export async function writeProjectManifestAtomically(
  manifestPath: string,
  nextText: string,
  writeOps: FileWriteOps = defaultFileWriteOps
): Promise<void> {
  const tempPath = `${manifestPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeOps.writeFile(tempPath, nextText, "utf8");
    await writeOps.rename(tempPath, manifestPath);
  } catch (err) {
    try {
      await writeOps.unlink(tempPath);
    } catch {
      // best-effort temp cleanup
    }
    throw err;
  }
}

export async function setProjectToolchainPreferenceForActiveFile(
  activeFilePath: string,
  toolchainId?: string,
  writeOps: FileWriteOps = defaultFileWriteOps
): Promise<SetProjectToolchainPreferenceResult> {
  if (toolchainId && !isValidProjectToolchainId(toolchainId)) {
    return { reason: "toolchain_id_invalid" };
  }

  const location = await locateProjectManifestForActiveFile(activeFilePath);
  if (!location) {
    return { reason: "manifest_missing" };
  }

  let manifestText = "";
  try {
    manifestText = await fs.readFile(location.manifestPath, "utf8");
  } catch {
    return { reason: "manifest_read_failed", location };
  }

  let seenToolchain = false;
  const nextLines: string[] = [];
  const newline = manifestText.includes("\r\n") ? "\r\n" : "\n";
  for (const rawLine of manifestText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0 && trimmed.slice(0, eq).trim() === "toolchain") {
      if (seenToolchain) {
        return { reason: "manifest_duplicate_toolchain", location };
      }
      seenToolchain = true;
      continue;
    }
    nextLines.push(rawLine);
  }
  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }
  if (toolchainId) {
    nextLines.push(`toolchain=${toolchainId}`);
  }

  const nextText = `${nextLines.join(newline)}${newline}`;
  try {
    await writeProjectManifestAtomically(location.manifestPath, nextText, writeOps);
  } catch {
    return { reason: "manifest_write_failed", location };
  }
  return { reason: "ok", location };
}

export async function readProjectAssemblerPreferenceForActiveFile(
  activeFilePath: string
): Promise<ProjectAssemblerPreference> {
  const location = await locateProjectManifestForActiveFile(activeFilePath);
  if (!location) {
    return { reason: "manifest_missing" };
  }
  let manifestText = "";
  try {
    manifestText = await fs.readFile(location.manifestPath, "utf8");
  } catch {
    return { reason: "manifest_read_failed", location };
  }

  let assemblerId: string | undefined;
  let seenAssembler = false;
  for (const rawLine of manifestText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (key !== "assembler") {
      continue;
    }
    const value = line.slice(eq + 1).trim();
    if (value.length === 0) {
      continue;
    }
    if (seenAssembler) {
      return { reason: "manifest_duplicate_assembler", location };
    }
    if (!isValidProjectAssemblerId(value)) {
      return { reason: "assembler_id_invalid", location };
    }
    seenAssembler = true;
    assemblerId = value;
  }
  return { reason: "ok", assemblerId, location };
}

export async function setProjectAssemblerPreferenceForActiveFile(
  activeFilePath: string,
  assemblerId?: string,
  writeOps: FileWriteOps = defaultFileWriteOps
): Promise<SetProjectAssemblerPreferenceResult> {
  if (assemblerId && !isValidProjectAssemblerId(assemblerId)) {
    return { reason: "assembler_id_invalid" };
  }

  const location = await locateProjectManifestForActiveFile(activeFilePath);
  if (!location) {
    return { reason: "manifest_missing" };
  }

  let manifestText = "";
  try {
    manifestText = await fs.readFile(location.manifestPath, "utf8");
  } catch {
    return { reason: "manifest_read_failed", location };
  }

  let seenAssembler = false;
  const nextLines: string[] = [];
  const newline = manifestText.includes("\r\n") ? "\r\n" : "\n";
  for (const rawLine of manifestText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0 && trimmed.slice(0, eq).trim() === "assembler") {
      if (seenAssembler) {
        return { reason: "manifest_duplicate_assembler", location };
      }
      seenAssembler = true;
      continue;
    }
    nextLines.push(rawLine);
  }
  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }
  if (assemblerId) {
    nextLines.push(`assembler=${assemblerId}`);
  }

  const nextText = `${nextLines.join(newline)}${newline}`;
  try {
    await writeProjectManifestAtomically(location.manifestPath, nextText, writeOps);
  } catch {
    return { reason: "manifest_write_failed", location };
  }
  return { reason: "ok", location };
}

export function buildProjectStagedSourceBasename(_requestId: string, sourceIndex: number): string {
  return `source${sourceIndex}.c`;
}

export function buildProjectStagedSourceBasenameForKind(
  _requestId: string,
  sourceIndex: number,
  sourceKind: ProjectSourceKind
): string {
  return `source${sourceIndex}.${sourceKind === "asm" ? "s" : "c"}`;
}

export function buildProjectStagedDirectoryBasename(requestId: string): string {
  return `project_${requestId}`;
}

export function buildProjectObjectBasename(requestId: string, sourceIndex: number): string {
  return `build_${requestId}_source${sourceIndex}.o`;
}

export function buildProjectManifestBasename(): string {
  return PROJECT_GUEST_MANIFEST_FILENAME;
}

export function buildGuestProjectDirectoryPath(requestId: string): string {
  return `SAMDROP:incoming/${buildProjectStagedDirectoryBasename(requestId)}`;
}

export function buildGuestProjectManifestPath(requestId: string): string {
  return `${buildGuestProjectDirectoryPath(requestId)}/${PROJECT_GUEST_MANIFEST_FILENAME}`;
}

export function buildGuestProjectManifestText(
  stagedSourcePaths: string[],
  sourceKinds: ProjectSourceKind[],
  stagedHeaderPaths: string[],
  stagedIncludePaths: string[],
  defineEntries: string[],
  libraryNames: string[],
  profile?: ProjectBuildProfile,
  toolchain?: ProjectResolvedToolchainProfile,
  assembler?: ProjectResolvedAssemblerProfile,
  executionPolicy: "build_and_run" | "build_only" = "build_and_run"
): string {
  const resolvedProfile: ProjectBuildProfile = profile ?? {
    cStandard: OS4TB_GCC_PROJECT_DEFAULT_C_STANDARD,
    warningLevel: OS4TB_GCC_PROJECT_DEFAULT_WARNING_LEVEL,
    optimization: OS4TB_GCC_PROJECT_DEFAULT_OPTIMIZATION,
    debugSymbols: OS4TB_GCC_PROJECT_DEFAULT_DEBUG_SYMBOLS
  };
  if (sourceKinds.length !== stagedSourcePaths.length) {
    throw new Error("source_kind_count_mismatch");
  }
  const lines = [`SOURCE_COUNT=${stagedSourcePaths.length}`];
  for (let i = 0; i < stagedSourcePaths.length; i += 1) {
    lines.push(`SOURCE_${i}=${stagedSourcePaths[i]}`);
    lines.push(`SOURCE_TYPE_${i}=${sourceKinds[i]}`);
  }
  lines.push(`HEADER_COUNT=${stagedHeaderPaths.length}`);
  for (let i = 0; i < stagedHeaderPaths.length; i += 1) {
    lines.push(`HEADER_${i}=${stagedHeaderPaths[i]}`);
  }
  lines.push(`INCLUDE_COUNT=${stagedIncludePaths.length}`);
  for (let i = 0; i < stagedIncludePaths.length; i += 1) {
    lines.push(`INCLUDE_${i}=${stagedIncludePaths[i]}`);
  }
  lines.push(`DEFINE_COUNT=${defineEntries.length}`);
  for (let i = 0; i < defineEntries.length; i += 1) {
    lines.push(`DEFINE_${i}=${defineEntries[i]}`);
  }
  lines.push(`LIBRARY_COUNT=${libraryNames.length}`);
  for (let i = 0; i < libraryNames.length; i += 1) {
    lines.push(`LIBRARY_${i}=${libraryNames[i]}`);
  }
  if (executionPolicy === "build_only") {
    lines.push("RUN_PROGRAM=no");
  }
  lines.push(`C_STANDARD=${resolvedProfile.cStandard}`);
  lines.push(`WARNING_LEVEL=${resolvedProfile.warningLevel}`);
  lines.push(`OPTIMIZATION=${resolvedProfile.optimization}`);
  lines.push(`DEBUG_SYMBOLS=${resolvedProfile.debugSymbols}`);
  if (toolchain) {
    const toolchainError = validateResolvedToolchainProfile(toolchain);
    if (toolchainError) {
      throw new Error(toolchainError);
    }
    lines.push(`TOOLCHAIN=${toolchain.id}`);
    lines.push(`TOOLCHAIN_SOURCE=${toolchain.source}`);
    lines.push(`TOOLCHAIN_FAMILY=${toolchain.family}`);
    lines.push(`TOOLCHAIN_VERSION=${toolchain.version}`);
    if (toolchain.family === "gcc") {
      lines.push(`TOOLCHAIN_DRIVER=${toolchain.driver}`);
      lines.push(`TOOLCHAIN_DRIVER_PREFIX_POLICY=${toolchain.driverPrefixPolicy}`);
      lines.push(`TOOLCHAIN_CC1_PREFIX=${toolchain.cc1Prefix}`);
      lines.push(`TOOLCHAIN_GCC_BIN_PREFIX=${toolchain.gccBinPrefix}`);
      lines.push(`TOOLCHAIN_INTERNAL_INCLUDE_COUNT=${toolchain.internalIncludeDirs.length}`);
      for (let i = 0; i < toolchain.internalIncludeDirs.length; i += 1) {
        lines.push(`TOOLCHAIN_INTERNAL_INCLUDE_${i}=${toolchain.internalIncludeDirs[i]}`);
      }
      if (toolchain.sdkRoot) {
        lines.push(`TOOLCHAIN_SDK_ROOT=${toolchain.sdkRoot}`);
      }
      lines.push(`TOOLCHAIN_AS_PATH=${toolchain.asPath}`);
      lines.push(`TOOLCHAIN_LD_PATH=${toolchain.ldPath}`);
      lines.push(`TOOLCHAIN_RUNTIME_LIBGCC=${toolchain.runtimeLibgcc}`);
      lines.push(`TOOLCHAIN_RUNTIME_LIBGCC_EH=${toolchain.runtimeLibgccEh}`);
      lines.push(`TOOLCHAIN_CRTBEGIN=${toolchain.crtbeginPath}`);
      lines.push(`TOOLCHAIN_CRTEND=${toolchain.crtendPath}`);
      lines.push(`TOOLCHAIN_LIBRARY_DIR_COUNT=${toolchain.libraryDirs.length}`);
      for (let i = 0; i < toolchain.libraryDirs.length; i += 1) {
        lines.push(`TOOLCHAIN_LIBRARY_DIR_${i}=${toolchain.libraryDirs[i]}`);
      }
    } else {
      lines.push(`VBCC_DRIVER=${toolchain.driverCommand}`);
      lines.push(`VBCC_DRIVER_PATH=${toolchain.driverPath}`);
      lines.push(`VBCC_COMPILER=${toolchain.compilerCommand}`);
      lines.push(`VBCC_ASSEMBLER=${toolchain.normalBuildAssembler}`);
      lines.push(`VBCC_LINKER=${toolchain.linkerCommand}`);
      lines.push(`VBCC_LINKER_PATH=${toolchain.linkerPath}`);
    }
  }
  if (assembler) {
    lines.push(`ASSEMBLER_ID=${assembler.id}`);
    lines.push(`ASSEMBLER_FAMILY=${assembler.family}`);
    lines.push(`ASSEMBLER_PATH=${assembler.assemblerPath}`);
    lines.push(`LINKER_MODEL=${assembler.linkerModel}`);
    lines.push(`LINKER_PATH=${assembler.linkerPath}`);
  }
  lines.push("");
  return lines.join("\n");
}
