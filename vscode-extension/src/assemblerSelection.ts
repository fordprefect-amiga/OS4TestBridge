import { resolveProjectAssembler } from "./assemblerProjectBuildRun";
import { ToolchainDiscoverySnapshot } from "./toolchainDiscovery";

export const SELECT_PROJECT_ASSEMBLER_COMMAND_ID = "os4TestBridge.selectProjectAssembler";

export type ProjectAssemblerSelectionKind = "automatic" | "gnu" | "vasm" | "unavailable";

export interface ProjectAssemblerSelectionItem {
  selectionKind: ProjectAssemblerSelectionKind;
  label: string;
  description: string;
  detail: string;
  assemblerId?: "gnu-as-os4" | "vasm-ppc-std";
}

function discoveredAssemblerSet(snapshot: ToolchainDiscoverySnapshot): Set<string> {
  const ids = new Set<string>();
  if (snapshot.asStatus === "present" && snapshot.asPath !== "unknown") {
    ids.add("gnu-as-os4");
  }
  if (snapshot.vbccAssemblerStatus === "present" && snapshot.vbccAssemblerPath !== "unknown") {
    ids.add("vasm-ppc-std");
  }
  return ids;
}

export function resolveAutomaticProjectAssemblerId(snapshot: ToolchainDiscoverySnapshot): "gnu-as-os4" | "vasm-ppc-std" | undefined {
  if (snapshot.asStatus === "present" && snapshot.asPath !== "unknown") {
    return "gnu-as-os4";
  }
  if (snapshot.vbccAssemblerStatus === "present" && snapshot.vbccAssemblerPath !== "unknown") {
    return "vasm-ppc-std";
  }
  return undefined;
}

export function formatAssemblerDisplayName(assemblerId: string): string {
  if (assemblerId === "gnu-as-os4") {
    return "GNU Assembler";
  }
  if (assemblerId === "vasm-ppc-std") {
    return "VASM PPC Standard";
  }
  return assemblerId;
}

export function buildProjectAssemblerSelectionItems(
  snapshot: ToolchainDiscoverySnapshot,
  currentAssemblerId?: string
): ProjectAssemblerSelectionItem[] {
  const discovered = discoveredAssemblerSet(snapshot);
  const items: ProjectAssemblerSelectionItem[] = [];
  const autoSelected = !currentAssemblerId;
  const autoResolved = resolveAutomaticProjectAssemblerId(snapshot);
  items.push({
    selectionKind: "automatic",
    label: "Automatic",
    description: autoSelected ? "Current project selection" : "",
    detail: autoResolved ? `Automatic → ${formatAssemblerDisplayName(autoResolved)}` : "Automatic unavailable (no discovered assembler)"
  });

  if (currentAssemblerId && !discovered.has(currentAssemblerId)) {
    items.push({
      selectionKind: "unavailable",
      label: `${formatAssemblerDisplayName(currentAssemblerId)} (currently selected, unavailable)`,
      description: "Not discovered on current target",
      detail: "Select Automatic or a discovered assembler."
    });
  }

  if (discovered.has("gnu-as-os4")) {
    items.push({
      selectionKind: "gnu",
      label: "GNU Assembler",
      description: currentAssemblerId === "gnu-as-os4" ? "Current project selection" : "",
      detail: "Explicit GNU assembler profile",
      assemblerId: "gnu-as-os4"
    });
  }
  if (discovered.has("vasm-ppc-std")) {
    items.push({
      selectionKind: "vasm",
      label: "VASM PPC Standard",
      description: currentAssemblerId === "vasm-ppc-std" ? "Current project selection" : "",
      detail: "Explicit VASM profile",
      assemblerId: "vasm-ppc-std"
    });
  }

  return items;
}

export function resolveSelectionAssemblerId(item: ProjectAssemblerSelectionItem): "gnu-as-os4" | "vasm-ppc-std" | undefined {
  if (item.selectionKind === "automatic") {
    return undefined;
  }
  if ((item.selectionKind === "gnu" || item.selectionKind === "vasm") && item.assemblerId) {
    return item.assemblerId;
  }
  return undefined;
}

export function formatProjectAssemblerStatusLabel(
  hasProject: boolean,
  currentAssemblerId: string | undefined,
  snapshot: ToolchainDiscoverySnapshot | undefined,
  preferenceError?: "manifest_duplicate_assembler" | "assembler_id_invalid" | "manifest_read_failed"
): string {
  if (!hasProject) {
    return "No project";
  }
  if (preferenceError) {
    if (preferenceError === "manifest_read_failed") {
      return "Manifest read failed";
    }
    return preferenceError === "manifest_duplicate_assembler"
      ? "Manifest error (duplicate assembler)"
      : "Manifest error (invalid assembler)";
  }
  if (!snapshot) {
    return "Discovery unavailable";
  }
  if (!currentAssemblerId) {
    const autoId = resolveAutomaticProjectAssemblerId(snapshot);
    return autoId ? `Auto (${formatAssemblerDisplayName(autoId)})` : "Auto (!unavailable)";
  }
  const resolved = resolveProjectAssembler({ snapshot, assemblerId: currentAssemblerId });
  if (resolved.ok) {
    return formatAssemblerDisplayName(currentAssemblerId);
  }
  return `${formatAssemblerDisplayName(currentAssemblerId)} (!unavailable)`;
}
