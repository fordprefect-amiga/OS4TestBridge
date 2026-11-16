export const OS4TB_DISCOVERY_SCHEMA_VERSION = 1;
export const OS4TB_DISCOVERY_MAX_GCC = 8;
export const OS4TB_DISCOVERY_MAX_INCLUDE_DIRS = 16;
export const OS4TB_DISCOVERY_MAX_LIBRARY_DIRS = 16;
export const OS4TB_DISCOVERY_MAX_LIBRARY_INVENTORY = 256;
export const OS4TB_DISCOVERY_MAX_INTERNAL_INCLUDE_DIRS = 8;
export const OS4TB_DISCOVERY_MAX_LINE_LENGTH = 512;
export const OS4TB_DISCOVERY_MAX_ARTIFACT_BYTES = 262144;

export type DiscoveryStatus = "present" | "missing" | "unknown" | "broken_symlink" | "symlink";
export type IncludePathKind = "gcc-internal" | "gcc-include-fixed" | "sdk-newlib" | "sdk-local" | "other-known" | "unknown";

export interface DiscoveredGccToolchain {
  index: number;
  status: DiscoveryStatus;
  version: string;
  driver: string;
  cc1Path: string;
  asPath: string;
  ldPath: string;
  includePaths: string[];
  includePathKinds: IncludePathKind[];
  includeProbeStream: "stdout" | "stderr" | "none" | "unknown";
  includeDiscoveryStatus: "found" | "empty" | "probe_failed" | "unknown";
  includeProbeStdoutHasBlock: boolean;
  includeProbeStderrHasBlock: boolean;
  internalIncludeDirs: string[];
  internalStddefDir: string;
  internalStdargDir: string;
  internalStdintDir: string;
  libraryDirs: string[];
  libraryInventory: string[];
  libraryInventoryTruncated: boolean;
  runtimeLibgcc: string;
  runtimeLibgccStatus: DiscoveryStatus;
  runtimeLibgccEh: string;
  runtimeLibgccEhStatus: DiscoveryStatus;
  crtbeginPath: string;
  crtbeginStatus: DiscoveryStatus;
  crtendPath: string;
  crtendStatus: DiscoveryStatus;
}

export interface ToolchainDiscoverySnapshot {
  schemaVersion: number;
  sdkStatus: DiscoveryStatus;
  sdkRoot: string;
  gccAssign: string;
  libAssign: string;
  gccActiveFrontend: string;
  gccActiveVersion: string;
  gccToolchains: DiscoveredGccToolchain[];
  vbccStatus: DiscoveryStatus;
  vbccVersion: string;
  vbccDriverCommand: string;
  vbccDriverPath: string;
  vbccLinkerStatus: DiscoveryStatus;
  vbccLinkerPath: string;
  vbccAssemblerStatus: DiscoveryStatus;
  vbccAssemblerPath: string;
  asStatus: DiscoveryStatus;
  asPath: string;
  asVersion: string;
  ldStatus: DiscoveryStatus;
  ldPath: string;
  ldVersion: string;
}

export type ProjectToolchainSource = "default_active" | "explicit";
export type ProjectDriverPrefixPolicy = "dual_b" | "bin_only";
export type ToolchainFamily = "gcc" | "vbcc";

export interface ResolvedProjectGccToolchain {
  id: string;
  family: "gcc";
  version: string;
  source: ProjectToolchainSource;
  sdkRoot?: string;
  driver: string;
  driverPrefixPolicy: ProjectDriverPrefixPolicy;
  cc1Prefix: string;
  gccBinPrefix: string;
  internalIncludeDirs: string[];
  asPath: string;
  ldPath: string;
  runtimeLibgcc: string;
  runtimeLibgccEh: string;
  crtbeginPath: string;
  crtendPath: string;
  libraryDirs: string[];
}

export interface ResolvedProjectVbccToolchain {
  id: "vbcc-os4";
  family: "vbcc";
  source: ProjectToolchainSource;
  version: string;
  driverCommand: "vc";
  driverPath: string;
  compilerCommand: "vbccppc";
  normalBuildAssembler: "vasmppc_std";
  linkerCommand: "vlink";
  linkerPath: string;
  supportedStandards: readonly ["c90", "c99"];
}

export type ResolvedProjectToolchainProfile = ResolvedProjectGccToolchain | ResolvedProjectVbccToolchain;

export type ResolveProjectToolchainReason =
  | "toolchain_identity_invalid"
  | "toolchain_not_discovered"
  | "active_toolchain_not_discovered"
  | "toolchain_profile_incomplete"
  | "vbcc_not_discovered";

export type ResolveProjectGccToolchainReason = Exclude<ResolveProjectToolchainReason, "vbcc_not_discovered">;

function hasSafeToolchainPath(value: string): boolean {
  if (!value || value === "unknown") {
    return false;
  }
  if (value.length > 320) {
    return false;
  }
  if (/(^|\/)\.\.(\/|$)/.test(value)) {
    return false;
  }
  if (!/^[A-Za-z0-9:/._+-]+$/.test(value)) {
    return false;
  }
  return true;
}

function withTrailingSlash(prefix: string): string {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function derivePrefixFromPath(filePath: string): string | undefined {
  if (!hasSafeToolchainPath(filePath)) {
    return undefined;
  }
  const idx = filePath.lastIndexOf("/");
  if (idx <= 0) {
    return undefined;
  }
  return withTrailingSlash(filePath.slice(0, idx));
}

function deriveToolchainId(version: string): string {
  return `gcc-${version}`;
}

function parseVersionMajor(version: string): string | undefined {
  const match = /^([0-9]+)\.[0-9]+\.[0-9]+$/.exec(version);
  return match ? match[1] : undefined;
}

function deriveVersionedDriverPath(params: {
  driverPath: string;
  version: string;
}): string | undefined {
  if (!hasSafeToolchainPath(params.driverPath)) {
    return undefined;
  }
  const major = parseVersionMajor(params.version);
  if (!major) {
    return undefined;
  }
  const slash = params.driverPath.lastIndexOf("/");
  if (slash <= 0) {
    return undefined;
  }
  const baseDir = params.driverPath.slice(0, slash);
  return `${baseDir}/${params.version}/ppc-amigaos-gcc-${major}`;
}

export function isValidGccProjectToolchainId(value: string): boolean {
  return /^gcc-[0-9]+\.[0-9]+\.[0-9]+$/.test(value);
}

export function isValidVbccProjectToolchainId(value: string): value is "vbcc-os4" {
  return value === "vbcc-os4";
}

export function isValidProjectToolchainId(value: string): boolean {
  return isValidGccProjectToolchainId(value) || isValidVbccProjectToolchainId(value);
}

function resolveProjectGccToolchainInternal(params: {
  snapshot: ToolchainDiscoverySnapshot;
  toolchainId?: string;
}): { ok: true; toolchain: ResolvedProjectGccToolchain } | { ok: false; reason: ResolveProjectGccToolchainReason } {
  const requested = params.toolchainId?.trim();
  if (requested && !isValidGccProjectToolchainId(requested)) {
    return { ok: false, reason: "toolchain_identity_invalid" };
  }
  const source: ProjectToolchainSource = requested ? "explicit" : "default_active";

  const toolchains = params.snapshot.gccToolchains.filter((entry) => entry.status === "present");
  let selected: DiscoveredGccToolchain | undefined;
  if (requested) {
    selected = toolchains.find((entry) => deriveToolchainId(entry.version) === requested);
    if (!selected) {
      return { ok: false, reason: "toolchain_not_discovered" };
    }
  } else {
    const activeVersion = params.snapshot.gccActiveVersion;
    if (activeVersion && activeVersion !== "unknown") {
      selected = toolchains.find((entry) => entry.version === activeVersion);
    }
    if (!selected) {
      selected = toolchains.find((entry) => entry.driver === params.snapshot.gccActiveFrontend);
    }
    if (!selected) {
      selected = toolchains.find((entry) => entry.driver.endsWith("/gcc"));
    }
    if (!selected && toolchains.length === 1) {
      selected = toolchains[0];
    }
    if (!selected) {
      return { ok: false, reason: "active_toolchain_not_discovered" };
    }
    if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(selected.version)) {
      return { ok: false, reason: "toolchain_profile_incomplete" };
    }
  }

  const cc1Prefix = derivePrefixFromPath(selected.cc1Path);
  const gccBinPrefix = derivePrefixFromPath(selected.asPath) ?? derivePrefixFromPath(selected.ldPath);
  const internalIncludeDirs = selected.internalIncludeDirs
    .filter((entry) => hasSafeToolchainPath(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .slice(0, OS4TB_DISCOVERY_MAX_INTERNAL_INCLUDE_DIRS);
  if (internalIncludeDirs.length === 0 && hasSafeToolchainPath(selected.internalStddefDir)) {
    internalIncludeDirs.push(selected.internalStddefDir);
  }
  const libraryDirs = selected.libraryDirs.filter((entry) => hasSafeToolchainPath(entry)).slice(0, OS4TB_DISCOVERY_MAX_LIBRARY_DIRS);
  if (
    !cc1Prefix ||
    !gccBinPrefix ||
    internalIncludeDirs.length === 0 ||
    !hasSafeToolchainPath(selected.ldPath) ||
    !hasSafeToolchainPath(selected.runtimeLibgcc) ||
    !hasSafeToolchainPath(selected.runtimeLibgccEh) ||
    !hasSafeToolchainPath(selected.crtbeginPath) ||
    !hasSafeToolchainPath(selected.crtendPath) ||
    libraryDirs.length === 0
  ) {
    return { ok: false, reason: "toolchain_profile_incomplete" };
  }

  const activeVersion = params.snapshot.gccActiveVersion;
  const isNonActiveVersion =
    source === "explicit" && !!activeVersion && activeVersion !== "unknown" && selected.version !== activeVersion;
  const derivedVersionedDriver = deriveVersionedDriverPath({ driverPath: selected.driver, version: selected.version });
  if (isNonActiveVersion && !derivedVersionedDriver) {
    return { ok: false, reason: "toolchain_profile_incomplete" };
  }
  const driver = isNonActiveVersion ? derivedVersionedDriver! : "gcc";
  const driverPrefixPolicy: ProjectDriverPrefixPolicy = isNonActiveVersion ? "bin_only" : "dual_b";
  if (driver !== "gcc" && !hasSafeToolchainPath(driver)) {
    return { ok: false, reason: "toolchain_profile_incomplete" };
  }

  return {
    ok: true,
    toolchain: {
      id: deriveToolchainId(selected.version),
      family: "gcc",
      version: selected.version,
      source,
      sdkRoot: hasSafeToolchainPath(params.snapshot.sdkRoot) ? params.snapshot.sdkRoot : undefined,
      driver,
      driverPrefixPolicy,
      cc1Prefix,
      gccBinPrefix,
      internalIncludeDirs,
      asPath: selected.asPath,
      ldPath: selected.ldPath,
      runtimeLibgcc: selected.runtimeLibgcc,
      runtimeLibgccEh: selected.runtimeLibgccEh,
      crtbeginPath: selected.crtbeginPath,
      crtendPath: selected.crtendPath,
      libraryDirs
    }
  };
}

function resolveProjectVbccToolchain(params: {
  snapshot: ToolchainDiscoverySnapshot;
  source: ProjectToolchainSource;
}): { ok: true; toolchain: ResolvedProjectVbccToolchain } | { ok: false; reason: ResolveProjectToolchainReason } {
  if (params.snapshot.vbccStatus !== "present") {
    return { ok: false, reason: "vbcc_not_discovered" };
  }
  if ((params.snapshot.vbccDriverCommand || "").trim().toLowerCase() !== "vc") {
    return { ok: false, reason: "toolchain_profile_incomplete" };
  }
  if (!hasSafeToolchainPath(params.snapshot.vbccDriverPath)) {
    return { ok: false, reason: "toolchain_profile_incomplete" };
  }
  if (!hasSafeToolchainPath(params.snapshot.vbccLinkerPath)) {
    return { ok: false, reason: "toolchain_profile_incomplete" };
  }
  return {
    ok: true,
    toolchain: {
      id: "vbcc-os4",
      family: "vbcc",
      source: params.source,
      version: params.snapshot.vbccVersion && params.snapshot.vbccVersion !== "unknown" ? params.snapshot.vbccVersion : "unknown",
      driverCommand: "vc",
      driverPath: params.snapshot.vbccDriverPath,
      compilerCommand: "vbccppc",
      normalBuildAssembler: "vasmppc_std",
      linkerCommand: "vlink",
      linkerPath: params.snapshot.vbccLinkerPath,
      supportedStandards: ["c90", "c99"]
    }
  };
}

export function resolveProjectToolchain(params: {
  snapshot: ToolchainDiscoverySnapshot;
  toolchainId?: string;
}): { ok: true; toolchain: ResolvedProjectToolchainProfile } | { ok: false; reason: ResolveProjectToolchainReason } {
  const requested = params.toolchainId?.trim();
  if (requested && !isValidProjectToolchainId(requested)) {
    return { ok: false, reason: "toolchain_identity_invalid" };
  }
  const source: ProjectToolchainSource = requested ? "explicit" : "default_active";

  if (requested && isValidVbccProjectToolchainId(requested)) {
    return resolveProjectVbccToolchain({ snapshot: params.snapshot, source });
  }
  return resolveProjectGccToolchainInternal({
    snapshot: params.snapshot,
    toolchainId: requested
  });
}

export function resolveProjectGccToolchain(params: {
  snapshot: ToolchainDiscoverySnapshot;
  toolchainId?: string;
}): { ok: true; toolchain: ResolvedProjectGccToolchain } | { ok: false; reason: ResolveProjectGccToolchainReason } {
  return resolveProjectGccToolchainInternal(params);
}

function parseBoundedCount(raw: string | undefined, max: number, key: string): number {
  if (!raw || !/^[0-9]+$/.test(raw)) {
    throw new Error(`${key}_invalid`);
  }
  const value = Number.parseInt(raw, 10);
  if (value < 0 || value > max) {
    throw new Error(`${key}_out_of_range`);
  }
  return value;
}

function parseDiscoveryStatus(raw: string | undefined, key: string): DiscoveryStatus {
  if (
    raw === "present" ||
    raw === "missing" ||
    raw === "unknown" ||
    raw === "broken_symlink" ||
    raw === "symlink"
  ) {
    return raw;
  }
  throw new Error(`${key}_invalid`);
}

function parseIncludeKind(raw: string | undefined): IncludePathKind {
  if (
    raw === "gcc-internal" ||
    raw === "gcc-include-fixed" ||
    raw === "sdk-newlib" ||
    raw === "sdk-local" ||
    raw === "other-known" ||
    raw === "unknown"
  ) {
    return raw;
  }
  return "unknown";
}

function parseIncludeProbeStream(raw: string | undefined): "stdout" | "stderr" | "none" | "unknown" {
  if (raw === "stdout" || raw === "stderr" || raw === "none" || raw === "unknown") {
    return raw;
  }
  return "unknown";
}

function parseIncludeDiscoveryStatus(raw: string | undefined): "found" | "empty" | "probe_failed" | "unknown" {
  if (raw === "found" || raw === "empty" || raw === "probe_failed" || raw === "unknown") {
    return raw;
  }
  return "unknown";
}

function requireField(fields: Record<string, string>, key: string): string {
  const value = fields[key];
  if (value === undefined) {
    throw new Error(`${key}_missing`);
  }
  return value;
}

export function validateDiscoveryArtifactText(raw: string): void {
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (line.length > OS4TB_DISCOVERY_MAX_LINE_LENGTH) {
      throw new Error("discovery_line_too_long");
    }
  }
}

export function parseToolchainDiscoveryArtifact(fields: Record<string, string>): ToolchainDiscoverySnapshot {
  const rawSchemaVersion = fields.OS4TB_DISCOVERY_VERSION;
  if (!rawSchemaVersion || !/^[0-9]+$/.test(rawSchemaVersion)) {
    throw new Error("OS4TB_DISCOVERY_VERSION_invalid");
  }
  const schemaVersion = Number.parseInt(rawSchemaVersion, 10);
  if (schemaVersion !== OS4TB_DISCOVERY_SCHEMA_VERSION) {
    throw new Error("discovery_schema_version_unsupported");
  }

  const sdkStatus = parseDiscoveryStatus(requireField(fields, "OS4TB_SDK_STATUS"), "OS4TB_SDK_STATUS");
  const sdkRoot = requireField(fields, "OS4TB_SDK_ROOT");
  const gccAssign = fields.OS4TB_GCC_ASSIGN ?? "unknown";
  const libAssign = fields.OS4TB_LIB_ASSIGN ?? "unknown";
  const gccActiveFrontend = fields.OS4TB_GCC_ACTIVE_FRONTEND ?? "unknown";
  const gccActiveVersion = fields.OS4TB_GCC_ACTIVE_VERSION ?? "unknown";
  const vbccStatus = parseDiscoveryStatus(fields.OS4TB_VBCC_STATUS ?? "unknown", "OS4TB_VBCC_STATUS");
  const vbccVersion = fields.OS4TB_VBCC_VERSION ?? "unknown";
  const vbccDriverCommand = fields.OS4TB_VBCC_DRIVER_COMMAND ?? "unknown";
  const vbccDriverPath = fields.OS4TB_VBCC_DRIVER_PATH ?? "unknown";
  const vbccLinkerStatus = parseDiscoveryStatus(fields.OS4TB_VBCC_LINKER_STATUS ?? "unknown", "OS4TB_VBCC_LINKER_STATUS");
  const vbccLinkerPath = fields.OS4TB_VBCC_LINKER_PATH ?? "unknown";
  const vbccAssemblerStatus = parseDiscoveryStatus(fields.OS4TB_VBCC_ASSEMBLER_STATUS ?? "unknown", "OS4TB_VBCC_ASSEMBLER_STATUS");
  const vbccAssemblerPath = fields.OS4TB_VBCC_ASSEMBLER_PATH ?? "unknown";
  if (
    (vbccDriverPath !== "unknown" && !hasSafeToolchainPath(vbccDriverPath)) ||
    (vbccLinkerPath !== "unknown" && !hasSafeToolchainPath(vbccLinkerPath)) ||
    (vbccAssemblerPath !== "unknown" && !hasSafeToolchainPath(vbccAssemblerPath))
  ) {
    throw new Error("vbcc_path_invalid");
  }
  const asStatus = parseDiscoveryStatus(fields.OS4TB_AS_STATUS ?? "unknown", "OS4TB_AS_STATUS");
  const asPath = fields.OS4TB_AS_PATH ?? "unknown";
  const asVersion = fields.OS4TB_AS_VERSION ?? "unknown";
  const ldStatus = parseDiscoveryStatus(fields.OS4TB_LD_STATUS ?? "unknown", "OS4TB_LD_STATUS");
  const ldPath = fields.OS4TB_LD_PATH ?? "unknown";
  const ldVersion = fields.OS4TB_LD_VERSION ?? "unknown";
  const gccCount = parseBoundedCount(fields.OS4TB_GCC_COUNT, OS4TB_DISCOVERY_MAX_GCC, "OS4TB_GCC_COUNT");

  const gccToolchains: DiscoveredGccToolchain[] = [];
  for (let i = 0; i < gccCount; i += 1) {
    const prefix = `OS4TB_GCC_${i}_`;
    const includeCount = parseBoundedCount(
      fields[`${prefix}INCLUDE_COUNT`],
      OS4TB_DISCOVERY_MAX_INCLUDE_DIRS,
      `${prefix}INCLUDE_COUNT`
    );
    const libraryDirCount = parseBoundedCount(
      fields[`${prefix}LIBRARY_DIR_COUNT`],
      OS4TB_DISCOVERY_MAX_LIBRARY_DIRS,
      `${prefix}LIBRARY_DIR_COUNT`
    );
    const libraryInventoryCount = parseBoundedCount(
      fields[`${prefix}LIBRARY_INVENTORY_COUNT`] ?? "0",
      OS4TB_DISCOVERY_MAX_LIBRARY_INVENTORY,
      `${prefix}LIBRARY_INVENTORY_COUNT`
    );
    const internalIncludeDirCount = parseBoundedCount(
      fields[`${prefix}INTERNAL_INCLUDE_DIR_COUNT`] ?? "0",
      OS4TB_DISCOVERY_MAX_INTERNAL_INCLUDE_DIRS,
      `${prefix}INTERNAL_INCLUDE_DIR_COUNT`
    );
    const includePaths: string[] = [];
    const includePathKinds: IncludePathKind[] = [];
    const internalIncludeDirs: string[] = [];
    const libraryDirs: string[] = [];
    const libraryInventory: string[] = [];

    for (let j = 0; j < includeCount; j += 1) {
      includePaths.push(requireField(fields, `${prefix}INCLUDE_${j}`));
      includePathKinds.push(parseIncludeKind(fields[`${prefix}INCLUDE_${j}_KIND`]));
    }
    for (let j = 0; j < libraryDirCount; j += 1) {
      libraryDirs.push(requireField(fields, `${prefix}LIBRARY_DIR_${j}`));
    }
    for (let j = 0; j < libraryInventoryCount; j += 1) {
      libraryInventory.push(requireField(fields, `${prefix}LIBRARY_INVENTORY_${j}`));
    }
    for (let j = 0; j < internalIncludeDirCount; j += 1) {
      internalIncludeDirs.push(requireField(fields, `${prefix}INTERNAL_INCLUDE_DIR_${j}`));
    }

    gccToolchains.push({
      index: i,
      status: parseDiscoveryStatus(fields[`${prefix}STATUS`] ?? "unknown", `${prefix}STATUS`),
      version: fields[`${prefix}VERSION`] ?? "unknown",
      driver: fields[`${prefix}DRIVER`] ?? "unknown",
      cc1Path: fields[`${prefix}CC1`] ?? "unknown",
      asPath: fields[`${prefix}AS`] ?? "unknown",
      ldPath: fields[`${prefix}LD`] ?? "unknown",
      includePaths,
      includePathKinds,
      includeProbeStream: parseIncludeProbeStream(fields[`${prefix}INCLUDE_PROBE_STREAM`] ?? "unknown"),
      includeDiscoveryStatus: parseIncludeDiscoveryStatus(fields[`${prefix}INCLUDE_DISCOVERY_STATUS`] ?? "unknown"),
      includeProbeStdoutHasBlock: fields[`${prefix}INCLUDE_PROBE_STDOUT_HAS_BLOCK`] === "1",
      includeProbeStderrHasBlock: fields[`${prefix}INCLUDE_PROBE_STDERR_HAS_BLOCK`] === "1",
      internalIncludeDirs,
      internalStddefDir: fields[`${prefix}INTERNAL_STDDEF_DIR`] ?? "unknown",
      internalStdargDir: fields[`${prefix}INTERNAL_STDARG_DIR`] ?? "unknown",
      internalStdintDir: fields[`${prefix}INTERNAL_STDINT_DIR`] ?? "unknown",
      libraryDirs,
      libraryInventory,
      libraryInventoryTruncated: fields[`${prefix}LIBRARY_INVENTORY_TRUNCATED`] === "1",
      runtimeLibgcc: fields[`${prefix}RUNTIME_LIBGCC`] ?? "unknown",
      runtimeLibgccStatus: parseDiscoveryStatus(fields[`${prefix}RUNTIME_LIBGCC_STATUS`] ?? "unknown", `${prefix}RUNTIME_LIBGCC_STATUS`),
      runtimeLibgccEh: fields[`${prefix}RUNTIME_LIBGCC_EH`] ?? "unknown",
      runtimeLibgccEhStatus: parseDiscoveryStatus(
        fields[`${prefix}RUNTIME_LIBGCC_EH_STATUS`] ?? "unknown",
        `${prefix}RUNTIME_LIBGCC_EH_STATUS`
      ),
      crtbeginPath: fields[`${prefix}CRTBEGIN`] ?? "unknown",
      crtbeginStatus: parseDiscoveryStatus(fields[`${prefix}CRTBEGIN_STATUS`] ?? "unknown", `${prefix}CRTBEGIN_STATUS`),
      crtendPath: fields[`${prefix}CRTEND`] ?? "unknown",
      crtendStatus: parseDiscoveryStatus(fields[`${prefix}CRTEND_STATUS`] ?? "unknown", `${prefix}CRTEND_STATUS`)
    });
  }

  return {
    schemaVersion,
    sdkStatus,
    sdkRoot,
    gccAssign,
    libAssign,
    gccActiveFrontend,
    gccActiveVersion,
    gccToolchains,
    vbccStatus,
    vbccVersion,
    vbccDriverCommand,
    vbccDriverPath,
    vbccLinkerStatus,
    vbccLinkerPath,
    vbccAssemblerStatus,
    vbccAssemblerPath,
    asStatus,
    asPath,
    asVersion,
    ldStatus,
    ldPath,
    ldVersion
  };
}

export function buildToolchainDiscoverySummary(snapshot: ToolchainDiscoverySnapshot): string {
  const primaryGcc = snapshot.gccToolchains[0];
  const gccVersion = primaryGcc ? primaryGcc.version : "missing";
  const includeCount = primaryGcc ? primaryGcc.includePaths.length : 0;
  const libraryDirCount = primaryGcc ? primaryGcc.libraryDirs.length : 0;
  const libraryInventoryCount = primaryGcc ? primaryGcc.libraryInventory.length : 0;
  const vbccSummary = snapshot.vbccStatus === "present" ? "detected" : "not detected";
  const asSummary = snapshot.asStatus === "present" ? "detected" : "not detected";
  const ldSummary = snapshot.ldStatus === "present" ? "detected" : "not detected";
  return [
    "AmigaOS 4 SDK discovery complete",
    `SDK: ${snapshot.sdkRoot} (${snapshot.sdkStatus})`,
    `GCC: ${gccVersion} (count=${snapshot.gccToolchains.length})`,
    `VBCC: ${vbccSummary} (${snapshot.vbccDriverCommand})`,
    `Assembler: ${asSummary}`,
    `Linker: ${ldSummary}`,
    `Include paths: ${includeCount}`,
    `Library dirs: ${libraryDirCount}`,
    `Libraries discovered: ${libraryInventoryCount}`
  ].join("\n");
}
