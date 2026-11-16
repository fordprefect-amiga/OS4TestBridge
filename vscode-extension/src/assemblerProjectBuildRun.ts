import { ToolchainDiscoverySnapshot } from "./toolchainDiscovery";

export const OS4TB_ASM_PROJECT_MAX_SOURCES = 8;
export const OS4TB_ASM_PROJECT_MAX_INCLUDES = 4;
export const OS4TB_ASM_PROJECT_MAX_DEFINES = 16;
export const OS4TB_ASM_PROJECT_MAX_TOOLCHAIN_TEXT = 320;
export const OS4TB_ASM_PROJECT_MAX_ID = 32;

const SAFE_RELATIVE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const SAFE_DEFINE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(=[A-Za-z0-9_.+-]+)?$/;

export type ProjectAssemblerId = "gnu-as-os4" | "vasm-ppc-std";
export type ProjectAssemblerFamily = "gnu_as" | "vasm";
export type ProjectLinkerModel = "vlink";

export interface ResolvedAssemblerCommon {
  id: ProjectAssemblerId;
  family: ProjectAssemblerFamily;
  displayName: string;
  availability: "present";
  assemblerPath: string;
  version: string;
  objectFormat: "elf32-powerpc";
  linkerModel: ProjectLinkerModel;
  linkerPath: string;
}

export interface ResolvedGnuAssembler extends ResolvedAssemblerCommon {
  id: "gnu-as-os4";
  family: "gnu_as";
  defineModel: "--defsym";
}

export interface ResolvedVasmAssembler extends ResolvedAssemblerCommon {
  id: "vasm-ppc-std";
  family: "vasm";
  defineModel: "-D";
}

export type ResolvedProjectAssembler = ResolvedGnuAssembler | ResolvedVasmAssembler;

export type ResolveProjectAssemblerReason =
  | "assembler_identity_invalid"
  | "assembler_not_discovered"
  | "assembler_profile_invalid";

function hasSafeToolPath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= OS4TB_ASM_PROJECT_MAX_TOOLCHAIN_TEXT &&
    value !== "unknown" &&
    !/(^|\/)\.\.(\/|$)/.test(value) &&
    /^[A-Za-z0-9:/._+-]+$/.test(value)
  );
}

export function isValidProjectAssemblerId(value: string): value is ProjectAssemblerId {
  return value === "gnu-as-os4" || value === "vasm-ppc-std";
}

export function resolveProjectAssembler(params: {
  snapshot: ToolchainDiscoverySnapshot;
  assemblerId: string;
}): { ok: true; assembler: ResolvedProjectAssembler } | { ok: false; reason: ResolveProjectAssemblerReason } {
  if (!isValidProjectAssemblerId(params.assemblerId)) {
    return { ok: false, reason: "assembler_identity_invalid" };
  }
  if (params.assemblerId === "gnu-as-os4") {
    if (params.snapshot.asStatus !== "present" || !hasSafeToolPath(params.snapshot.asPath)) {
      return { ok: false, reason: "assembler_not_discovered" };
    }
    if (params.snapshot.vbccLinkerStatus !== "present" || !hasSafeToolPath(params.snapshot.vbccLinkerPath)) {
      return { ok: false, reason: "assembler_profile_invalid" };
    }
    return {
      ok: true,
      assembler: {
        id: "gnu-as-os4",
        family: "gnu_as",
        displayName: "GNU as (OS4)",
        availability: "present",
        assemblerPath: params.snapshot.asPath,
        version: params.snapshot.asVersion || "unknown",
        objectFormat: "elf32-powerpc",
        linkerModel: "vlink",
        linkerPath: params.snapshot.vbccLinkerPath,
        defineModel: "--defsym"
      }
    };
  }

  if (params.snapshot.vbccAssemblerStatus !== "present" || !hasSafeToolPath(params.snapshot.vbccAssemblerPath)) {
    return { ok: false, reason: "assembler_not_discovered" };
  }
  if (params.snapshot.vbccLinkerStatus !== "present" || !hasSafeToolPath(params.snapshot.vbccLinkerPath)) {
    return { ok: false, reason: "assembler_profile_invalid" };
  }
  return {
    ok: true,
    assembler: {
      id: "vasm-ppc-std",
      family: "vasm",
      displayName: "VASM PPC STD",
      availability: "present",
      assemblerPath: params.snapshot.vbccAssemblerPath,
      version: params.snapshot.vbccVersion || "unknown",
      objectFormat: "elf32-powerpc",
      linkerModel: "vlink",
      linkerPath: params.snapshot.vbccLinkerPath,
      defineModel: "-D"
    }
  };
}

export function isValidAssemblerRelativePath(token: string, ext: ".s" | ".S"): boolean {
  if (token.length === 0 || token.length > 160) {
    return false;
  }
  if (token.startsWith("/") || token.endsWith("/") || token.includes("\\") || token.includes(":") || token.includes("//")) {
    return false;
  }
  if (/(^|\/)\.\.(\/|$)/.test(token)) {
    return false;
  }
  const segments = token.split("/");
  if (segments.length === 0 || segments.length > 4) {
    return false;
  }
  for (const segment of segments) {
    if (segment.length === 0 || segment.length > 64 || !SAFE_RELATIVE_SEGMENT_PATTERN.test(segment)) {
      return false;
    }
  }
  return token.endsWith(ext);
}

export function validateAssemblerDefines(defines: string[]): boolean {
  if (defines.length > OS4TB_ASM_PROJECT_MAX_DEFINES) {
    return false;
  }
  return defines.every((entry) => SAFE_DEFINE_PATTERN.test(entry) && entry.length <= 96);
}

export function buildGuestAssemblerManifestText(params: {
  assembler: ResolvedProjectAssembler;
  sources: string[];
  includes: string[];
  defines: string[];
  runProgram?: "yes" | "no";
}): string {
  if (params.sources.length === 0 || params.sources.length > OS4TB_ASM_PROJECT_MAX_SOURCES) {
    throw new Error("source_count_out_of_range");
  }
  if (params.includes.length > OS4TB_ASM_PROJECT_MAX_INCLUDES) {
    throw new Error("include_count_out_of_range");
  }
  if (!validateAssemblerDefines(params.defines)) {
    throw new Error("define_invalid");
  }

  const lines: string[] = [];
  lines.push(`ASSEMBLER_ID=${params.assembler.id}`);
  lines.push(`ASSEMBLER_FAMILY=${params.assembler.family}`);
  lines.push(`ASSEMBLER_PATH=${params.assembler.assemblerPath}`);
  lines.push(`LINKER_MODEL=${params.assembler.linkerModel}`);
  lines.push(`LINKER_PATH=${params.assembler.linkerPath}`);
  lines.push(`OBJECT_FORMAT=${params.assembler.objectFormat}`);
  lines.push(`SOURCE_COUNT=${params.sources.length}`);
  params.sources.forEach((entry, index) => lines.push(`SOURCE_${index}=${entry}`));
  lines.push(`INCLUDE_COUNT=${params.includes.length}`);
  params.includes.forEach((entry, index) => lines.push(`INCLUDE_${index}=${entry}`));
  lines.push(`DEFINE_COUNT=${params.defines.length}`);
  params.defines.forEach((entry, index) => lines.push(`DEFINE_${index}=${entry}`));
  lines.push(`RUN_PROGRAM=${params.runProgram ?? "yes"}`);
  lines.push("");
  return lines.join("\n");
}
