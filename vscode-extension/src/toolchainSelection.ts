import { resolveProjectToolchain, ToolchainDiscoverySnapshot } from "./toolchainDiscovery";

export const SELECT_PROJECT_TOOLCHAIN_COMMAND_ID = "os4TestBridge.selectProjectToolchain";

export type ProjectToolchainSelectionKind = "automatic" | "gcc" | "vbcc" | "unavailable";

export interface ProjectToolchainSelectionItem {
  selectionKind: ProjectToolchainSelectionKind;
  label: string;
  description: string;
  detail: string;
  toolchainId?: string;
}

function parseGccToolchainVersion(toolchainId: string): string | undefined {
  const match = /^gcc-(\d+\.\d+\.\d+)$/.exec(toolchainId);
  return match?.[1];
}

function compareVersionsDesc(a: string, b: string): number {
  const aParts = a.split(".").map((part) => Number(part));
  const bParts = b.split(".").map((part) => Number(part));
  for (let i = 0; i < 3; i += 1) {
    const diff = (bParts[i] ?? 0) - (aParts[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function buildProjectToolchainSelectionItems(
  snapshot: ToolchainDiscoverySnapshot,
  currentToolchainId?: string
): ProjectToolchainSelectionItem[] {
  const items: ProjectToolchainSelectionItem[] = [];
  const discoveredGcc = snapshot.gccToolchains
    .filter((entry) => entry.status === "present")
    .slice()
    .sort((a, b) => compareVersionsDesc(a.version, b.version));
  const discoveredIds = new Set(discoveredGcc.map((entry) => `gcc-${entry.version}`));
  const vbccResolved = resolveProjectToolchain({ snapshot, toolchainId: "vbcc-os4" });
  const hasDiscoveredVbcc = vbccResolved.ok && vbccResolved.toolchain.family === "vbcc";
  if (hasDiscoveredVbcc) {
    discoveredIds.add("vbcc-os4");
  }
  const automaticSelected = !currentToolchainId;

  items.push({
    selectionKind: "automatic",
    label: "Automatic",
    description: automaticSelected ? "Current project selection" : "",
    detail: snapshot.gccActiveVersion ? `Use current active discovered GCC (gcc-${snapshot.gccActiveVersion})` : ""
  });

  if (currentToolchainId && !discoveredIds.has(currentToolchainId)) {
    items.push({
      selectionKind: "unavailable",
      label: `${currentToolchainId} (currently selected, unavailable)`,
      description: "Not discovered on current target",
      detail: "Select Automatic or a discovered toolchain."
    });
  }

  for (const entry of discoveredGcc) {
    const id = `gcc-${entry.version}`;
    items.push({
      selectionKind: "gcc",
      label: `GCC ${entry.version}`,
      description: currentToolchainId === id ? "Current project selection" : "",
      detail: snapshot.gccActiveVersion === entry.version ? "Active discovered GCC" : "",
      toolchainId: id
    });
  }
  if (hasDiscoveredVbcc) {
    items.push({
      selectionKind: "vbcc",
      label: "VBCC",
      description: currentToolchainId === "vbcc-os4" ? "Current project selection" : "",
      detail: "Explicit VBCC toolchain",
      toolchainId: "vbcc-os4"
    });
  }

  return items;
}

export function resolveSelectionToolchainId(item: ProjectToolchainSelectionItem): string | undefined {
  if (item.selectionKind === "automatic") {
    return undefined;
  }
  if (item.selectionKind === "gcc" && item.toolchainId) {
    return item.toolchainId;
  }
  if (item.selectionKind === "vbcc" && item.toolchainId) {
    return item.toolchainId;
  }
  return undefined;
}

export function formatProjectToolchainStatusLabel(
  hasProject: boolean,
  currentToolchainId: string | undefined,
  snapshot: ToolchainDiscoverySnapshot | undefined,
  preferenceError?: "manifest_duplicate_toolchain" | "toolchain_id_invalid" | "manifest_read_failed"
): string {
  if (!hasProject) {
    return "No project";
  }
  if (preferenceError) {
    if (preferenceError === "manifest_read_failed") {
      return "Manifest read failed";
    }
    return preferenceError === "manifest_duplicate_toolchain" ? "Manifest error (duplicate toolchain)" : "Manifest error (invalid toolchain)";
  }
  if (!snapshot) {
    return "Discovery unavailable";
  }
  if (!currentToolchainId) {
    if (snapshot.gccActiveVersion) {
      return `Auto (GCC ${snapshot.gccActiveVersion})`;
    }
    return "Auto";
  }
  if (currentToolchainId === "vbcc-os4") {
    const vbccResolved = resolveProjectToolchain({ snapshot, toolchainId: "vbcc-os4" });
    if (vbccResolved.ok && vbccResolved.toolchain.family === "vbcc") {
      return "VBCC";
    }
    return "VBCC (!unavailable)";
  }
  const version = parseGccToolchainVersion(currentToolchainId);
  if (!version) {
    return `${currentToolchainId} (!invalid)`;
  }
  const discovered = snapshot.gccToolchains.some((entry) => entry.version === version);
  if (discovered) {
    return `GCC ${version}`;
  }
  return `GCC ${version} (!unavailable)`;
}
