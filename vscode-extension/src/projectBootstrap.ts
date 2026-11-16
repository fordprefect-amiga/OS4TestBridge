import * as path from "node:path";
import {
  OS4TB_GCC_PROJECT_MAX_SOURCES,
  OS4TB_GCC_PROJECT_MIN_SOURCES,
  classifyProjectSourceRelativePath,
  isValidProjectRelativePath
} from "./gccProjectBuildRun";

export const BOOTSTRAP_SOURCE_GLOB = "**/*.{c,s}";
export const BOOTSTRAP_SOURCE_SEARCH_MAX_RESULTS = 256;
export const BOOTSTRAP_SOURCE_EXCLUDE_GLOB = "**/{.git,node_modules,.artifacts,build,dist,out,coverage}/**";

export interface TargetConfigStatusPresentation {
  label: string;
  tooltip: string;
}

export function buildTargetConfigStatusPresentation(configPath: string): TargetConfigStatusPresentation {
  if (configPath.length === 0) {
    return {
      label: "OS4TB: No target config",
      tooltip: "No target configuration selected. Use OS4 Test Bridge: Select Target Configuration."
    };
  }
  return {
    label: `OS4TB: ${path.basename(configPath) || "target.conf"}`,
    tooltip: `Target configuration: ${configPath}`
  };
}

export function buildMissingTargetConfigStatusPresentation(configPath: string): TargetConfigStatusPresentation {
  return {
    label: "OS4TB: Config unavailable",
    tooltip: `Configured target not found: ${configPath}`
  };
}

export type BootstrapSourceKind = "c" | "asm";

export interface BootstrapSourceSelection {
  relativePath: string;
  sourceKind: BootstrapSourceKind;
}

function isExcludedDirectorySegment(segment: string): boolean {
  return (
    segment === ".git" ||
    segment === "node_modules" ||
    segment === ".artifacts" ||
    segment === "build" ||
    segment === "dist" ||
    segment === "out" ||
    segment === "coverage"
  );
}

export function toProjectRelativePath(rootPath: string, filePath: string): string | undefined {
  const relativePath = path.relative(rootPath, filePath).split(path.sep).join("/");
  if (relativePath.length === 0 || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    return undefined;
  }
  return relativePath;
}

export function classifyBootstrapSourceRelativePath(relativePath: string): BootstrapSourceKind | "exclude" | "invalid" {
  const segments = relativePath.split("/");
  if (segments.some((segment) => isExcludedDirectorySegment(segment))) {
    return "exclude";
  }
  const sourceKind = classifyProjectSourceRelativePath(relativePath);
  if (sourceKind !== "c" && sourceKind !== "asm") {
    return "invalid";
  }
  const extension = sourceKind === "c" ? ".c" : ".s";
  if (!isValidProjectRelativePath(relativePath, extension)) {
    return "invalid";
  }
  return sourceKind;
}

export function normalizeBootstrapSourceSelection(relativePaths: string[]): BootstrapSourceSelection[] {
  const deduped = new Set(relativePaths.map((entry) => entry.trim()).filter((entry) => entry.length > 0));
  const accepted: BootstrapSourceSelection[] = [];
  for (const relativePath of deduped) {
    const sourceKind = classifyBootstrapSourceRelativePath(relativePath);
    if (sourceKind === "c" || sourceKind === "asm") {
      accepted.push({ relativePath, sourceKind });
    }
  }
  accepted.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return accepted;
}

export function hasMixedBootstrapSources(entries: BootstrapSourceSelection[]): boolean {
  let hasC = false;
  let hasAsm = false;
  for (const entry of entries) {
    if (entry.sourceKind === "c") {
      hasC = true;
    } else if (entry.sourceKind === "asm") {
      hasAsm = true;
    }
  }
  return hasC && hasAsm;
}

export function buildInitializedProjectManifestText(entries: BootstrapSourceSelection[]): string {
  if (entries.length < OS4TB_GCC_PROJECT_MIN_SOURCES) {
    throw new Error("bootstrap_source_count_too_small");
  }
  if (entries.length > OS4TB_GCC_PROJECT_MAX_SOURCES) {
    throw new Error("bootstrap_source_count_too_large");
  }
  const lines = entries.map((entry) => `source=${entry.relativePath}`);
  return `${lines.join("\n")}\n`;
}
