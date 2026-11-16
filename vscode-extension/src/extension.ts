import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { readUtf8FileWithEnoentRetry, resolveCompilerDiagnosticsPath } from "./gccDiagnosticsArtifact";
import { extractGccVersion, parseGccDiagnostics, summarizeGccDiagnostics } from "./gccDiagnostics";
import {
  buildExecutableBasename,
  evaluateBuildRunOutcome,
  parseBuildRunArtifactSummary,
  validateBuildRunDocument
} from "./gccBuildRun";
import {
  buildObjectBasename,
  buildStagedSourceBasename,
  evaluateCompileOutcome,
  parseCompileArtifactSummary,
  validateCompileDocument
} from "./gccCompile";
import {
  buildGuestProjectDirectoryPath,
  OS4TB_GCC_PROJECT_MAX_SOURCES,
  OS4TB_GCC_PROJECT_MIN_SOURCES,
  PROJECT_ASSEMBLER_GUEST_MANIFEST_FILENAME,
  buildGuestProjectManifestPath,
  PROJECT_MANIFEST_FILENAME,
  OS4TB_GCC_PROJECT_DEFAULT_C_STANDARD,
  OS4TB_GCC_PROJECT_DEFAULT_WARNING_LEVEL,
  OS4TB_GCC_PROJECT_DEFAULT_OPTIMIZATION,
  OS4TB_GCC_PROJECT_DEFAULT_DEBUG_SYMBOLS,
  buildGuestProjectManifestText,
  buildProjectStagedDirectoryBasename,
  buildProjectManifestBasename,
  buildProjectObjectBasename,
  buildProjectStagedSourceBasename,
  buildProjectStagedSourceBasenameForKind,
  classifyProjectSourceRelativePath,
  isValidProjectRelativePath,
  locateProjectManifestForActiveFile,
  ProjectBuildProfile,
  ProjectSourceKind,
  ProjectResolvedToolchainProfile,
  parseProjectManifestForActiveFile,
  readProjectAssemblerPreferenceForActiveFile,
  readProjectToolchainPreferenceForActiveFile,
  setProjectAssemblerPreferenceForActiveFile,
  setProjectToolchainPreferenceForActiveFile,
  resolveTwoFileProjectSources,
  writeProjectManifestAtomically
} from "./gccProjectBuildRun";
import { buildGuestAssemblerManifestText, resolveProjectAssembler } from "./assemblerProjectBuildRun";
import {
  buildProjectAssemblerSelectionItems,
  formatProjectAssemblerStatusLabel,
  ProjectAssemblerSelectionItem,
  resolveAutomaticProjectAssemblerId,
  resolveSelectionAssemblerId,
  SELECT_PROJECT_ASSEMBLER_COMMAND_ID
} from "./assemblerSelection";
import {
  buildProblemPublishPlan,
  normalizeSamdropIncomingPath,
  parseBridgeConfig,
  replaceProblemsCollection,
  selectProblemSummaryLabel,
  resolveIncomingDirectoryFromConfig
} from "./gccProblems";
import {
  deduplicateProjectDiagnostics,
  parseProjectDiagnosticsByFamily,
  summarizeProjectDiagnostics,
  type ProjectDiagnostic,
  type ProjectDiagnosticFamily
} from "./projectDiagnostics";
import { buildProjectProblemPublishPlan } from "./projectProblems";
import { Os4tbClient, Os4tbProcessResult } from "./os4tbClient";
import { evaluateRunContract, parseKeyValueOutput } from "./parser";
import {
  gccBuildRunProcessTimeoutMs,
  gccCompileProcessTimeoutMs,
  gccDiagnosticsProcessTimeoutMs,
  inspectToolchainsProcessTimeoutMs,
  resolveTimeoutSettings,
  timeoutMsForCommand
} from "./timeoutConfig";
import {
  createGeneratedRequest,
  validateRequiredPayloadSetting,
  WorkflowKind
} from "./requestBuilder";
import {
  buildToolchainDiscoverySummary,
  OS4TB_DISCOVERY_MAX_ARTIFACT_BYTES,
  parseToolchainDiscoveryArtifact,
  resolveProjectToolchain,
  ToolchainDiscoverySnapshot,
  validateDiscoveryArtifactText
} from "./toolchainDiscovery";
import {
  buildProjectToolchainSelectionItems,
  formatProjectToolchainStatusLabel,
  ProjectToolchainSelectionItem,
  resolveSelectionToolchainId,
  SELECT_PROJECT_TOOLCHAIN_COMMAND_ID
} from "./toolchainSelection";
import { buildWorkflowFailMessage, buildWorkflowPassMessage } from "./workflowMessages";
import {
  BOOTSTRAP_SOURCE_EXCLUDE_GLOB,
  BOOTSTRAP_SOURCE_GLOB,
  BOOTSTRAP_SOURCE_SEARCH_MAX_RESULTS,
  buildInitializedProjectManifestText,
  buildMissingTargetConfigStatusPresentation,
  buildTargetConfigStatusPresentation,
  hasMixedBootstrapSources,
  normalizeBootstrapSourceSelection,
  toProjectRelativePath,
  type BootstrapSourceSelection
} from "./projectBootstrap";

const OUTPUT_CHANNEL_NAME = "OS4 Test Bridge";
const SELECT_TARGET_CONFIGURATION_COMMAND_ID = "os4TestBridge.selectTargetConfiguration";
const INITIALIZE_PROJECT_COMMAND_ID = "os4TestBridge.initializeProject";
const DEFAULT_GCC_DIAGNOSTICS_PAYLOAD_NAME = "os4tb_gcc_diagnostics_probe";
const DEFAULT_GCC_PROJECT_BUILD_RUN_PAYLOAD_NAME = "os4tb_gcc_project_build_run_adapter";
const DEFAULT_VBCC_PROJECT_BUILD_RUN_PAYLOAD_NAME = "os4tb_vbcc_project_build_run_adapter";
const DEFAULT_ASSEMBLER_PROJECT_BUILD_RUN_PAYLOAD_NAME = "os4tb_assembler_project_build_run_adapter";
const DEFAULT_INSPECT_TOOLCHAINS_PAYLOAD_NAME = "os4tb_toolchain_discovery_probe";
const MISSING_HOST_BRIDGE_ERROR_PREFIX = "OS4 Test Bridge host CLI is not configured or was not found.";

type StatusState =
  | "Ready"
  | "Checking..."
  | "Running..."
  | "Running on OS4..."
  | "Running GCC diagnostics..."
  | "Compiling on OS4..."
  | "Building/running on OS4..."
  | "Validating..."
  | "PASS"
  | "FAIL";

interface ExtensionConfig {
  executablePath: string;
  configPath: string;
  defaultTimeoutMs: number;
  inspectToolchainsTimeoutSeconds: number;
  inspectToolchainsTimeoutMs: number;
  gccDiagnosticsTimeoutSeconds: number;
  gccDiagnosticsTimeoutMs: number;
  gccCompileTimeoutSeconds: number;
  gccCompileTimeoutMs: number;
  gccBuildRunTimeoutSeconds: number;
  gccBuildRunTimeoutMs: number;
  runPayloadName: string;
  validationPayloadName: string;
  gccDiagnosticsPayloadName: string;
  gccCompilePayloadName: string;
  gccBuildRunPayloadName: string;
  gccProjectBuildRunPayloadName: string;
  vbccProjectBuildRunPayloadName: string;
  assemblerProjectBuildRunPayloadName: string;
  inspectToolchainsPayloadName: string;
  generatedRequestDirectory: string;
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const targetConfigStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  const toolchainStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  const assemblerStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  const gccProblems = vscode.languages.createDiagnosticCollection("os4TestBridge.gcc");
  setStatus(status, "Ready");
  targetConfigStatus.command = SELECT_TARGET_CONFIGURATION_COMMAND_ID;
  targetConfigStatus.text = "OS4TB: No target config";
  targetConfigStatus.tooltip = "No target configuration selected.";
  toolchainStatus.command = SELECT_PROJECT_TOOLCHAIN_COMMAND_ID;
  toolchainStatus.text = "OS4TB Toolchain: No project";
  toolchainStatus.tooltip = "OS4TB project toolchain selection";
  assemblerStatus.command = SELECT_PROJECT_ASSEMBLER_COMMAND_ID;
  assemblerStatus.text = "OS4TB Assembler: No project";
  assemblerStatus.tooltip = "OS4TB project assembler selection";
  status.show();
  targetConfigStatus.show();
  toolchainStatus.show();
  assemblerStatus.show();

  const refreshProjectStatus = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.isUntitled || editor.document.uri.scheme !== "file") {
      toolchainStatus.text = "OS4TB Toolchain: No project";
      assemblerStatus.text = "OS4TB Assembler: No project";
      return;
    }
    const location = await locateProjectManifestForActiveFile(editor.document.uri.fsPath);
    if (!location) {
      toolchainStatus.text = "OS4TB Toolchain: No project";
      assemblerStatus.text = "OS4TB Assembler: No project";
      return;
    }
    const preference = await readProjectToolchainPreferenceForActiveFile(editor.document.uri.fsPath);
    const assemblerPreference = await readProjectAssemblerPreferenceForActiveFile(editor.document.uri.fsPath);
    const snapshot = await loadToolchainDiscoverySnapshotFromCache(context);
    const label = formatProjectToolchainStatusLabel(
      true,
      preference.toolchainId,
      snapshot,
      preference.reason === "manifest_duplicate_toolchain" ||
        preference.reason === "toolchain_id_invalid" ||
        preference.reason === "manifest_read_failed"
        ? preference.reason
        : undefined
    );
    const assemblerLabel = formatProjectAssemblerStatusLabel(
      true,
      assemblerPreference.assemblerId,
      snapshot,
      assemblerPreference.reason === "manifest_duplicate_assembler" ||
        assemblerPreference.reason === "assembler_id_invalid" ||
        assemblerPreference.reason === "manifest_read_failed"
        ? assemblerPreference.reason
        : undefined
    );
    toolchainStatus.text = `OS4TB Toolchain: ${label}`;
    assemblerStatus.text = `OS4TB Assembler: ${assemblerLabel}`;
  };

  const refreshTargetConfigStatus = async (): Promise<void> => {
    const cfg = getConfig();
    if (cfg.configPath.length === 0) {
      const presentation = buildTargetConfigStatusPresentation("");
      targetConfigStatus.text = presentation.label;
      targetConfigStatus.tooltip = presentation.tooltip;
      return;
    }
    try {
      const stat = await fs.stat(cfg.configPath);
      if (stat.isFile()) {
        const presentation = buildTargetConfigStatusPresentation(cfg.configPath);
        targetConfigStatus.text = presentation.label;
        targetConfigStatus.tooltip = presentation.tooltip;
        return;
      }
    } catch {
      // Missing/unreadable config is reported in status below.
    }
    const presentation = buildMissingTargetConfigStatusPresentation(cfg.configPath);
    targetConfigStatus.text = presentation.label;
    targetConfigStatus.tooltip = presentation.tooltip;
  };

  const refreshStatusIndicators = async (): Promise<void> => {
    await Promise.all([refreshProjectStatus(), refreshTargetConfigStatus()]);
  };

  void refreshStatusIndicators();

  context.subscriptions.push(
    output,
    status,
    targetConfigStatus,
    toolchainStatus,
    assemblerStatus,
    gccProblems,
    vscode.window.onDidChangeActiveTextEditor(() => {
      void refreshStatusIndicators();
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const active = vscode.window.activeTextEditor?.document;
      if (!active) {
        return;
      }
      if (active.uri.toString() === document.uri.toString()) {
        void refreshStatusIndicators();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("os4TestBridge.configPath")) {
        void refreshTargetConfigStatus();
      }
    }),
    vscode.commands.registerCommand("os4TestBridge.showVersion", async () => {
      await runVersionCommand(output, status);
    }),
    vscode.commands.registerCommand("os4TestBridge.checkTarget", async () => {
      await runCheckCommand(output, status);
    }),
    vscode.commands.registerCommand("os4TestBridge.runRequest", async (uri?: vscode.Uri) => {
      await runRequestCommand(output, status, uri);
    }),
    vscode.commands.registerCommand("os4TestBridge.runOnOS4", async () => {
      await runGeneratedWorkflowCommand(context, output, status, "run");
    }),
    vscode.commands.registerCommand("os4TestBridge.validateOnOS4", async () => {
      await runGeneratedWorkflowCommand(context, output, status, "validate");
    }),
    vscode.commands.registerCommand("os4TestBridge.testGccDiagnostics", async () => {
      await runGccDiagnosticsCommand(context, output, status, gccProblems);
    }),
    vscode.commands.registerCommand("os4TestBridge.compileCurrentFile", async () => {
      await runCompileCurrentFileCommand(context, output, status, gccProblems);
    }),
    vscode.commands.registerCommand("os4TestBridge.buildAndRunCurrentFile", async () => {
      await runBuildAndRunCurrentFileCommand(context, output, status, gccProblems);
    }),
    vscode.commands.registerCommand("os4TestBridge.buildAndRunMultiFileProject", async () => {
      await runBuildAndRunMultiFileProjectCommand(context, output, status, gccProblems);
    }),
    vscode.commands.registerCommand("os4TestBridge.buildAndRunProject", async () => {
      await runBuildAndRunProjectCommand(context, output, status, gccProblems);
    }),
    vscode.commands.registerCommand(SELECT_TARGET_CONFIGURATION_COMMAND_ID, async () => {
      await runSelectTargetConfigurationCommand(status);
      await refreshTargetConfigStatus();
    }),
    vscode.commands.registerCommand(INITIALIZE_PROJECT_COMMAND_ID, async () => {
      await runInitializeProjectCommand(output, status);
      await refreshStatusIndicators();
    }),
    vscode.commands.registerCommand("os4TestBridge.inspectToolchains", async () => {
      await runInspectToolchainsCommand(context, output, status);
      await refreshStatusIndicators();
    }),
    vscode.commands.registerCommand(SELECT_PROJECT_TOOLCHAIN_COMMAND_ID, async () => {
      await runSelectProjectToolchainCommand(context, output, status);
      await refreshStatusIndicators();
    }),
    vscode.commands.registerCommand(SELECT_PROJECT_ASSEMBLER_COMMAND_ID, async () => {
      await runSelectProjectAssemblerCommand(context, output, status);
      await refreshStatusIndicators();
    })
  );
}

function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("os4TestBridge");
  const executablePath = config.get<string>("executablePath", "os4tb").trim();
  const configPath = config.get<string>("configPath", "").trim();
  const timeoutSettings = resolveTimeoutSettings(
    config.get<number>("defaultTimeoutSeconds", 45),
    config.get<number>("inspectToolchainsTimeoutSeconds", 180),
    config.get<number>("gccDiagnosticsTimeoutSeconds", 120),
    config.get<number>("gccCompileTimeoutSeconds", 120),
    config.get<number>("gccBuildRunTimeoutSeconds", 180)
  );
  const defaultTimeoutMs = timeoutMsForCommand("run", timeoutSettings);
  const inspectToolchainsTimeoutMs = inspectToolchainsProcessTimeoutMs(timeoutSettings);
  const gccDiagnosticsTimeoutMs = gccDiagnosticsProcessTimeoutMs(timeoutSettings);
  const gccCompileTimeoutMs = gccCompileProcessTimeoutMs(timeoutSettings);
  const gccBuildRunTimeoutMs = gccBuildRunProcessTimeoutMs(timeoutSettings);
  const runPayloadName = config.get<string>("runPayloadName", "").trim();
  const validationPayloadName = config.get<string>("validationPayloadName", "").trim();
  const gccDiagnosticsPayloadName = resolvePayloadSetting(
    config,
    "gccDiagnosticsPayloadName",
    DEFAULT_GCC_DIAGNOSTICS_PAYLOAD_NAME
  );
  const gccCompilePayloadName = config.get<string>("gccCompilePayloadName", "").trim();
  const gccBuildRunPayloadName = config.get<string>("gccBuildRunPayloadName", "").trim();
  const gccProjectBuildRunPayloadName = resolvePayloadSetting(
    config,
    "gccProjectBuildRunPayloadName",
    DEFAULT_GCC_PROJECT_BUILD_RUN_PAYLOAD_NAME
  );
  const vbccProjectBuildRunPayloadName = resolvePayloadSetting(
    config,
    "vbccProjectBuildRunPayloadName",
    DEFAULT_VBCC_PROJECT_BUILD_RUN_PAYLOAD_NAME
  );
  const assemblerProjectBuildRunPayloadName = resolvePayloadSetting(
    config,
    "assemblerProjectBuildRunPayloadName",
    DEFAULT_ASSEMBLER_PROJECT_BUILD_RUN_PAYLOAD_NAME
  );
  const inspectToolchainsPayloadName = resolvePayloadSetting(
    config,
    "inspectToolchainsPayloadName",
    DEFAULT_INSPECT_TOOLCHAINS_PAYLOAD_NAME
  );
  const generatedRequestDirectory = config.get<string>("generatedRequestDirectory", "").trim();

  return {
    executablePath,
    configPath,
    defaultTimeoutMs,
    inspectToolchainsTimeoutSeconds: timeoutSettings.inspectToolchainsTimeoutSeconds,
    inspectToolchainsTimeoutMs,
    gccDiagnosticsTimeoutSeconds: timeoutSettings.gccDiagnosticsTimeoutSeconds,
    gccDiagnosticsTimeoutMs,
    gccCompileTimeoutSeconds: timeoutSettings.gccCompileTimeoutSeconds,
    gccCompileTimeoutMs,
    gccBuildRunTimeoutSeconds: timeoutSettings.gccBuildRunTimeoutSeconds,
    gccBuildRunTimeoutMs,
    runPayloadName,
    validationPayloadName,
    gccDiagnosticsPayloadName,
    gccCompilePayloadName,
    gccBuildRunPayloadName,
    gccProjectBuildRunPayloadName,
    vbccProjectBuildRunPayloadName,
    assemblerProjectBuildRunPayloadName,
    inspectToolchainsPayloadName,
    generatedRequestDirectory
  };
}

function resolvePayloadSetting(
  config: vscode.WorkspaceConfiguration,
  key:
    | "gccDiagnosticsPayloadName"
    | "gccProjectBuildRunPayloadName"
    | "vbccProjectBuildRunPayloadName"
    | "assemblerProjectBuildRunPayloadName"
    | "inspectToolchainsPayloadName",
  fallbackPayloadName: string
): string {
  const configuredValue = config.get<string>(key, "").trim();
  if (configuredValue.length > 0) {
    return configuredValue;
  }
  return fallbackPayloadName;
}

function isMissingHostBridgeExecutable(result: Os4tbProcessResult): boolean {
  if (!result.spawnError) {
    return false;
  }
  return /ENOENT/.test(result.spawnError);
}

function buildMissingHostBridgeErrorMessage(executablePath: string): string {
  return `${MISSING_HOST_BRIDGE_ERROR_PREFIX} Set os4TestBridge.executablePath to a valid os4tb executable or ensure '${executablePath}' is on PATH.`;
}

function setStatus(status: vscode.StatusBarItem, state: StatusState): void {
  status.text = `OS4TB: ${state}`;
}

function appendInvocation(output: vscode.OutputChannel, label: string, result: Os4tbProcessResult): void {
  output.appendLine(`--- ${label} ---`);
  output.appendLine(`command=${result.command}`);
  output.appendLine(`args=${JSON.stringify(result.args)}`);
  output.appendLine(`exit_code=${result.exitCode === null ? "null" : String(result.exitCode)}`);
  output.appendLine(`timed_out=${result.timedOut ? "yes" : "no"}`);
  if (result.spawnError) {
    output.appendLine(`spawn_error=${result.spawnError}`);
  }
}

function appendToken(output: vscode.OutputChannel, parsed: ReturnType<typeof parseKeyValueOutput>, key: string): void {
  if (parsed.fields[key] !== undefined) {
    output.appendLine(`${key}=${parsed.fields[key]}`);
  }
}

function setCanonicalSourceRemapEntry(
  sourceRemap: Record<string, string>,
  guestPath: string,
  hostPath: string
): void {
  const normalizedGuestPath = normalizeSamdropIncomingPath(guestPath);
  if (!normalizedGuestPath) {
    throw new Error("invalid_guest_remap_path");
  }
  sourceRemap[normalizedGuestPath] = hostPath;
}

function buildUniqueBasenameMap(entries: Array<{ stagedRelativePath: string; hostPath: string }>): Record<string, string> {
  const seen = new Map<string, string | undefined>();
  for (const entry of entries) {
    const basename = path.basename(entry.stagedRelativePath);
    const existing = seen.get(basename);
    if (existing === undefined) {
      seen.set(basename, entry.hostPath);
      continue;
    }
    if (existing !== entry.hostPath) {
      seen.set(basename, undefined);
    }
  }
  const unique: Record<string, string> = {};
  for (const [basename, hostPath] of seen.entries()) {
    if (hostPath) {
      unique[basename] = hostPath;
    }
  }
  return unique;
}

function buildProjectArtifactSidecarPath(artifactPath: string, suffix: string): string {
  const artifactBasename = path.basename(artifactPath);
  return resolveCompilerDiagnosticsPath(artifactPath, `${artifactBasename}.${suffix}`);
}

async function tryReadFirstExistingTextSidecar(params: {
  candidatePaths: string[];
  maxBytes: number;
  timeoutMs: number;
  pollMs: number;
}): Promise<string | undefined> {
  for (const candidatePath of params.candidatePaths) {
    try {
      return await readUtf8FileWithEnoentRetry({
        filePath: candidatePath,
        maxBytes: params.maxBytes,
        timeoutMs: params.timeoutMs,
        pollMs: params.pollMs
      });
    } catch {
      // Keep bounded behavior: missing/late sidecars are tolerated.
    }
  }
  return undefined;
}

async function runVersionCommand(output: vscode.OutputChannel, status: vscode.StatusBarItem): Promise<void> {
  const cfg = getConfig();
  const client = new Os4tbClient(cfg.executablePath, cfg.inspectToolchainsTimeoutMs);
  setStatus(status, "Checking...");
  const result = await client.version();
  const parsed = parseKeyValueOutput(result.stdout);
  appendInvocation(output, "Show Version", result);
  appendToken(output, parsed, "OS4TB_TOOL_VERSION");
  appendToken(output, parsed, "OS4TB_PROTOCOL_VERSION");
  if (result.stderr.trim().length > 0) {
    output.appendLine(`stderr=${result.stderr.trim()}`);
  }

  if (result.exitCode === 0 && parsed.fields.OS4TB_TOOL_VERSION && parsed.fields.OS4TB_PROTOCOL_VERSION) {
    setStatus(status, "PASS");
    vscode.window.showInformationMessage(
      `OS4TB version ${parsed.fields.OS4TB_TOOL_VERSION}, protocol ${parsed.fields.OS4TB_PROTOCOL_VERSION}`
    );
    return;
  }

  setStatus(status, "FAIL");
  vscode.window.showErrorMessage(
    `OS4TB version check failed (exit=${result.exitCode === null ? "null" : result.exitCode}).`
  );
}

async function runCheckCommand(output: vscode.OutputChannel, status: vscode.StatusBarItem): Promise<void> {
  const cfg = getConfig();
  if (!cfg.configPath) {
    vscode.window.showErrorMessage("Set os4TestBridge.configPath before running Check Target.");
    setStatus(status, "FAIL");
    return;
  }
  try {
    const stat = await fs.stat(cfg.configPath);
    if (!stat.isFile()) {
      vscode.window.showErrorMessage(`Configured os4TestBridge.configPath is not a file: ${cfg.configPath}`);
      setStatus(status, "FAIL");
      return;
    }
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? (err as { code?: string }).code : undefined;
    if (code === "ENOENT") {
      vscode.window.showErrorMessage(`Configured os4TestBridge.configPath was not found: ${cfg.configPath}`);
    } else {
      vscode.window.showErrorMessage(
        `Configured os4TestBridge.configPath is invalid or unreadable: ${cfg.configPath}`
      );
    }
    setStatus(status, "FAIL");
    return;
  }

  const client = new Os4tbClient(cfg.executablePath, cfg.defaultTimeoutMs);
  setStatus(status, "Checking...");
  const result = await client.check(cfg.configPath);
  const parsed = parseKeyValueOutput(result.stdout);
  appendInvocation(output, "Check Target", result);
  appendToken(output, parsed, "OS4TB_TOOL_VERSION");
  appendToken(output, parsed, "OS4TB_PROTOCOL_VERSION");
  appendToken(output, parsed, "OS4TB_TARGET_NAME");
  appendToken(output, parsed, "HOST_CONFIGURATION");
  appendToken(output, parsed, "REAL_GUEST_STATUS");
  if (result.stderr.trim().length > 0) {
    output.appendLine(`stderr=${result.stderr.trim()}`);
  }

  const hostConfiguration = parsed.fields.HOST_CONFIGURATION;
  if (result.exitCode === 0 && hostConfiguration === "PASS") {
    setStatus(status, "PASS");
    const targetName = parsed.fields.OS4TB_TARGET_NAME ?? "unknown";
    const realGuest = parsed.fields.REAL_GUEST_STATUS ?? "UNKNOWN";
    vscode.window.showInformationMessage(
      `OS4TB check PASS (target=${targetName}, real_guest_status=${realGuest}).`
    );
    return;
  }

  setStatus(status, "FAIL");
  const targetName = parsed.fields.OS4TB_TARGET_NAME ?? "unknown";
  vscode.window.showErrorMessage(
    `OS4TB check FAIL (target=${targetName}, exit=${result.exitCode === null ? "null" : result.exitCode}).`
  );
}

async function runRequestCommand(
  output: vscode.OutputChannel,
  status: vscode.StatusBarItem,
  uri?: vscode.Uri
): Promise<void> {
  const cfg = getConfig();
  if (!cfg.configPath) {
    vscode.window.showErrorMessage("Set os4TestBridge.configPath before running Run Request File.");
    setStatus(status, "FAIL");
    return;
  }

  const requestPath = await resolveRequestPath(uri);
  if (!requestPath) {
    return;
  }

  const client = new Os4tbClient(cfg.executablePath, cfg.defaultTimeoutMs);
  setStatus(status, "Running...");
  const result = await client.runRequest(cfg.configPath, requestPath);
  const parsed = parseKeyValueOutput(result.stdout);
  const contract = evaluateRunContract(result.exitCode, parsed);

  appendInvocation(output, "Run Request File", result);
  output.appendLine("command_class=run_request_file");
  output.appendLine(`request_path=${requestPath}`);
  appendToken(output, parsed, "OS4TB_TARGET_NAME");
  appendToken(output, parsed, "OS4TB_RUN_REQUEST_ID");
  appendToken(output, parsed, "OS4TB_RUN_FAILURE_REASON");
  appendToken(output, parsed, "OS4TB_RUN_FINAL");
  if (result.stderr.trim().length > 0) {
    output.appendLine(`stderr=${result.stderr.trim()}`);
  }

  if (contract.ok) {
    setStatus(status, "PASS");
    const requestId = parsed.fields.OS4TB_RUN_REQUEST_ID ?? "unknown";
    vscode.window.showInformationMessage(`OS4TB run PASS (request_id=${requestId}).`);
    return;
  }

  setStatus(status, "FAIL");
  const target = parsed.fields.OS4TB_TARGET_NAME ?? "unknown";
  const requestId = parsed.fields.OS4TB_RUN_REQUEST_ID ?? "unknown";
  const reason = parsed.fields.OS4TB_RUN_FAILURE_REASON ?? contract.reason;
  const exitCode = result.exitCode === null ? "null" : String(result.exitCode);
  vscode.window.showErrorMessage(
    `OS4TB run FAIL (target=${target}, request_id=${requestId}, reason=${reason}, exit=${exitCode}).`
  );
}

async function runGeneratedWorkflowCommand(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  status: vscode.StatusBarItem,
  kind: WorkflowKind
): Promise<void> {
  const cfg = getConfig();
  if (!cfg.configPath) {
    vscode.window.showErrorMessage("Set os4TestBridge.configPath before running this command.");
    setStatus(status, "FAIL");
    return;
  }

  const payloadName = kind === "run" ? cfg.runPayloadName : cfg.validationPayloadName;
  try {
    validateRequiredPayloadSetting(kind, payloadName);
  } catch (err) {
    const message = (err as Error).message;
    setStatus(status, "FAIL");
    if (message === "run_payload_setting_missing") {
      vscode.window.showErrorMessage("Set os4TestBridge.runPayloadName before Run on AmigaOS 4.");
      return;
    }
    vscode.window.showErrorMessage("Set os4TestBridge.validationPayloadName before Validate on AmigaOS 4.");
    return;
  }

  const requestDirectory = resolveGeneratedRequestDirectory(context, cfg.generatedRequestDirectory);
  const client = new Os4tbClient(cfg.executablePath, cfg.defaultTimeoutMs);
  setStatus(status, kind === "run" ? "Running on OS4..." : "Validating...");

  let generatedRequest;
  try {
    generatedRequest = await createGeneratedRequest({
      kind,
      payloadName,
      directory: requestDirectory
    });
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(`Unable to generate request: ${(err as Error).message}`);
    return;
  }

  const result = await client.runRequest(cfg.configPath, generatedRequest.requestPath);
  const parsed = parseKeyValueOutput(result.stdout);
  const contract = evaluateRunContract(result.exitCode, parsed);
  const target = parsed.fields.OS4TB_TARGET_NAME ?? "unknown";
  const requestId = parsed.fields.OS4TB_RUN_REQUEST_ID ?? generatedRequest.requestId;
  const operation = parsed.fields.OS4TB_RUN_OPERATION ?? generatedRequest.operation;

  appendInvocation(output, kind === "run" ? "Run on AmigaOS 4" : "Validate on AmigaOS 4", result);
  output.appendLine(`command_class=${kind === "run" ? "run_on_os4" : "validate_on_os4"}`);
  output.appendLine(`selected_target=${target}`);
  output.appendLine(`request_directory=${requestDirectory}`);
  output.appendLine(`request_path=${generatedRequest.requestPath}`);
  appendToken(output, parsed, "OS4TB_RUN_REQUEST_ID");
  appendToken(output, parsed, "OS4TB_RUN_OPERATION");
  appendToken(output, parsed, "OS4TB_RUN_FAILURE_REASON");
  appendToken(output, parsed, "OS4TB_RUN_FINAL");
  if (result.stderr.trim().length > 0) {
    output.appendLine(`stderr=${result.stderr.trim()}`);
  }

  if (contract.ok) {
    setStatus(status, "PASS");
    const artifactPath = parsed.fields.OS4TB_ARTIFACT_PATH;
    vscode.window.showInformationMessage(
      buildWorkflowPassMessage({
        kind,
        target,
        requestId,
        operation,
        artifactPath
      })
    );
    return;
  }

  setStatus(status, "FAIL");
  const reason = parsed.fields.OS4TB_RUN_FAILURE_REASON ?? contract.reason;
  const exitCode = result.exitCode === null ? "null" : String(result.exitCode);
  vscode.window.showErrorMessage(
    buildWorkflowFailMessage({
      kind,
      target,
      requestId,
      reason,
      exitCode
    })
  );
}

async function runInspectToolchainsCommand(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  status: vscode.StatusBarItem
): Promise<void> {
  const cfg = getConfig();
  if (!cfg.configPath) {
    vscode.window.showErrorMessage("Set os4TestBridge.configPath before inspecting toolchains.");
    setStatus(status, "FAIL");
    return;
  }
  try {
    validateRequiredPayloadSetting("inspectToolchains", cfg.inspectToolchainsPayloadName);
  } catch (err) {
    setStatus(status, "FAIL");
    const message = (err as Error).message;
    vscode.window.showErrorMessage(`Inspect toolchains payload validation failed: ${message}`);
    return;
  }

  const requestDirectory = resolveGeneratedRequestDirectory(context, cfg.generatedRequestDirectory);
  const client = new Os4tbClient(cfg.executablePath, cfg.inspectToolchainsTimeoutMs);
  setStatus(status, "Running on OS4...");

  let generatedRequest;
  try {
    generatedRequest = await createGeneratedRequest({
      kind: "inspectToolchains",
      payloadName: cfg.inspectToolchainsPayloadName,
      directory: requestDirectory
    });
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(`Unable to generate toolchain discovery request: ${(err as Error).message}`);
    return;
  }

  const result = await client.runRequest(cfg.configPath, generatedRequest.requestPath, {
    orchestratorTimeoutSeconds: cfg.inspectToolchainsTimeoutSeconds
  });
  const parsed = parseKeyValueOutput(result.stdout);
  const contract = evaluateRunContract(result.exitCode, parsed);
  appendInvocation(output, "Inspect AmigaOS 4 SDK / Toolchains", result);
  output.appendLine("command_class=inspect_toolchains");
  output.appendLine(`request_path=${generatedRequest.requestPath}`);
  appendToken(output, parsed, "OS4TB_TARGET_NAME");
  appendToken(output, parsed, "OS4TB_RUN_REQUEST_ID");
  appendToken(output, parsed, "OS4TB_RUN_OPERATION");
  appendToken(output, parsed, "OS4TB_RUN_FAILURE_REASON");
  appendToken(output, parsed, "OS4TB_RUN_FINAL");
  if (result.stderr.trim().length > 0) {
    output.appendLine(`stderr=${result.stderr.trim()}`);
  }

  if (!contract.ok) {
    setStatus(status, "FAIL");
    if (isMissingHostBridgeExecutable(result)) {
      vscode.window.showErrorMessage(buildMissingHostBridgeErrorMessage(cfg.executablePath));
      return;
    }
    const target = parsed.fields.OS4TB_TARGET_NAME ?? "unknown";
    const requestId = parsed.fields.OS4TB_RUN_REQUEST_ID ?? generatedRequest.requestId;
    const reason = parsed.fields.OS4TB_RUN_FAILURE_REASON ?? contract.reason;
    const exitCode = result.exitCode === null ? "null" : String(result.exitCode);
    vscode.window.showErrorMessage(
      `OS4TB toolchain discovery FAIL (target=${target}, request_id=${requestId}, reason=${reason}, exit=${exitCode}).`
    );
    return;
  }

  const artifactPath = parsed.fields.OS4TB_ARTIFACT_PATH;
  if (!artifactPath) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      "OS4TB toolchain discovery FAIL (reason=discovery_artifact_path_missing). Backend did not return OS4TB_ARTIFACT_PATH."
    );
    return;
  }

  let artifactText = "";
  try {
    artifactText = await readUtf8FileWithEnoentRetry({
      filePath: artifactPath,
      maxBytes: OS4TB_DISCOVERY_MAX_ARTIFACT_BYTES,
      timeoutMs: 2500,
      pollMs: 100
    });
  } catch (err) {
    setStatus(status, "FAIL");
    const message = (err as Error).message;
    if (message.startsWith("file_too_large:")) {
      const bytes = message.slice("file_too_large:".length);
      vscode.window.showErrorMessage(`OS4TB toolchain discovery FAIL (reason=discovery_artifact_too_large, bytes=${bytes}).`);
      return;
    }
    vscode.window.showErrorMessage(
      `OS4TB toolchain discovery FAIL (reason=discovery_artifact_read_failed, detail=${(err as Error).message}).`
    );
    return;
  }

  try {
    validateDiscoveryArtifactText(artifactText);
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB toolchain discovery FAIL (reason=${(err as Error).message}).`
    );
    return;
  }

  const discoveryFields = parseKeyValueOutput(artifactText).fields;
  let snapshot;
  try {
    snapshot = parseToolchainDiscoveryArtifact(discoveryFields);
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB toolchain discovery FAIL (reason=${(err as Error).message}).`
    );
    return;
  }

  output.appendLine(`OS4TB_DISCOVERY_VERSION=${snapshot.schemaVersion}`);
  output.appendLine(`OS4TB_SDK_STATUS=${snapshot.sdkStatus}`);
  output.appendLine(`OS4TB_SDK_ROOT=${snapshot.sdkRoot}`);
  output.appendLine(`OS4TB_GCC_COUNT=${snapshot.gccToolchains.length}`);
  for (const gcc of snapshot.gccToolchains) {
    output.appendLine(`OS4TB_GCC_${gcc.index}_VERSION=${gcc.version}`);
    output.appendLine(`OS4TB_GCC_${gcc.index}_INCLUDE_COUNT=${gcc.includePaths.length}`);
    output.appendLine(`OS4TB_GCC_${gcc.index}_LIBRARY_DIR_COUNT=${gcc.libraryDirs.length}`);
    output.appendLine(`OS4TB_GCC_${gcc.index}_LIBRARY_INVENTORY_COUNT=${gcc.libraryInventory.length}`);
  }
  output.appendLine(`OS4TB_VBCC_STATUS=${snapshot.vbccStatus}`);
  output.appendLine(`OS4TB_VBCC_DRIVER_COMMAND=${snapshot.vbccDriverCommand}`);
  output.appendLine(`OS4TB_VBCC_DRIVER_PATH=${snapshot.vbccDriverPath}`);
  output.appendLine(`OS4TB_VBCC_LINKER_STATUS=${snapshot.vbccLinkerStatus}`);
  output.appendLine(`OS4TB_VBCC_LINKER_PATH=${snapshot.vbccLinkerPath}`);
  output.appendLine(`OS4TB_VBCC_ASSEMBLER_STATUS=${snapshot.vbccAssemblerStatus}`);
  output.appendLine(`OS4TB_VBCC_ASSEMBLER_PATH=${snapshot.vbccAssemblerPath}`);
  output.appendLine(`OS4TB_AS_STATUS=${snapshot.asStatus}`);
  output.appendLine(`OS4TB_LD_STATUS=${snapshot.ldStatus}`);

  const cachePath = resolveToolchainDiscoveryCachePath(context);
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(
      cachePath,
      JSON.stringify(
        {
          schemaVersion: snapshot.schemaVersion,
          timestamp: new Date().toISOString(),
          target: parsed.fields.OS4TB_TARGET_NAME ?? "unknown",
          sdkStatus: snapshot.sdkStatus,
          sdkRoot: snapshot.sdkRoot,
          gccAssign: snapshot.gccAssign,
          libAssign: snapshot.libAssign,
          gccActiveFrontend: snapshot.gccActiveFrontend,
          gccActiveVersion: snapshot.gccActiveVersion,
          gccCount: snapshot.gccToolchains.length,
          toolchains: snapshot.gccToolchains,
          vbccStatus: snapshot.vbccStatus,
          vbccVersion: snapshot.vbccVersion,
          vbccDriverCommand: snapshot.vbccDriverCommand,
          vbccDriverPath: snapshot.vbccDriverPath,
          vbccLinkerStatus: snapshot.vbccLinkerStatus,
          vbccLinkerPath: snapshot.vbccLinkerPath,
          vbccAssemblerStatus: snapshot.vbccAssemblerStatus,
          vbccAssemblerPath: snapshot.vbccAssemblerPath,
          asStatus: snapshot.asStatus,
          asPath: snapshot.asPath,
          asVersion: snapshot.asVersion,
          ldStatus: snapshot.ldStatus,
          ldPath: snapshot.ldPath,
          ldVersion: snapshot.ldVersion
        },
        undefined,
        2
      ),
      "utf8"
    );
    output.appendLine(`OS4TB_DISCOVERY_CACHE_PATH=${cachePath}`);
  } catch (err) {
    output.appendLine(`OS4TB_DISCOVERY_CACHE_WRITE=FAIL (${(err as Error).message})`);
  }

  setStatus(status, "PASS");
  vscode.window.showInformationMessage(buildToolchainDiscoverySummary(snapshot));
}

async function loadBridgeIncomingDirectory(configPath: string): Promise<string | undefined> {
  const configText = await fs.readFile(configPath, "utf8");
  const bridgeConfig = parseBridgeConfig(configText);
  return resolveIncomingDirectoryFromConfig(bridgeConfig);
}

async function loadToolchainDiscoverySnapshotFromCache(
  context: vscode.ExtensionContext
): Promise<ToolchainDiscoverySnapshot | undefined> {
  const cachePath = resolveToolchainDiscoveryCachePath(context);
  let text = "";
  try {
    text = await fs.readFile(cachePath, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const asRecord = parsed as Record<string, unknown>;
  const toolchains = Array.isArray(asRecord.toolchains) ? asRecord.toolchains : undefined;
  if (!toolchains) {
    return undefined;
  }
  const snapshot: ToolchainDiscoverySnapshot = {
    schemaVersion: typeof asRecord.schemaVersion === "number" ? asRecord.schemaVersion : 0,
    sdkStatus: (asRecord.sdkStatus as ToolchainDiscoverySnapshot["sdkStatus"]) ?? "unknown",
    sdkRoot: typeof asRecord.sdkRoot === "string" ? asRecord.sdkRoot : "unknown",
    gccAssign: typeof asRecord.gccAssign === "string" ? asRecord.gccAssign : "unknown",
    libAssign: typeof asRecord.libAssign === "string" ? asRecord.libAssign : "unknown",
    gccActiveFrontend: typeof asRecord.gccActiveFrontend === "string" ? asRecord.gccActiveFrontend : "unknown",
    gccActiveVersion: typeof asRecord.gccActiveVersion === "string" ? asRecord.gccActiveVersion : "unknown",
    gccToolchains: toolchains as ToolchainDiscoverySnapshot["gccToolchains"],
    vbccStatus: (asRecord.vbccStatus as ToolchainDiscoverySnapshot["vbccStatus"]) ?? "unknown",
    vbccVersion: typeof asRecord.vbccVersion === "string" ? asRecord.vbccVersion : "unknown",
    vbccDriverCommand: typeof asRecord.vbccDriverCommand === "string" ? asRecord.vbccDriverCommand : "unknown",
    vbccDriverPath: typeof asRecord.vbccDriverPath === "string" ? asRecord.vbccDriverPath : "unknown",
    vbccLinkerStatus: (asRecord.vbccLinkerStatus as ToolchainDiscoverySnapshot["vbccLinkerStatus"]) ?? "unknown",
    vbccLinkerPath: typeof asRecord.vbccLinkerPath === "string" ? asRecord.vbccLinkerPath : "unknown",
    vbccAssemblerStatus:
      (asRecord.vbccAssemblerStatus as ToolchainDiscoverySnapshot["vbccAssemblerStatus"]) ?? "unknown",
    vbccAssemblerPath: typeof asRecord.vbccAssemblerPath === "string" ? asRecord.vbccAssemblerPath : "unknown",
    asStatus: (asRecord.asStatus as ToolchainDiscoverySnapshot["asStatus"]) ?? "unknown",
    asPath: typeof asRecord.asPath === "string" ? asRecord.asPath : "unknown",
    asVersion: typeof asRecord.asVersion === "string" ? asRecord.asVersion : "unknown",
    ldStatus: (asRecord.ldStatus as ToolchainDiscoverySnapshot["ldStatus"]) ?? "unknown",
    ldPath: typeof asRecord.ldPath === "string" ? asRecord.ldPath : "unknown",
    ldVersion: typeof asRecord.ldVersion === "string" ? asRecord.ldVersion : "unknown"
  };
  if (snapshot.schemaVersion !== 1) {
    return undefined;
  }
  return snapshot;
}

async function ensureToolchainDiscoverySnapshot(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  status: vscode.StatusBarItem
): Promise<ToolchainDiscoverySnapshot | undefined> {
  const cached = await loadToolchainDiscoverySnapshotFromCache(context);
  if (cached) {
    return cached;
  }
  await runInspectToolchainsCommand(context, output, status);
  return loadToolchainDiscoverySnapshotFromCache(context);
}

async function runSelectProjectToolchainCommand(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  status: vscode.StatusBarItem
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.isUntitled || editor.document.uri.scheme !== "file") {
    vscode.window.showErrorMessage("Open a saved project file before selecting an OS4TB project toolchain.");
    setStatus(status, "FAIL");
    return;
  }

  const preference = await readProjectToolchainPreferenceForActiveFile(editor.document.uri.fsPath);
  if (preference.reason === "manifest_duplicate_toolchain") {
    vscode.window.showErrorMessage(`Malformed ${PROJECT_MANIFEST_FILENAME}: duplicate toolchain keys.`);
    setStatus(status, "FAIL");
    return;
  }
  if (preference.reason === "toolchain_id_invalid") {
    vscode.window.showErrorMessage(`Malformed ${PROJECT_MANIFEST_FILENAME}: invalid toolchain value.`);
    setStatus(status, "FAIL");
    return;
  }
  if (preference.reason === "manifest_read_failed") {
    vscode.window.showErrorMessage(`Failed to read ${PROJECT_MANIFEST_FILENAME}.`);
    setStatus(status, "FAIL");
    return;
  }
  if (preference.reason !== "ok" || !preference.location) {
    vscode.window.showErrorMessage(`No ${PROJECT_MANIFEST_FILENAME} found for the active file.`);
    setStatus(status, "FAIL");
    return;
  }

  const snapshot = await ensureToolchainDiscoverySnapshot(context, output, status);
  if (!snapshot) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage("Toolchain discovery cache unavailable. Run Inspect AmigaOS 4 SDK / Toolchains first.");
    return;
  }

  const items = buildProjectToolchainSelectionItems(snapshot, preference.toolchainId);
  const picked = await vscode.window.showQuickPick<ProjectToolchainSelectionItem>(items, {
    title: "OS4 Test Bridge: Select Project Toolchain",
    placeHolder: `Project: ${path.dirname(preference.location.manifestPath)}`
  });
  if (!picked) {
    return;
  }
  if (picked.selectionKind === "unavailable") {
    vscode.window.showWarningMessage("Current project toolchain is unavailable on this target. Select Automatic or a discovered toolchain.");
    return;
  }

  const selectedToolchainId = resolveSelectionToolchainId(picked);
  const writeResult = await setProjectToolchainPreferenceForActiveFile(editor.document.uri.fsPath, selectedToolchainId);
  if (writeResult.reason !== "ok") {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(`Failed to update project toolchain selection (${writeResult.reason}).`);
    return;
  }

  setStatus(status, "PASS");
  if (selectedToolchainId) {
    vscode.window.showInformationMessage(`Project toolchain selected: ${selectedToolchainId}`);
  } else {
    vscode.window.showInformationMessage("Project toolchain selected: Automatic (active discovered GCC).");
  }
}

async function runSelectProjectAssemblerCommand(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  status: vscode.StatusBarItem
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.isUntitled || editor.document.uri.scheme !== "file") {
    vscode.window.showErrorMessage("Open a saved project file before selecting an OS4TB project assembler.");
    setStatus(status, "FAIL");
    return;
  }

  const preference = await readProjectAssemblerPreferenceForActiveFile(editor.document.uri.fsPath);
  if (preference.reason === "manifest_duplicate_assembler") {
    vscode.window.showErrorMessage(`Malformed ${PROJECT_MANIFEST_FILENAME}: duplicate assembler keys.`);
    setStatus(status, "FAIL");
    return;
  }
  if (preference.reason === "assembler_id_invalid") {
    vscode.window.showErrorMessage(`Malformed ${PROJECT_MANIFEST_FILENAME}: invalid assembler value.`);
    setStatus(status, "FAIL");
    return;
  }
  if (preference.reason === "manifest_read_failed") {
    vscode.window.showErrorMessage(`Failed to read ${PROJECT_MANIFEST_FILENAME}.`);
    setStatus(status, "FAIL");
    return;
  }
  if (preference.reason !== "ok" || !preference.location) {
    vscode.window.showErrorMessage(`No ${PROJECT_MANIFEST_FILENAME} found for the active file.`);
    setStatus(status, "FAIL");
    return;
  }

  const snapshot = await ensureToolchainDiscoverySnapshot(context, output, status);
  if (!snapshot) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage("Toolchain discovery cache unavailable. Run Inspect AmigaOS 4 SDK / Toolchains first.");
    return;
  }

  const items = buildProjectAssemblerSelectionItems(snapshot, preference.assemblerId);
  const picked = await vscode.window.showQuickPick<ProjectAssemblerSelectionItem>(items, {
    title: "OS4 Test Bridge: Select Project Assembler",
    placeHolder: `Project: ${path.dirname(preference.location.manifestPath)}`
  });
  if (!picked) {
    return;
  }
  if (picked.selectionKind === "unavailable") {
    vscode.window.showWarningMessage("Current project assembler is unavailable on this target. Select Automatic or a discovered assembler.");
    return;
  }

  const selectedAssemblerId = resolveSelectionAssemblerId(picked);
  const writeResult = await setProjectAssemblerPreferenceForActiveFile(editor.document.uri.fsPath, selectedAssemblerId);
  if (writeResult.reason !== "ok") {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(`Failed to update project assembler selection (${writeResult.reason}).`);
    return;
  }

  setStatus(status, "PASS");
  if (selectedAssemblerId) {
    vscode.window.showInformationMessage(`Project assembler selected: ${selectedAssemblerId}`);
  } else {
    vscode.window.showInformationMessage("Project assembler selected: Automatic.");
  }
}

function getConfigPathUpdateTarget(
  workspaceFolder: vscode.WorkspaceFolder | undefined
): vscode.ConfigurationTarget {
  void workspaceFolder;
  return vscode.ConfigurationTarget.Global;
}

async function runSelectTargetConfigurationCommand(status: vscode.StatusBarItem): Promise<void> {
  const cfg = getConfig();
  const workspaceFolder = resolveWorkspaceFolderForBootstrap();
  const defaultUri = cfg.configPath.length > 0
    ? vscode.Uri.file(path.dirname(cfg.configPath))
    : workspaceFolder?.uri;
  const selected = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    defaultUri,
    openLabel: "Select Target Configuration",
    title: cfg.configPath.length > 0
      ? `OS4 Test Bridge: Select Target Configuration (current: ${path.basename(cfg.configPath)})`
      : "OS4 Test Bridge: Select Target Configuration",
    filters: {
      "Config files": ["conf", "cfg", "ini"],
      "All files": ["*"]
    }
  });
  if (!selected || selected.length === 0) {
    return;
  }

  const selectedPath = selected[0].fsPath;
  const config = vscode.workspace.getConfiguration("os4TestBridge");
  await config.update(
    "configPath",
    selectedPath,
    getConfigPathUpdateTarget(workspaceFolder)
  );
  if (workspaceFolder) {
    await config.update("configPath", undefined, vscode.ConfigurationTarget.Workspace);
  }
  setStatus(status, "PASS");
  vscode.window.showInformationMessage(`OS4TB target config selected: ${path.basename(selectedPath)}`);
}

async function discoverBootstrapSourceCandidates(
  workspaceFolder: vscode.WorkspaceFolder
): Promise<BootstrapSourceSelection[]> {
  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, BOOTSTRAP_SOURCE_GLOB),
    new vscode.RelativePattern(workspaceFolder, BOOTSTRAP_SOURCE_EXCLUDE_GLOB),
    BOOTSTRAP_SOURCE_SEARCH_MAX_RESULTS
  );
  const relativePaths: string[] = [];
  for (const uri of uris) {
    const relativePath = toProjectRelativePath(workspaceFolder.uri.fsPath, uri.fsPath);
    if (relativePath) {
      relativePaths.push(relativePath);
    }
  }
  return normalizeBootstrapSourceSelection(relativePaths);
}

function resolveWorkspaceFolderForBootstrap(): vscode.WorkspaceFolder | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 0) {
    return undefined;
  }
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (activeFolder) {
      return activeFolder;
    }
  }
  if (workspaceFolders.length === 1) {
    return workspaceFolders[0];
  }
  return undefined;
}

async function selectWorkspaceFolderForBootstrap(): Promise<vscode.WorkspaceFolder | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 0) {
    return undefined;
  }
  const resolved = resolveWorkspaceFolderForBootstrap();
  if (resolved) {
    return resolved;
  }
  const picked = await vscode.window.showQuickPick(
    workspaceFolders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder
    })),
    {
      title: "OS4 Test Bridge: Initialize Project",
      placeHolder: "Select workspace folder for .os4tb-project initialization"
    }
  );
  return picked?.folder;
}

async function runInitializeProjectCommand(
  output: vscode.OutputChannel,
  status: vscode.StatusBarItem
): Promise<void> {
  const workspaceFolder = await selectWorkspaceFolderForBootstrap();
  if (!workspaceFolder) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage("Open a workspace folder before initializing an OS4 Test Bridge project.");
    return;
  }

  const manifestPath = path.join(workspaceFolder.uri.fsPath, PROJECT_MANIFEST_FILENAME);
  try {
    await fs.stat(manifestPath);
    setStatus(status, "FAIL");
    vscode.window.showWarningMessage(
      `${PROJECT_MANIFEST_FILENAME} already exists in ${workspaceFolder.name}; existing project was preserved.`
    );
    return;
  } catch {
    // Missing project manifest is expected for initialization.
  }

  const candidates = await discoverBootstrapSourceCandidates(workspaceFolder);
  if (candidates.length < OS4TB_GCC_PROJECT_MIN_SOURCES) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `Initialize Project requires at least ${OS4TB_GCC_PROJECT_MIN_SOURCES} supported source files (.c/.s) in the workspace.`
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map((entry) => ({
      label: entry.relativePath,
      description: entry.sourceKind === "asm" ? "Assembler source" : "C source",
      entry,
      picked: true
    })),
    {
      canPickMany: true,
      title: "OS4 Test Bridge: Initialize Project",
      placeHolder: `Select ${OS4TB_GCC_PROJECT_MIN_SOURCES}-${OS4TB_GCC_PROJECT_MAX_SOURCES} source files`
    }
  );
  if (!picked || picked.length === 0) {
    return;
  }

  const selected = normalizeBootstrapSourceSelection(picked.map((item) => item.entry.relativePath));
  if (selected.length < OS4TB_GCC_PROJECT_MIN_SOURCES || selected.length > OS4TB_GCC_PROJECT_MAX_SOURCES) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `Initialize Project requires ${OS4TB_GCC_PROJECT_MIN_SOURCES}-${OS4TB_GCC_PROJECT_MAX_SOURCES} selected source files.`
    );
    return;
  }

  let manifestText: string;
  try {
    manifestText = buildInitializedProjectManifestText(selected);
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(`Initialize Project failed (${(err as Error).message}).`);
    return;
  }

  try {
    await writeProjectManifestAtomically(manifestPath, manifestText);
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `Failed to create ${PROJECT_MANIFEST_FILENAME} (${(err as Error).message}).`
    );
    return;
  }

  const mixedSuffix = hasMixedBootstrapSources(selected) ? " (mixed C/ASM)" : "";
  output.appendLine("--- Initialize Project ---");
  output.appendLine(`workspace=${workspaceFolder.uri.fsPath}`);
  output.appendLine(`manifest=${manifestPath}`);
  output.appendLine(`source_count=${selected.length}`);
  output.appendLine(`mixed_sources=${hasMixedBootstrapSources(selected) ? "yes" : "no"}`);
  output.appendLine("toolchain_persisted=automatic_absence");
  output.appendLine("assembler_persisted=automatic_absence");
  selected.forEach((entry, index) => {
    output.appendLine(`source_${index}=${entry.relativePath}`);
    output.appendLine(`source_${index}_kind=${entry.sourceKind}`);
  });
  setStatus(status, "PASS");
  vscode.window.showInformationMessage(
    `OS4 Test Bridge project initialized${mixedSuffix}. Next: Inspect AmigaOS 4 SDK / Toolchains, then Build and Run Project on AmigaOS 4.`
  );

  const manifestUri = vscode.Uri.file(manifestPath);
  await vscode.window.showTextDocument(manifestUri, { preview: false });
}

async function runCompileCurrentFileCommand(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  status: vscode.StatusBarItem,
  gccProblems: vscode.DiagnosticCollection
): Promise<void> {
  gccProblems.clear();
  const cfg = getConfig();
  if (!cfg.configPath) {
    vscode.window.showErrorMessage("Set os4TestBridge.configPath before compiling on AmigaOS 4.");
    setStatus(status, "FAIL");
    return;
  }
  try {
    validateRequiredPayloadSetting("gccCompile", cfg.gccCompilePayloadName);
  } catch (err) {
    setStatus(status, "FAIL");
    const message = (err as Error).message;
    if (message === "gcc_compile_payload_setting_missing") {
      vscode.window.showErrorMessage(
        "Set os4TestBridge.gccCompilePayloadName before compiling on AmigaOS 4."
      );
      return;
    }
    vscode.window.showErrorMessage(`GCC compile payload validation failed: ${message}`);
    return;
  }

  const editor = vscode.window.activeTextEditor;
  const documentCheck = validateCompileDocument({
    hasEditor: !!editor,
    isUntitled: editor?.document.isUntitled ?? false,
    uriScheme: editor?.document.uri.scheme ?? "",
    isDirty: editor?.document.isDirty ?? false,
    filePath: editor?.document.uri.fsPath ?? ""
  });
  if (documentCheck !== "ok") {
    setStatus(status, "FAIL");
    if (documentCheck === "no_active_editor") {
      vscode.window.showErrorMessage("Open a C source file before compiling on AmigaOS 4.");
      return;
    }
    if (documentCheck === "not_saved_file") {
      vscode.window.showErrorMessage("Compile Current File supports saved local .c files only.");
      return;
    }
    if (documentCheck === "unsupported_extension") {
      vscode.window.showErrorMessage("Compile Current File supports only .c source files in Phase 7C.");
      return;
    }
    if (documentCheck === "dirty_document") {
      vscode.window.showErrorMessage("Save the current C file before compiling on AmigaOS 4.");
      return;
    }
    vscode.window.showErrorMessage("Current C file basename is unsafe for bridge staging.");
    return;
  }

  const document = editor!.document;

  let incomingDirectory: string | undefined;
  try {
    incomingDirectory = await loadBridgeIncomingDirectory(cfg.configPath);
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB compile FAIL (reason=compile_config_read_failed, detail=${(err as Error).message}).`
    );
    return;
  }
  if (!incomingDirectory) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage("OS4TB compile FAIL (reason=compile_incoming_dir_missing).");
    return;
  }

  const requestDirectory = resolveGeneratedRequestDirectory(context, cfg.generatedRequestDirectory);
  const client = new Os4tbClient(cfg.executablePath, cfg.gccCompileTimeoutMs);
  setStatus(status, "Compiling on OS4...");

  let generatedRequest;
  try {
    generatedRequest = await createGeneratedRequest({
      kind: "gccCompile",
      payloadName: cfg.gccCompilePayloadName,
      directory: requestDirectory
    });
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(`Unable to generate GCC compile request: ${(err as Error).message}`);
    return;
  }

  const stagedSourceBasename = buildStagedSourceBasename(generatedRequest.requestId);
  const stagedSourcePath = path.join(incomingDirectory, stagedSourceBasename);
  try {
    await fs.copyFile(document.uri.fsPath, stagedSourcePath, fsSync.constants.COPYFILE_EXCL);
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB compile FAIL (reason=source_staging_failed, detail=${(err as Error).message}).`
    );
    return;
  }

  const result = await client.runRequest(cfg.configPath, generatedRequest.requestPath, {
    orchestratorTimeoutSeconds: cfg.gccCompileTimeoutSeconds
  });
  const parsed = parseKeyValueOutput(result.stdout);
  const contract = evaluateRunContract(result.exitCode, parsed);

  appendInvocation(output, "Compile Current File on AmigaOS 4", result);
  output.appendLine("command_class=compile_current_file");
  output.appendLine(`request_path=${generatedRequest.requestPath}`);
  output.appendLine(`OS4TB_GCC_COMPILE_REQUEST_ID=${generatedRequest.requestId}`);
  output.appendLine(`OS4TB_GCC_COMPILE_SOURCE_HOST=${document.uri.fsPath}`);
  output.appendLine(`OS4TB_GCC_COMPILE_SOURCE_STAGED=${stagedSourceBasename}`);
  appendToken(output, parsed, "OS4TB_TARGET_NAME");
  appendToken(output, parsed, "OS4TB_RUN_REQUEST_ID");
  appendToken(output, parsed, "OS4TB_RUN_OPERATION");
  appendToken(output, parsed, "OS4TB_RUN_FAILURE_REASON");
  appendToken(output, parsed, "OS4TB_RUN_FINAL");
  if (result.stderr.trim().length > 0) {
    output.appendLine(`stderr=${result.stderr.trim()}`);
  }

  if (!contract.ok) {
    setStatus(status, "FAIL");
    const target = parsed.fields.OS4TB_TARGET_NAME ?? "unknown";
    const requestId = parsed.fields.OS4TB_RUN_REQUEST_ID ?? generatedRequest.requestId;
    const reason = parsed.fields.OS4TB_RUN_FAILURE_REASON ?? contract.reason;
    const exitCode = result.exitCode === null ? "null" : String(result.exitCode);
    vscode.window.showErrorMessage(
      `OS4TB compile FAIL (target=${target}, request_id=${requestId}, reason=${reason}, exit=${exitCode}).`
    );
    return;
  }

  const artifactPath = parsed.fields.OS4TB_ARTIFACT_PATH;
  if (!artifactPath) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      "OS4TB compile FAIL (reason=gcc_compile_artifact_path_missing). Backend did not return OS4TB_ARTIFACT_PATH."
    );
    return;
  }

  const maxFileBytes = 262144;
  let artifactText = "";
  try {
    artifactText = await readUtf8FileWithEnoentRetry({
      filePath: artifactPath,
      maxBytes: maxFileBytes,
      timeoutMs: 2500,
      pollMs: 100
    });
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB compile FAIL (reason=gcc_compile_artifact_read_failed, detail=${(err as Error).message}).`
    );
    return;
  }

  const artifactParsed = parseKeyValueOutput(artifactText);
  const artifactFields = artifactParsed.fields;
  const compileSummary = parseCompileArtifactSummary(artifactFields);
  const diagnosticsPath = (() => {
    try {
      return resolveCompilerDiagnosticsPath(artifactPath, artifactFields.OS4TB_GCC_COMPILE_DIAGNOSTIC_FILE);
    } catch (err) {
      setStatus(status, "FAIL");
      vscode.window.showErrorMessage(
        `OS4TB compile FAIL (reason=${(err as Error).message}).`
      );
      return undefined;
    }
  })();
  if (!diagnosticsPath) {
    return;
  }

  let diagnosticsText = "";
  try {
    diagnosticsText = await readUtf8FileWithEnoentRetry({
      filePath: diagnosticsPath,
      maxBytes: maxFileBytes,
      timeoutMs: 2500,
      pollMs: 100
    });
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB compile FAIL (reason=gcc_compile_diagnostics_read_failed, detail=${(err as Error).message}).`
    );
    return;
  }

  const diagnostics = parseGccDiagnostics(diagnosticsText);
  const summary = summarizeGccDiagnostics(diagnostics);
  const sourceRemap: Record<string, string> = {};
  try {
    setCanonicalSourceRemapEntry(sourceRemap, `SAMDROP:incoming/${stagedSourceBasename}`, document.uri.fsPath);
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB compile FAIL (reason=source_remap_failed, detail=${(err as Error).message}).`
    );
    return;
  }
  const problemPlan = buildProblemPublishPlan(diagnostics, incomingDirectory, { sourceRemap });

  if (problemPlan.unmappedCount > 0) {
    output.appendLine(`OS4TB_GCC_PROBLEMS_UNMAPPED=${problemPlan.unmappedCount}`);
    output.appendLine("OS4TB_GCC_COMPILE_FINAL=FAIL");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB compile FAIL (reason=problems_unmapped_diagnostics, unmapped=${problemPlan.unmappedCount}).`
    );
    return;
  }

  replaceProblemsCollection(
    {
      clear: () => gccProblems.clear(),
      set: (entries) => {
        const mappedEntries: Array<[vscode.Uri, vscode.Diagnostic[]]> = entries.map(([filePath, diags]) => [
          vscode.Uri.file(filePath),
          diags
        ]);
        gccProblems.set(mappedEntries);
      }
    },
    Object.fromEntries(
      Object.entries(problemPlan.entriesByFile).map(([filePath, entries]) => {
        const mapped = entries.map((entry) => {
          const range = new vscode.Range(entry.lineZero, entry.startColumnZero, entry.lineZero, entry.endColumnZero);
          let severity = vscode.DiagnosticSeverity.Information;
          if (entry.severity === "error") {
            severity = vscode.DiagnosticSeverity.Error;
          } else if (entry.severity === "warning") {
            severity = vscode.DiagnosticSeverity.Warning;
          }
          const diagnostic = new vscode.Diagnostic(range, entry.message, severity);
          diagnostic.source = entry.source;
          return diagnostic;
        });
        return [filePath, mapped];
      })
    )
  );

  output.appendLine(`OS4TB_GCC_COMPILE_EXIT=${compileSummary.compileExit ?? "missing"}`);
  output.appendLine(`OS4TB_GCC_COMPILE_OBJECT_STATUS=${compileSummary.objectStatus ?? "missing"}`);
  output.appendLine(`OS4TB_GCC_COMPILE_OBJECT_NAME=${compileSummary.objectName ?? "missing"}`);
  output.appendLine(`OS4TB_GCC_COMPILE_ERRORS=${summary.errorCount}`);
  output.appendLine(`OS4TB_GCC_COMPILE_WARNINGS=${summary.warningCount}`);
  output.appendLine(`OS4TB_GCC_COMPILE_NOTES=${summary.noteCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_PUBLISHED=${problemPlan.mappedCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_ERRORS=${problemPlan.errorCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_WARNINGS=${problemPlan.warningCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_NOTES=${problemPlan.noteCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_UNMAPPED=${problemPlan.unmappedCount}`);
  output.appendLine("OS4TB_GCC_PROBLEMS_FINAL=PASS");

  const compileOutcome = evaluateCompileOutcome(compileSummary, {
    errorCount: summary.errorCount,
    warningCount: summary.warningCount,
    noteCount: summary.noteCount
  });
  const objectName = compileSummary.objectName ?? buildObjectBasename(generatedRequest.requestId);

  if (compileOutcome.final === "PASS") {
    output.appendLine("OS4TB_GCC_COMPILE_FINAL=PASS");
    setStatus(status, "PASS");
    vscode.window.showInformationMessage(
      `OS4TB compile PASS (${path.basename(document.uri.fsPath)}, object=${objectName}, warnings=${summary.warningCount})`
    );
    return;
  }

  output.appendLine("OS4TB_GCC_COMPILE_FINAL=FAIL");
  setStatus(status, "FAIL");
  vscode.window.showErrorMessage(
    `OS4TB compile FAIL (${path.basename(document.uri.fsPath)}, errors=${summary.errorCount}, warnings=${summary.warningCount})`
  );
}

async function runBuildAndRunCurrentFileCommand(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  status: vscode.StatusBarItem,
  gccProblems: vscode.DiagnosticCollection
): Promise<void> {
  gccProblems.clear();
  const cfg = getConfig();
  if (!cfg.configPath) {
    vscode.window.showErrorMessage("Set os4TestBridge.configPath before building/running on AmigaOS 4.");
    setStatus(status, "FAIL");
    return;
  }
  try {
    validateRequiredPayloadSetting("gccBuildRun", cfg.gccBuildRunPayloadName);
  } catch (err) {
    setStatus(status, "FAIL");
    const message = (err as Error).message;
    if (message === "gcc_build_run_payload_setting_missing") {
      vscode.window.showErrorMessage(
        "Set os4TestBridge.gccBuildRunPayloadName before building/running on AmigaOS 4."
      );
      return;
    }
    vscode.window.showErrorMessage(`GCC build/run payload validation failed: ${message}`);
    return;
  }

  const editor = vscode.window.activeTextEditor;
  const documentCheck = validateBuildRunDocument({
    hasEditor: !!editor,
    isUntitled: editor?.document.isUntitled ?? false,
    uriScheme: editor?.document.uri.scheme ?? "",
    isDirty: editor?.document.isDirty ?? false,
    filePath: editor?.document.uri.fsPath ?? ""
  });
  if (documentCheck !== "ok") {
    setStatus(status, "FAIL");
    if (documentCheck === "no_active_editor") {
      vscode.window.showErrorMessage("Open a C source file before building/running on AmigaOS 4.");
      return;
    }
    if (documentCheck === "not_saved_file") {
      vscode.window.showErrorMessage("Build and Run Current File supports saved local .c files only.");
      return;
    }
    if (documentCheck === "unsupported_extension") {
      vscode.window.showErrorMessage("Build and Run Current File supports only .c source files in Phase 7D.");
      return;
    }
    if (documentCheck === "dirty_document") {
      vscode.window.showErrorMessage("Save the current C file before building/running on AmigaOS 4.");
      return;
    }
    vscode.window.showErrorMessage("Current C file basename is unsafe for bridge staging.");
    return;
  }

  const document = editor!.document;

  let incomingDirectory: string | undefined;
  try {
    incomingDirectory = await loadBridgeIncomingDirectory(cfg.configPath);
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB build/run FAIL (reason=build_run_config_read_failed, detail=${(err as Error).message}).`
    );
    return;
  }
  if (!incomingDirectory) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage("OS4TB build/run FAIL (reason=build_run_incoming_dir_missing).");
    return;
  }

  const requestDirectory = resolveGeneratedRequestDirectory(context, cfg.generatedRequestDirectory);
  const client = new Os4tbClient(cfg.executablePath, cfg.gccBuildRunTimeoutMs);
  setStatus(status, "Building/running on OS4...");

  let generatedRequest;
  try {
    generatedRequest = await createGeneratedRequest({
      kind: "gccBuildRun",
      payloadName: cfg.gccBuildRunPayloadName,
      directory: requestDirectory
    });
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(`Unable to generate GCC build/run request: ${(err as Error).message}`);
    return;
  }

  const stagedSourceBasename = buildStagedSourceBasename(generatedRequest.requestId);
  const stagedSourcePath = path.join(incomingDirectory, stagedSourceBasename);
  try {
    await fs.copyFile(document.uri.fsPath, stagedSourcePath, fsSync.constants.COPYFILE_EXCL);
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB build/run FAIL (reason=source_staging_failed, detail=${(err as Error).message}).`
    );
    return;
  }

  const result = await client.runRequest(cfg.configPath, generatedRequest.requestPath, {
    orchestratorTimeoutSeconds: cfg.gccBuildRunTimeoutSeconds
  });
  const parsed = parseKeyValueOutput(result.stdout);
  const contract = evaluateRunContract(result.exitCode, parsed);

  appendInvocation(output, "Build and Run Current File on AmigaOS 4", result);
  output.appendLine("command_class=build_run_current_file");
  output.appendLine(`request_path=${generatedRequest.requestPath}`);
  output.appendLine(`OS4TB_GCC_BUILD_RUN_REQUEST_ID=${generatedRequest.requestId}`);
  output.appendLine(`OS4TB_GCC_BUILD_RUN_SOURCE_HOST=${document.uri.fsPath}`);
  output.appendLine(`OS4TB_GCC_BUILD_RUN_SOURCE_STAGED=${stagedSourceBasename}`);
  appendToken(output, parsed, "OS4TB_TARGET_NAME");
  appendToken(output, parsed, "OS4TB_RUN_REQUEST_ID");
  appendToken(output, parsed, "OS4TB_RUN_OPERATION");
  appendToken(output, parsed, "OS4TB_RUN_FAILURE_REASON");
  appendToken(output, parsed, "OS4TB_RUN_FINAL");
  if (result.stderr.trim().length > 0) {
    output.appendLine(`stderr=${result.stderr.trim()}`);
  }

  if (!contract.ok) {
    setStatus(status, "FAIL");
    const target = parsed.fields.OS4TB_TARGET_NAME ?? "unknown";
    const requestId = parsed.fields.OS4TB_RUN_REQUEST_ID ?? generatedRequest.requestId;
    const reason = parsed.fields.OS4TB_RUN_FAILURE_REASON ?? contract.reason;
    const exitCode = result.exitCode === null ? "null" : String(result.exitCode);
    vscode.window.showErrorMessage(
      `OS4TB build/run FAIL (target=${target}, request_id=${requestId}, reason=${reason}, exit=${exitCode}).`
    );
    return;
  }

  const artifactPath = parsed.fields.OS4TB_ARTIFACT_PATH;
  if (!artifactPath) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      "OS4TB build/run FAIL (reason=gcc_build_run_artifact_path_missing). Backend did not return OS4TB_ARTIFACT_PATH."
    );
    return;
  }

  const maxFileBytes = 262144;
  let artifactText = "";
  try {
    artifactText = await readUtf8FileWithEnoentRetry({
      filePath: artifactPath,
      maxBytes: maxFileBytes,
      timeoutMs: 2500,
      pollMs: 100
    });
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB build/run FAIL (reason=gcc_build_run_artifact_read_failed, detail=${(err as Error).message}).`
    );
    return;
  }

  const artifactParsed = parseKeyValueOutput(artifactText);
  const artifactFields = artifactParsed.fields;
  const summary = parseBuildRunArtifactSummary(artifactFields);
  const diagnosticsPath = (() => {
    try {
      return resolveCompilerDiagnosticsPath(artifactPath, artifactFields.OS4TB_GCC_BUILD_DIAGNOSTIC_FILE);
    } catch (err) {
      setStatus(status, "FAIL");
      vscode.window.showErrorMessage(`OS4TB build/run FAIL (reason=${(err as Error).message}).`);
      return undefined;
    }
  })();
  if (!diagnosticsPath) {
    return;
  }

  let diagnosticsText = "";
  try {
    diagnosticsText = await readUtf8FileWithEnoentRetry({
      filePath: diagnosticsPath,
      maxBytes: maxFileBytes,
      timeoutMs: 2500,
      pollMs: 100
    });
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB build/run FAIL (reason=gcc_build_run_diagnostics_read_failed, detail=${(err as Error).message}).`
    );
    return;
  }

  const diagnostics = parseGccDiagnostics(diagnosticsText);
  const counts = summarizeGccDiagnostics(diagnostics);
  const sourceRemap: Record<string, string> = {};
  try {
    setCanonicalSourceRemapEntry(sourceRemap, `SAMDROP:incoming/${stagedSourceBasename}`, document.uri.fsPath);
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB build/run FAIL (reason=source_remap_failed, detail=${(err as Error).message}).`
    );
    return;
  }
  const problemPlan = buildProblemPublishPlan(diagnostics, incomingDirectory, { sourceRemap });

  if (problemPlan.unmappedCount > 0) {
    output.appendLine(`OS4TB_GCC_PROBLEMS_UNMAPPED=${problemPlan.unmappedCount}`);
    output.appendLine("OS4TB_GCC_BUILD_FINAL=FAIL");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB build/run FAIL (reason=problems_unmapped_diagnostics, unmapped=${problemPlan.unmappedCount}).`
    );
    return;
  }

  replaceProblemsCollection(
    {
      clear: () => gccProblems.clear(),
      set: (entries) => {
        const mappedEntries: Array<[vscode.Uri, vscode.Diagnostic[]]> = entries.map(([filePath, diags]) => [
          vscode.Uri.file(filePath),
          diags
        ]);
        gccProblems.set(mappedEntries);
      }
    },
    Object.fromEntries(
      Object.entries(problemPlan.entriesByFile).map(([filePath, entries]) => {
        const mapped = entries.map((entry) => {
          const range = new vscode.Range(entry.lineZero, entry.startColumnZero, entry.lineZero, entry.endColumnZero);
          let severity = vscode.DiagnosticSeverity.Information;
          if (entry.severity === "error") {
            severity = vscode.DiagnosticSeverity.Error;
          } else if (entry.severity === "warning") {
            severity = vscode.DiagnosticSeverity.Warning;
          }
          const diagnostic = new vscode.Diagnostic(range, entry.message, severity);
          diagnostic.source = entry.source;
          return diagnostic;
        });
        return [filePath, mapped];
      })
    )
  );

  const executableName = summary.executableName ?? buildExecutableBasename(generatedRequest.requestId);
  const outcome = evaluateBuildRunOutcome(summary, {
    errorCount: counts.errorCount,
    warningCount: counts.warningCount,
    noteCount: counts.noteCount
  });

  output.appendLine(`OS4TB_GCC_BUILD_EXIT=${summary.buildExit ?? "missing"}`);
  output.appendLine(`OS4TB_GCC_EXECUTABLE_STATUS=${summary.executableStatus ?? "missing"}`);
  output.appendLine(`OS4TB_GCC_EXECUTABLE_NAME=${executableName}`);
  output.appendLine(`OS4TB_PROGRAM_EXIT=${summary.programExit ?? "missing"}`);
  if (artifactFields.OS4TB_GCC_LINK_STRATEGY) {
    output.appendLine(`OS4TB_GCC_LINK_STRATEGY=${artifactFields.OS4TB_GCC_LINK_STRATEGY}`);
  }
  if (artifactFields.OS4TB_GCC_DIRECT_LINK_EXIT) {
    output.appendLine(`OS4TB_GCC_DIRECT_LINK_EXIT=${artifactFields.OS4TB_GCC_DIRECT_LINK_EXIT}`);
  }
  if (artifactFields.OS4TB_GCC_DIRECT_LINK_FINAL) {
    output.appendLine(`OS4TB_GCC_DIRECT_LINK_FINAL=${artifactFields.OS4TB_GCC_DIRECT_LINK_FINAL}`);
  }
  if (artifactFields.OS4TB_GCC_DIRECT_LINK_EXECUTABLE_STATUS) {
    output.appendLine(
      `OS4TB_GCC_DIRECT_LINK_EXECUTABLE_STATUS=${artifactFields.OS4TB_GCC_DIRECT_LINK_EXECUTABLE_STATUS}`
    );
  }
  if (artifactFields.OS4TB_GCC_DIRECT_LIBGCC_STATUS) {
    output.appendLine(`OS4TB_GCC_DIRECT_LIBGCC_STATUS=${artifactFields.OS4TB_GCC_DIRECT_LIBGCC_STATUS}`);
  }
  if (artifactFields.OS4TB_GCC_DIRECT_LIBGCC_EH_STATUS) {
    output.appendLine(`OS4TB_GCC_DIRECT_LIBGCC_EH_STATUS=${artifactFields.OS4TB_GCC_DIRECT_LIBGCC_EH_STATUS}`);
  }
  if (artifactFields.OS4TB_PROGRAM_OUTPUT_FILE) {
    output.appendLine(`OS4TB_PROGRAM_OUTPUT_FILE=${artifactFields.OS4TB_PROGRAM_OUTPUT_FILE}`);
  }
  output.appendLine(`OS4TB_GCC_BUILD_ERRORS=${counts.errorCount}`);
  output.appendLine(`OS4TB_GCC_BUILD_WARNINGS=${counts.warningCount}`);
  output.appendLine(`OS4TB_GCC_BUILD_NOTES=${counts.noteCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_PUBLISHED=${problemPlan.mappedCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_ERRORS=${problemPlan.errorCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_WARNINGS=${problemPlan.warningCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_NOTES=${problemPlan.noteCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_UNMAPPED=${problemPlan.unmappedCount}`);
  output.appendLine("OS4TB_GCC_PROBLEMS_FINAL=PASS");

  if (outcome.buildFinal === "FAIL") {
    output.appendLine("OS4TB_GCC_BUILD_FINAL=FAIL");
    output.appendLine("OS4TB_PROGRAM_FINAL=NOT_RUN");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB build FAIL (${path.basename(document.uri.fsPath)}, errors=${counts.errorCount}, warnings=${counts.warningCount})`
    );
    return;
  }

  output.appendLine("OS4TB_GCC_BUILD_FINAL=PASS");
  if (outcome.programFinal === "PASS") {
    output.appendLine("OS4TB_PROGRAM_FINAL=PASS");
    setStatus(status, "PASS");
    vscode.window.showInformationMessage(
      `OS4TB build/run PASS (${path.basename(document.uri.fsPath)}, exit=0)`
    );
    return;
  }

  output.appendLine("OS4TB_PROGRAM_FINAL=FAIL");
  setStatus(status, "FAIL");
  vscode.window.showErrorMessage(
    `OS4TB run FAIL (${path.basename(document.uri.fsPath)}, exit=${summary.programExit ?? "unknown"})`
  );
}

async function runBuildAndRunMultiFileProjectCommand(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  status: vscode.StatusBarItem,
  gccProblems: vscode.DiagnosticCollection
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const documentCheck = validateBuildRunDocument({
    hasEditor: !!editor,
    isUntitled: editor?.document.isUntitled ?? false,
    uriScheme: editor?.document.uri.scheme ?? "",
    isDirty: editor?.document.isDirty ?? false,
    filePath: editor?.document.uri.fsPath ?? ""
  });
  if (documentCheck !== "ok") {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage("Build and Run Multi-File Test Project supports saved local .c files only.");
    return;
  }

  const twoFile = await resolveTwoFileProjectSources(editor!.document.uri.fsPath);
  if (twoFile.reason !== "ok" || !twoFile.mainPath || !twoFile.helperPath) {
    setStatus(status, "FAIL");
    if (twoFile.reason === "main_file_required") {
      vscode.window.showErrorMessage("Open main.c to run the bounded multi-file test project workflow.");
      return;
    }
    if (twoFile.reason === "helper_missing") {
      vscode.window.showErrorMessage("helper.c is required beside main.c for this bounded multi-file test workflow.");
      return;
    }
    vscode.window.showErrorMessage(`Multi-file test project validation failed (reason=${twoFile.reason}).`);
    return;
  }

  await runProjectBuildAndRunCommand({
    context,
    output,
    status,
    gccProblems,
    activeFilePath: editor!.document.uri.fsPath,
    sourceFilePaths: [twoFile.mainPath, twoFile.helperPath],
    sourceKinds: ["c", "c"],
    headerFilePaths: [],
    includeDirectoryPaths: [],
    defineEntries: [],
    libraryNames: [],
    buildProfile: {
      cStandard: OS4TB_GCC_PROJECT_DEFAULT_C_STANDARD,
      warningLevel: OS4TB_GCC_PROJECT_DEFAULT_WARNING_LEVEL,
      optimization: OS4TB_GCC_PROJECT_DEFAULT_OPTIMIZATION,
      debugSymbols: OS4TB_GCC_PROJECT_DEFAULT_DEBUG_SYMBOLS
    },
    toolchainId: undefined,
    sourceStagedRelativePaths: [
      buildProjectStagedSourceBasename("ignored", 0),
      buildProjectStagedSourceBasename("ignored", 1)
    ],
    headerStagedRelativePaths: [],
    includeStagedRelativePaths: [],
    commandLabel: "Build and Run Multi-File Test Project on AmigaOS 4",
    commandClass: "build_run_multi_file_project",
    successLabel: "OS4TB multi-file build/run PASS"
  });
}

async function runBuildAndRunProjectCommand(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  status: vscode.StatusBarItem,
  gccProblems: vscode.DiagnosticCollection
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const documentCheck = validateBuildRunDocument({
    hasEditor: !!editor,
    isUntitled: editor?.document.isUntitled ?? false,
    uriScheme: editor?.document.uri.scheme ?? "",
    isDirty: editor?.document.isDirty ?? false,
    filePath: editor?.document.uri.fsPath ?? ""
  });
  if (documentCheck !== "ok") {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage("Build and Run Project supports saved local .c files only.");
    return;
  }

  const parsedManifest = await parseProjectManifestForActiveFile(editor!.document.uri.fsPath);
  if (parsedManifest.reason !== "ok" || !parsedManifest.manifest) {
    setStatus(status, "FAIL");
    if (parsedManifest.reason === "manifest_missing") {
      vscode.window.showErrorMessage(`Project manifest ${PROJECT_MANIFEST_FILENAME} not found in active file directory.`);
      return;
    }
    vscode.window.showErrorMessage(
      `Project manifest ${PROJECT_MANIFEST_FILENAME} invalid (reason=${parsedManifest.reason}).`
    );
    return;
  }

  await runProjectBuildAndRunCommand({
    context,
    output,
    status,
    gccProblems,
    activeFilePath: editor!.document.uri.fsPath,
    sourceFilePaths: parsedManifest.manifest.sources,
    sourceKinds: parsedManifest.manifest.sourceKinds,
    headerFilePaths: parsedManifest.manifest.headers,
    includeDirectoryPaths: parsedManifest.manifest.includes,
    defineEntries: parsedManifest.manifest.defineEntries,
    libraryNames: parsedManifest.manifest.libraries,
    buildProfile: {
      cStandard: parsedManifest.manifest.cStandard,
      warningLevel: parsedManifest.manifest.warningLevel,
      optimization: parsedManifest.manifest.optimization,
      debugSymbols: parsedManifest.manifest.debugSymbols
    },
    toolchainId: parsedManifest.manifest.toolchainId,
    sourceStagedRelativePaths: parsedManifest.manifest.sourceRelativePaths,
    headerStagedRelativePaths: parsedManifest.manifest.headerRelativePaths,
    includeStagedRelativePaths: parsedManifest.manifest.includeRelativePaths,
    commandLabel: "Build and Run Project on AmigaOS 4",
    commandClass: "build_run_project",
    successLabel: "OS4TB project build/run PASS"
  });
}

async function runProjectBuildAndRunCommand(params: {
  context: vscode.ExtensionContext;
  output: vscode.OutputChannel;
  status: vscode.StatusBarItem;
  gccProblems: vscode.DiagnosticCollection;
  activeFilePath: string;
  sourceFilePaths: string[];
  sourceKinds: ProjectSourceKind[];
  headerFilePaths: string[];
  includeDirectoryPaths: string[];
  defineEntries: string[];
  libraryNames: string[];
  buildProfile: ProjectBuildProfile;
  toolchainId?: string;
  sourceStagedRelativePaths: string[];
  headerStagedRelativePaths: string[];
  includeStagedRelativePaths: string[];
  commandLabel: string;
  commandClass: string;
  successLabel: string;
}): Promise<void> {
  params.gccProblems.clear();
  const cfg = getConfig();
  if (!cfg.configPath) {
    vscode.window.showErrorMessage("Set os4TestBridge.configPath before building/running on AmigaOS 4.");
    setStatus(params.status, "FAIL");
    return;
  }
  let incomingDirectory: string | undefined;
  try {
    incomingDirectory = await loadBridgeIncomingDirectory(cfg.configPath);
  } catch (err) {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB project build/run FAIL (reason=build_run_config_read_failed, detail=${(err as Error).message}).`
    );
    return;
  }
  if (!incomingDirectory) {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage("OS4TB project build/run FAIL (reason=build_run_incoming_dir_missing).");
    return;
  }

  const requestDirectory = resolveGeneratedRequestDirectory(params.context, cfg.generatedRequestDirectory);
  const client = new Os4tbClient(cfg.executablePath, cfg.gccBuildRunTimeoutMs);
  setStatus(params.status, "Building/running on OS4...");

  const discoverySnapshot = await loadToolchainDiscoverySnapshotFromCache(params.context);
  if (!discoverySnapshot) {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage(
      "OS4TB project build/run FAIL (reason=toolchain_discovery_cache_missing). Run Inspect Toolchains first."
    );
    return;
  }
  if (params.sourceKinds.length !== params.sourceFilePaths.length) {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage("OS4TB project build/run FAIL (reason=source_kind_count_mismatch).");
    return;
  }
  const cSourceCount = params.sourceKinds.filter((kind) => kind === "c").length;
  const asmSourceCount = params.sourceKinds.filter((kind) => kind === "asm").length;
  const hasMixedSources = cSourceCount > 0 && asmSourceCount > 0;

  let selectedToolchain: ProjectResolvedToolchainProfile | undefined;
  if (cSourceCount > 0) {
    const resolvedToolchain = resolveProjectToolchain({
      snapshot: discoverySnapshot,
      toolchainId: params.toolchainId
    });
    if (!resolvedToolchain.ok) {
      setStatus(params.status, "FAIL");
      const detail = params.toolchainId ?? "default_active";
      vscode.window.showErrorMessage(
        `OS4TB project build/run FAIL (reason=${resolvedToolchain.reason}, detail=${detail}).`
      );
      return;
    }
    selectedToolchain = resolvedToolchain.toolchain;
  }

  let selectedAssembler:
    | Exclude<ReturnType<typeof resolveProjectAssembler>, { ok: false }>["assembler"]
    | undefined;
  if (asmSourceCount > 0) {
    const assemblerPreference = await readProjectAssemblerPreferenceForActiveFile(params.activeFilePath);
    if (assemblerPreference.reason !== "ok") {
      setStatus(params.status, "FAIL");
      vscode.window.showErrorMessage(
        `OS4TB project build/run FAIL (reason=${assemblerPreference.reason}).`
      );
      return;
    }
    const requestedAssemblerId = assemblerPreference.assemblerId ?? resolveAutomaticProjectAssemblerId(discoverySnapshot);
    if (!requestedAssemblerId) {
      setStatus(params.status, "FAIL");
      vscode.window.showErrorMessage(
        "OS4TB project build/run FAIL (reason=assembler_not_discovered, detail=automatic)."
      );
      return;
    }
    const resolvedAssembler = resolveProjectAssembler({
      snapshot: discoverySnapshot,
      assemblerId: requestedAssemblerId
    });
    if (!resolvedAssembler.ok) {
      setStatus(params.status, "FAIL");
      vscode.window.showErrorMessage(
        `OS4TB project build/run FAIL (reason=${resolvedAssembler.reason}, detail=${requestedAssemblerId}).`
      );
      return;
    }
    selectedAssembler = resolvedAssembler.assembler;
  }

  if (hasMixedSources && selectedToolchain && selectedToolchain.family !== "gcc") {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage(
      "OS4TB project build/run FAIL (reason=mixed_project_vbcc_deferred)."
    );
    return;
  }

  let payloadKind: WorkflowKind;
  let payloadName: string;
  if (cSourceCount > 0) {
    payloadKind = selectedToolchain!.family === "vbcc" ? "vbccProjectBuildRun" : "gccProjectBuildRun";
    payloadName = selectedToolchain!.family === "vbcc"
      ? cfg.vbccProjectBuildRunPayloadName
      : cfg.gccProjectBuildRunPayloadName;
  } else {
    payloadKind = "assemblerProjectBuildRun";
    payloadName = cfg.assemblerProjectBuildRunPayloadName;
  }
  try {
    validateRequiredPayloadSetting(payloadKind, payloadName);
  } catch (err) {
    setStatus(params.status, "FAIL");
    const message = (err as Error).message;
    if (message === "vbcc_project_build_run_payload_setting_missing") {
      vscode.window.showErrorMessage(
        "Set os4TestBridge.vbccProjectBuildRunPayloadName before VBCC project build/run on AmigaOS 4."
      );
      return;
    }
    if (message === "gcc_project_build_run_payload_setting_missing") {
      vscode.window.showErrorMessage(
        "Set os4TestBridge.gccProjectBuildRunPayloadName before GCC project build/run on AmigaOS 4."
      );
      return;
    }
    if (message === "assembler_project_build_run_payload_setting_missing") {
      vscode.window.showErrorMessage(
        "Set os4TestBridge.assemblerProjectBuildRunPayloadName before assembler project build/run on AmigaOS 4."
      );
      return;
    }
    vscode.window.showErrorMessage(`Project payload validation failed: ${message}`);
    return;
  }

  let generatedRequest;
  try {
    generatedRequest = await createGeneratedRequest({
      kind: payloadKind,
      payloadName,
      directory: requestDirectory
    });
  } catch (err) {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage(`Unable to generate project request: ${(err as Error).message}`);
    return;
  }

  const stagedSourcePaths: string[] = [];
  const stagedHeaderPaths: string[] = [];
  const sourceRemap: Record<string, string> = {};
  const stagedProjectDirectoryBasename = buildProjectStagedDirectoryBasename(generatedRequest.requestId);
  const stagedProjectDirectoryPath = path.join(incomingDirectory, stagedProjectDirectoryBasename);
  try {
    await fs.mkdir(stagedProjectDirectoryPath, { recursive: false });
  } catch (err) {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB project build/run FAIL (reason=project_directory_staging_failed, detail=${(err as Error).message}).`
    );
    return;
  }
  if (params.sourceFilePaths.length !== params.sourceStagedRelativePaths.length) {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage("OS4TB project build/run FAIL (reason=source_path_count_mismatch).");
    return;
  }
  if (params.headerFilePaths.length !== params.headerStagedRelativePaths.length) {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage("OS4TB project build/run FAIL (reason=header_path_count_mismatch).");
    return;
  }

  for (let i = 0; i < params.sourceFilePaths.length; i += 1) {
    const stagedRelativePath = params.sourceStagedRelativePaths[i];
    const sourceKind = params.sourceKinds[i];
    const expectedExtension = sourceKind === "asm" ? ".s" : ".c";
    if (!isValidProjectRelativePath(stagedRelativePath, expectedExtension)) {
      setStatus(params.status, "FAIL");
      vscode.window.showErrorMessage("OS4TB project build/run FAIL (reason=source_staged_path_invalid).");
      return;
    }
    const stagedPath = path.join(stagedProjectDirectoryPath, ...stagedRelativePath.split("/"));
    await fs.mkdir(path.dirname(stagedPath), { recursive: true });
    try {
      await fs.copyFile(params.sourceFilePaths[i], stagedPath, fsSync.constants.COPYFILE_EXCL);
    } catch (err) {
      setStatus(params.status, "FAIL");
      vscode.window.showErrorMessage(
        `OS4TB project build/run FAIL (reason=source_staging_failed, detail=${(err as Error).message}).`
      );
      return;
    }
    stagedSourcePaths.push(stagedRelativePath);
    try {
      setCanonicalSourceRemapEntry(
        sourceRemap,
        `SAMDROP:incoming/${stagedProjectDirectoryBasename}/${stagedRelativePath}`,
        params.sourceFilePaths[i]
      );
    } catch (err) {
      setStatus(params.status, "FAIL");
      vscode.window.showErrorMessage(
        `OS4TB project build/run FAIL (reason=source_remap_failed, detail=${(err as Error).message}).`
      );
      return;
    }
  }

  for (let i = 0; i < params.headerFilePaths.length; i += 1) {
    const stagedRelativePath = params.headerStagedRelativePaths[i];
    if (!isValidProjectRelativePath(stagedRelativePath, ".h")) {
      setStatus(params.status, "FAIL");
      vscode.window.showErrorMessage("OS4TB project build/run FAIL (reason=header_staged_path_invalid).");
      return;
    }
    const stagedPath = path.join(stagedProjectDirectoryPath, ...stagedRelativePath.split("/"));
    await fs.mkdir(path.dirname(stagedPath), { recursive: true });
    try {
      await fs.copyFile(params.headerFilePaths[i], stagedPath, fsSync.constants.COPYFILE_EXCL);
    } catch (err) {
      setStatus(params.status, "FAIL");
      vscode.window.showErrorMessage(
        `OS4TB project build/run FAIL (reason=header_staging_failed, detail=${(err as Error).message}).`
      );
      return;
    }
    stagedHeaderPaths.push(stagedRelativePath);
    try {
      setCanonicalSourceRemapEntry(
        sourceRemap,
        `SAMDROP:incoming/${stagedProjectDirectoryBasename}/${stagedRelativePath}`,
        params.headerFilePaths[i]
      );
    } catch (err) {
      setStatus(params.status, "FAIL");
      vscode.window.showErrorMessage(
        `OS4TB project build/run FAIL (reason=header_remap_failed, detail=${(err as Error).message}).`
      );
      return;
    }
  }

  if (params.includeDirectoryPaths.length !== params.includeStagedRelativePaths.length) {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage("OS4TB project build/run FAIL (reason=include_path_count_mismatch).");
    return;
  }
  for (let i = 0; i < params.includeStagedRelativePaths.length; i += 1) {
    const stagedRelativePath = params.includeStagedRelativePaths[i];
    if (!isValidProjectRelativePath(stagedRelativePath)) {
      setStatus(params.status, "FAIL");
      vscode.window.showErrorMessage("OS4TB project build/run FAIL (reason=include_staged_path_invalid).");
      return;
    }
    const stagedDirectoryPath = path.join(stagedProjectDirectoryPath, ...stagedRelativePath.split("/"));
    try {
      const includeStat = await fs.stat(stagedDirectoryPath);
      if (!includeStat.isDirectory()) {
        setStatus(params.status, "FAIL");
        vscode.window.showErrorMessage("OS4TB project build/run FAIL (reason=include_staged_path_not_directory).");
        return;
      }
    } catch {
      await fs.mkdir(stagedDirectoryPath, { recursive: true });
    }
  }

  const sourceKinds = params.sourceKinds;
  const projectManifestBasename = payloadKind === "assemblerProjectBuildRun"
    ? PROJECT_ASSEMBLER_GUEST_MANIFEST_FILENAME
    : buildProjectManifestBasename();
  const projectManifestPath = path.join(stagedProjectDirectoryPath, projectManifestBasename);
  const projectManifestText = payloadKind === "assemblerProjectBuildRun"
    ? buildGuestAssemblerManifestText({
      assembler: selectedAssembler!,
      sources: stagedSourcePaths,
      includes: params.includeStagedRelativePaths,
      defines: params.defineEntries,
      runProgram: "yes"
    })
    : buildGuestProjectManifestText(
      stagedSourcePaths,
      sourceKinds,
      stagedHeaderPaths,
      params.includeStagedRelativePaths,
      params.defineEntries,
      params.libraryNames,
      params.buildProfile,
      selectedToolchain as ProjectResolvedToolchainProfile,
      selectedAssembler
    );
  try {
    await fs.writeFile(projectManifestPath, projectManifestText, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB project build/run FAIL (reason=project_manifest_staging_failed, detail=${(err as Error).message}).`
    );
    return;
  }

  const result = await client.runRequest(cfg.configPath, generatedRequest.requestPath, {
    orchestratorTimeoutSeconds: cfg.gccBuildRunTimeoutSeconds
  });
  const parsed = parseKeyValueOutput(result.stdout);
  const contract = evaluateRunContract(result.exitCode, parsed);

  appendInvocation(params.output, params.commandLabel, result);
  params.output.appendLine(`command_class=${params.commandClass}`);
  params.output.appendLine(`request_path=${generatedRequest.requestPath}`);
  params.output.appendLine(`OS4TB_GCC_PROJECT_REQUEST_ID=${generatedRequest.requestId}`);
  params.output.appendLine(`OS4TB_GCC_PROJECT_SOURCE_COUNT=${params.sourceFilePaths.length}`);
  for (let i = 0; i < params.sourceFilePaths.length; i += 1) {
    params.output.appendLine(`OS4TB_GCC_PROJECT_SOURCE_${i}_HOST=${params.sourceFilePaths[i]}`);
    params.output.appendLine(`OS4TB_GCC_PROJECT_SOURCE_${i}_STAGED=${stagedSourcePaths[i]}`);
    params.output.appendLine(`OS4TB_GCC_PROJECT_SOURCE_${i}_KIND=${sourceKinds[i]}`);
  }
  params.output.appendLine(`OS4TB_GCC_PROJECT_HEADER_COUNT=${params.headerFilePaths.length}`);
  for (let i = 0; i < params.headerFilePaths.length; i += 1) {
    params.output.appendLine(`OS4TB_GCC_PROJECT_HEADER_${i}_HOST=${params.headerFilePaths[i]}`);
    params.output.appendLine(`OS4TB_GCC_PROJECT_HEADER_${i}_STAGED=${stagedHeaderPaths[i]}`);
  }
  params.output.appendLine(`OS4TB_GCC_PROJECT_INCLUDE_COUNT=${params.includeStagedRelativePaths.length}`);
  for (let i = 0; i < params.includeStagedRelativePaths.length; i += 1) {
    params.output.appendLine(`OS4TB_GCC_PROJECT_INCLUDE_${i}_HOST=${params.includeDirectoryPaths[i]}`);
    params.output.appendLine(`OS4TB_GCC_PROJECT_INCLUDE_${i}_STAGED=${params.includeStagedRelativePaths[i]}`);
  }
  params.output.appendLine(`OS4TB_GCC_PROJECT_DEFINE_COUNT=${params.defineEntries.length}`);
  for (let i = 0; i < params.defineEntries.length; i += 1) {
    params.output.appendLine(`OS4TB_GCC_PROJECT_DEFINE_${i}=${params.defineEntries[i]}`);
  }
  params.output.appendLine(`OS4TB_GCC_PROJECT_LIBRARY_COUNT=${params.libraryNames.length}`);
  for (let i = 0; i < params.libraryNames.length; i += 1) {
    params.output.appendLine(`OS4TB_GCC_PROJECT_LIBRARY_${i}=${params.libraryNames[i]}`);
  }
  params.output.appendLine(`OS4TB_GCC_PROJECT_C_STANDARD=${params.buildProfile.cStandard}`);
  params.output.appendLine(`OS4TB_GCC_PROJECT_WARNING_LEVEL=${params.buildProfile.warningLevel}`);
  params.output.appendLine(`OS4TB_GCC_PROJECT_OPTIMIZATION=${params.buildProfile.optimization}`);
  params.output.appendLine(`OS4TB_GCC_PROJECT_DEBUG_SYMBOLS=${params.buildProfile.debugSymbols}`);
  if (selectedToolchain) {
    params.output.appendLine(`OS4TB_GCC_PROJECT_TOOLCHAIN_ID=${selectedToolchain.id}`);
    params.output.appendLine(`OS4TB_GCC_PROJECT_TOOLCHAIN_SOURCE=${selectedToolchain.source}`);
    params.output.appendLine(`OS4TB_GCC_PROJECT_TOOLCHAIN_FAMILY=${selectedToolchain.family}`);
    params.output.appendLine(`OS4TB_GCC_PROJECT_TOOLCHAIN_VERSION=${selectedToolchain.version}`);
  }
  if (selectedAssembler) {
    params.output.appendLine(`OS4TB_GCC_PROJECT_ASSEMBLER_ID=${selectedAssembler.id}`);
    params.output.appendLine(`OS4TB_GCC_PROJECT_ASSEMBLER_FAMILY=${selectedAssembler.family}`);
  }
  params.output.appendLine(`OS4TB_GCC_PROJECT_STAGED_DIR=${stagedProjectDirectoryBasename}`);
  params.output.appendLine(`OS4TB_GCC_PROJECT_DIRECTORY=${buildGuestProjectDirectoryPath(generatedRequest.requestId)}`);
  params.output.appendLine(`OS4TB_GCC_PROJECT_MANIFEST=${buildGuestProjectManifestPath(generatedRequest.requestId)}`);
  params.output.appendLine(`OS4TB_GCC_PROJECT_MANIFEST_STAGED=${projectManifestBasename}`);
  appendToken(params.output, parsed, "OS4TB_TARGET_NAME");
  appendToken(params.output, parsed, "OS4TB_RUN_REQUEST_ID");
  appendToken(params.output, parsed, "OS4TB_RUN_OPERATION");
  appendToken(params.output, parsed, "OS4TB_RUN_FAILURE_REASON");
  appendToken(params.output, parsed, "OS4TB_RUN_FINAL");
  if (result.stderr.trim().length > 0) {
    params.output.appendLine(`stderr=${result.stderr.trim()}`);
  }

  if (!contract.ok) {
    setStatus(params.status, "FAIL");
    const target = parsed.fields.OS4TB_TARGET_NAME ?? "unknown";
    const requestId = parsed.fields.OS4TB_RUN_REQUEST_ID ?? generatedRequest.requestId;
    const reason = parsed.fields.OS4TB_RUN_FAILURE_REASON ?? contract.reason;
    const exitCode = result.exitCode === null ? "null" : String(result.exitCode);
    vscode.window.showErrorMessage(
      `OS4TB project build/run FAIL (target=${target}, request_id=${requestId}, reason=${reason}, exit=${exitCode}).`
    );
    return;
  }

  const artifactPath = parsed.fields.OS4TB_ARTIFACT_PATH;
  if (!artifactPath) {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage(
      "OS4TB project build/run FAIL (reason=gcc_project_artifact_path_missing). Backend did not return OS4TB_ARTIFACT_PATH."
    );
    return;
  }

  const maxFileBytes = 262144;
  let artifactText = "";
  try {
    artifactText = await readUtf8FileWithEnoentRetry({
      filePath: artifactPath,
      maxBytes: maxFileBytes,
      timeoutMs: 2500,
      pollMs: 100
    });
  } catch (err) {
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB project build/run FAIL (reason=gcc_project_artifact_read_failed, detail=${(err as Error).message}).`
    );
    return;
  }

  const artifactParsed = parseKeyValueOutput(artifactText);
  const artifactFields = artifactParsed.fields;
  let projectDiagnostics: ProjectDiagnostic[] = [];
  let selectedFamily: ProjectDiagnosticFamily = "gcc";
  let resolvedProjectToolchain: ProjectResolvedToolchainProfile | undefined;
  let summary: ReturnType<typeof parseBuildRunArtifactSummary> | undefined;
  let asmBuildFinal: string | undefined;
  let asmProgramFinal: string | undefined;
  let asmProjectPass = false;

  if (payloadKind === "assemblerProjectBuildRun") {
    const assemblerFamilyRaw = artifactFields.OS4TB_ASM_PROJECT_ASSEMBLER_FAMILY;
    const assemblerFamily: ProjectDiagnosticFamily = assemblerFamilyRaw === "vasm" ? "vasm" : "gnu_as";
    selectedFamily = assemblerFamily;
    asmBuildFinal = artifactFields.OS4TB_ASM_PROJECT_BUILD_FINAL;
    asmProgramFinal = artifactFields.OS4TB_PROGRAM_FINAL;
    asmProjectPass = asmBuildFinal === "PASS" && (asmProgramFinal === "PASS" || asmProgramFinal === "NOT_RUN");
    const diagnosticsPath = (() => {
      try {
        return resolveCompilerDiagnosticsPath(artifactPath, artifactFields.OS4TB_ASM_BUILD_DIAGNOSTIC_FILE);
      } catch (err) {
        if (!asmProjectPass) {
          setStatus(params.status, "FAIL");
          vscode.window.showErrorMessage(`OS4TB project build/run FAIL (reason=${(err as Error).message}).`);
          return undefined;
        }
        return undefined;
      }
    })();
    let diagnosticsText = "";
    if (diagnosticsPath) {
      try {
        diagnosticsText = await readUtf8FileWithEnoentRetry({
          filePath: diagnosticsPath,
          maxBytes: maxFileBytes,
          timeoutMs: 2500,
          pollMs: 100
        });
      } catch (err) {
        if (!asmProjectPass) {
          setStatus(params.status, "FAIL");
          vscode.window.showErrorMessage(
            `OS4TB project build/run FAIL (reason=assembler_project_diagnostics_read_failed, detail=${(err as Error).message}).`
          );
          return;
        }
      }
    }
    projectDiagnostics = parseProjectDiagnosticsByFamily({
      family: assemblerFamily,
      assemblerTexts: diagnosticsText ? [diagnosticsText] : [],
      linkText: diagnosticsText
    });
  } else {
    resolvedProjectToolchain = selectedToolchain!;
    summary = parseBuildRunArtifactSummary(artifactFields);
    selectedFamily = artifactFields.OS4TB_GCC_PROJECT_TOOLCHAIN_FAMILY === "vbcc" ||
        artifactFields.OS4TB_GCC_PROJECT_TOOLCHAIN_FAMILY === "gcc"
      ? artifactFields.OS4TB_GCC_PROJECT_TOOLCHAIN_FAMILY
      : resolvedProjectToolchain.family;
    const diagnosticsPath = (() => {
      try {
        return resolveCompilerDiagnosticsPath(artifactPath, artifactFields.OS4TB_GCC_BUILD_DIAGNOSTIC_FILE);
      } catch (err) {
        if (selectedFamily === "gcc") {
          setStatus(params.status, "FAIL");
          vscode.window.showErrorMessage(`OS4TB project build/run FAIL (reason=${(err as Error).message}).`);
        }
        return undefined;
      }
    })();
    if (!diagnosticsPath && selectedFamily === "gcc") {
      return;
    }

    let diagnosticsText = "";
    if (diagnosticsPath) {
      try {
        diagnosticsText = await readUtf8FileWithEnoentRetry({
          filePath: diagnosticsPath,
          maxBytes: maxFileBytes,
          timeoutMs: 2500,
          pollMs: 100
        });
      } catch (err) {
        if (selectedFamily === "gcc") {
          setStatus(params.status, "FAIL");
          vscode.window.showErrorMessage(
            `OS4TB project build/run FAIL (reason=gcc_project_diagnostics_read_failed, detail=${(err as Error).message}).`
          );
          return;
        }
        diagnosticsText = "";
      }
    }

    const artifactSourceCountRaw = artifactFields.OS4TB_GCC_PROJECT_SOURCE_COUNT;
    const artifactSourceCount = artifactSourceCountRaw && /^[0-9]+$/.test(artifactSourceCountRaw)
      ? Number.parseInt(artifactSourceCountRaw, 10)
      : params.sourceStagedRelativePaths.length;
    const assemblerFamilyRaw = artifactFields.OS4TB_GCC_PROJECT_ASSEMBLER_FAMILY;
    const assemblerFamily: ProjectDiagnosticFamily | undefined = assemblerFamilyRaw === "gnu_as" || assemblerFamilyRaw === "vasm"
      ? assemblerFamilyRaw
      : undefined;
    const vbccCompileTexts: string[] = [];
    let sawGccSource = false;

    for (let i = 0; i < artifactSourceCount; i += 1) {
      const compileOutput = await tryReadFirstExistingTextSidecar({
        candidatePaths: [
          buildProjectArtifactSidecarPath(artifactPath, `project-compile-${i}.txt`),
          path.join(path.dirname(artifactPath), `.project-compile-output-${i}.txt`)
        ],
        maxBytes: maxFileBytes,
        timeoutMs: 1000,
        pollMs: 100
      });
      if (!compileOutput) {
        continue;
      }
      const sourceType = artifactFields[`OS4TB_GCC_PROJECT_SOURCE_${i}_TYPE`] === "asm" ? "asm" : "c";
      const sourceFamily: ProjectDiagnosticFamily =
        sourceType === "asm" && assemblerFamily ? assemblerFamily : selectedFamily;
      if (sourceFamily === "vbcc") {
        vbccCompileTexts.push(compileOutput);
      } else if (sourceFamily === "gcc") {
        sawGccSource = true;
        projectDiagnostics.push(...parseProjectDiagnosticsByFamily({ family: "gcc", gccText: compileOutput }));
      } else if (sourceFamily === "gnu_as") {
        projectDiagnostics.push(...parseProjectDiagnosticsByFamily({ family: "gnu_as", assemblerTexts: [compileOutput] }));
      } else if (sourceFamily === "vasm") {
        projectDiagnostics.push(...parseProjectDiagnosticsByFamily({ family: "vasm", assemblerTexts: [compileOutput] }));
      }
    }

    if (selectedFamily === "vbcc" && diagnosticsText.trim().length > 0) {
      vbccCompileTexts.push(diagnosticsText);
    } else if (selectedFamily === "gcc" && diagnosticsText.trim().length > 0 && !sawGccSource) {
      projectDiagnostics.push(...parseProjectDiagnosticsByFamily({ family: "gcc", gccText: diagnosticsText }));
    }

    const linkText = await tryReadFirstExistingTextSidecar({
      candidatePaths: [
        buildProjectArtifactSidecarPath(artifactPath, "project-link.txt"),
        path.join(path.dirname(artifactPath), ".project-link-output.txt")
      ],
      maxBytes: maxFileBytes,
      timeoutMs: 1000,
      pollMs: 100
    });
    if (selectedFamily === "vbcc") {
      projectDiagnostics.push(...parseProjectDiagnosticsByFamily({
        family: "vbcc",
        vbccCompileTexts,
        linkText
      }));
    } else if (selectedFamily === "gcc" && linkText) {
      projectDiagnostics.push(...parseProjectDiagnosticsByFamily({
        family: "gcc",
        linkText
      }));
    }
  }

  projectDiagnostics = deduplicateProjectDiagnostics(projectDiagnostics);

  const counts = summarizeProjectDiagnostics(projectDiagnostics);
  const stagedRelativeSourceMap: Record<string, string> = {};
  const stagedEntries: Array<{ stagedRelativePath: string; hostPath: string }> = [];
  for (let i = 0; i < stagedSourcePaths.length; i += 1) {
    stagedRelativeSourceMap[stagedSourcePaths[i]] = params.sourceFilePaths[i];
    stagedEntries.push({ stagedRelativePath: stagedSourcePaths[i], hostPath: params.sourceFilePaths[i] });
  }
  for (let i = 0; i < stagedHeaderPaths.length; i += 1) {
    stagedRelativeSourceMap[stagedHeaderPaths[i]] = params.headerFilePaths[i];
    stagedEntries.push({ stagedRelativePath: stagedHeaderPaths[i], hostPath: params.headerFilePaths[i] });
  }
  const stagedBasenameSourceMap = buildUniqueBasenameMap(stagedEntries);
  const problemPlan = buildProjectProblemPublishPlan(projectDiagnostics, incomingDirectory, {
    sourceRemap,
    stagedRelativeSourceMap,
    stagedBasenameSourceMap
  });
  if (selectedFamily === "gcc" && problemPlan.unmappedCount > 0) {
    params.output.appendLine(`OS4TB_GCC_PROBLEMS_UNMAPPED=${problemPlan.unmappedCount}`);
    params.output.appendLine("OS4TB_GCC_PROJECT_BUILD_FINAL=FAIL");
    params.output.appendLine("OS4TB_GCC_BUILD_FINAL=FAIL");
    params.output.appendLine("OS4TB_PROGRAM_FINAL=NOT_RUN");
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB project build/run FAIL (reason=problems_unmapped_diagnostics, unmapped=${problemPlan.unmappedCount}).`
    );
    return;
  }

  replaceProblemsCollection(
    {
      clear: () => params.gccProblems.clear(),
      set: (entries) => {
        const mappedEntries: Array<[vscode.Uri, vscode.Diagnostic[]]> = entries.map(([filePath, diags]) => [
          vscode.Uri.file(filePath),
          diags
        ]);
        params.gccProblems.set(mappedEntries);
      }
    },
    Object.fromEntries(
      Object.entries(problemPlan.entriesByFile).map(([filePath, entries]) => {
        const mapped = entries.map((entry) => {
          const range = new vscode.Range(entry.lineZero, entry.startColumnZero, entry.lineZero, entry.endColumnZero);
          let severity = vscode.DiagnosticSeverity.Information;
          if (entry.severity === "error") {
            severity = vscode.DiagnosticSeverity.Error;
          } else if (entry.severity === "warning") {
            severity = vscode.DiagnosticSeverity.Warning;
          }
          const diagnostic = new vscode.Diagnostic(range, entry.message, severity);
          diagnostic.source = entry.source;
          return diagnostic;
        });
        return [filePath, mapped];
      })
    )
  );

  if (payloadKind === "assemblerProjectBuildRun") {
    if (!asmProjectPass) {
      setStatus(params.status, "FAIL");
      vscode.window.showErrorMessage(
        `OS4TB project build/run FAIL (reason=assembler_project_stage_failed, asm_build=${asmBuildFinal ?? "unknown"}, program=${asmProgramFinal ?? "unknown"}).`
      );
      return;
    }
    setStatus(params.status, "PASS");
    vscode.window.showInformationMessage(
      `${params.successLabel} (request_id=${generatedRequest.requestId}, assembler=${artifactFields.OS4TB_ASM_PROJECT_ASSEMBLER_ID ?? "unknown"})`
    );
    return;
  }

  const buildSummary = summary!;
  const activeProjectToolchain = resolvedProjectToolchain!;
  const executableName = buildSummary.executableName ?? buildExecutableBasename(generatedRequest.requestId);
  const outcome = evaluateBuildRunOutcome(buildSummary, {
    errorCount: counts.errorCount,
    warningCount: counts.warningCount,
    noteCount: counts.infoCount
  });
  const artifactSourceCountRaw = artifactFields.OS4TB_GCC_PROJECT_SOURCE_COUNT;
  const artifactSourceCount = artifactSourceCountRaw && /^[0-9]+$/.test(artifactSourceCountRaw)
    ? Number.parseInt(artifactSourceCountRaw, 10)
    : params.sourceFilePaths.length;

  params.output.appendLine(`OS4TB_GCC_BUILD_EXIT=${buildSummary.buildExit ?? "missing"}`);
  params.output.appendLine(`OS4TB_GCC_EXECUTABLE_STATUS=${buildSummary.executableStatus ?? "missing"}`);
  params.output.appendLine(`OS4TB_GCC_EXECUTABLE_NAME=${executableName}`);
  params.output.appendLine(`OS4TB_PROGRAM_EXIT=${buildSummary.programExit ?? "missing"}`);
  params.output.appendLine(`OS4TB_GCC_PROJECT_SOURCE_COUNT=${artifactSourceCount}`);
  for (let i = 0; i < artifactSourceCount; i += 1) {
    params.output.appendLine(`OS4TB_GCC_PROJECT_SOURCE_${i}=${artifactFields[`OS4TB_GCC_PROJECT_SOURCE_${i}`] ?? "missing"}`);
    params.output.appendLine(
      `OS4TB_GCC_PROJECT_OBJECT_${i}=${artifactFields[`OS4TB_GCC_PROJECT_OBJECT_${i}`] ?? buildProjectObjectBasename(generatedRequest.requestId, i)}`
    );
    params.output.appendLine(
      `OS4TB_GCC_PROJECT_COMPILE_${i}_EXIT=${artifactFields[`OS4TB_GCC_PROJECT_COMPILE_${i}_EXIT`] ?? "missing"}`
    );
  }
  const artifactHeaderCountRaw = artifactFields.OS4TB_GCC_PROJECT_HEADER_COUNT;
  const artifactHeaderCount = artifactHeaderCountRaw && /^[0-9]+$/.test(artifactHeaderCountRaw)
    ? Number.parseInt(artifactHeaderCountRaw, 10)
    : params.headerFilePaths.length;
  params.output.appendLine(`OS4TB_GCC_PROJECT_HEADER_COUNT=${artifactHeaderCount}`);
  for (let i = 0; i < artifactHeaderCount; i += 1) {
    params.output.appendLine(`OS4TB_GCC_PROJECT_HEADER_${i}=${artifactFields[`OS4TB_GCC_PROJECT_HEADER_${i}`] ?? "missing"}`);
  }
  const artifactIncludeCountRaw = artifactFields.OS4TB_GCC_PROJECT_INCLUDE_COUNT;
  const artifactIncludeCount = artifactIncludeCountRaw && /^[0-9]+$/.test(artifactIncludeCountRaw)
    ? Number.parseInt(artifactIncludeCountRaw, 10)
    : params.includeStagedRelativePaths.length;
  params.output.appendLine(`OS4TB_GCC_PROJECT_INCLUDE_COUNT=${artifactIncludeCount}`);
  for (let i = 0; i < artifactIncludeCount; i += 1) {
    params.output.appendLine(`OS4TB_GCC_PROJECT_INCLUDE_${i}=${artifactFields[`OS4TB_GCC_PROJECT_INCLUDE_${i}`] ?? "missing"}`);
  }
  const artifactDefineCountRaw = artifactFields.OS4TB_GCC_PROJECT_DEFINE_COUNT;
  const artifactDefineCount = artifactDefineCountRaw && /^[0-9]+$/.test(artifactDefineCountRaw)
    ? Number.parseInt(artifactDefineCountRaw, 10)
    : params.defineEntries.length;
  params.output.appendLine(`OS4TB_GCC_PROJECT_DEFINE_COUNT=${artifactDefineCount}`);
  for (let i = 0; i < artifactDefineCount; i += 1) {
    params.output.appendLine(`OS4TB_GCC_PROJECT_DEFINE_${i}=${artifactFields[`OS4TB_GCC_PROJECT_DEFINE_${i}`] ?? "missing"}`);
  }
  const artifactLibraryCountRaw = artifactFields.OS4TB_GCC_PROJECT_LIBRARY_COUNT;
  const artifactLibraryCount = artifactLibraryCountRaw && /^[0-9]+$/.test(artifactLibraryCountRaw)
    ? Number.parseInt(artifactLibraryCountRaw, 10)
    : params.libraryNames.length;
  params.output.appendLine(`OS4TB_GCC_PROJECT_LIBRARY_COUNT=${artifactLibraryCount}`);
  for (let i = 0; i < artifactLibraryCount; i += 1) {
    params.output.appendLine(`OS4TB_GCC_PROJECT_LIBRARY_${i}=${artifactFields[`OS4TB_GCC_PROJECT_LIBRARY_${i}`] ?? "missing"}`);
  }
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_C_STANDARD=${artifactFields.OS4TB_GCC_PROJECT_C_STANDARD ?? params.buildProfile.cStandard}`
  );
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_WARNING_LEVEL=${artifactFields.OS4TB_GCC_PROJECT_WARNING_LEVEL ?? params.buildProfile.warningLevel}`
  );
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_OPTIMIZATION=${artifactFields.OS4TB_GCC_PROJECT_OPTIMIZATION ?? params.buildProfile.optimization}`
  );
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_DEBUG_SYMBOLS=${artifactFields.OS4TB_GCC_PROJECT_DEBUG_SYMBOLS ?? params.buildProfile.debugSymbols}`
  );
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_TOOLCHAIN_ID=${artifactFields.OS4TB_GCC_PROJECT_TOOLCHAIN_ID ?? activeProjectToolchain.id}`
  );
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_TOOLCHAIN_SOURCE=${artifactFields.OS4TB_GCC_PROJECT_TOOLCHAIN_SOURCE ?? activeProjectToolchain.source}`
  );
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_TOOLCHAIN_FAMILY=${artifactFields.OS4TB_GCC_PROJECT_TOOLCHAIN_FAMILY ?? activeProjectToolchain.family}`
  );
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_TOOLCHAIN_VERSION=${artifactFields.OS4TB_GCC_PROJECT_TOOLCHAIN_VERSION ?? activeProjectToolchain.version}`
  );
  const resolvedGccToolchain = activeProjectToolchain.family === "gcc" ? activeProjectToolchain : undefined;
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_CC1_PREFIX=${artifactFields.OS4TB_GCC_PROJECT_CC1_PREFIX ?? resolvedGccToolchain?.cc1Prefix ?? "n/a"}`
  );
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_GCC_BIN_PREFIX=${artifactFields.OS4TB_GCC_PROJECT_GCC_BIN_PREFIX ?? resolvedGccToolchain?.gccBinPrefix ?? "n/a"}`
  );
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_DIR=${artifactFields.OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_DIR ?? resolvedGccToolchain?.internalIncludeDirs?.[0] ?? "n/a"}`
  );
  const artifactInternalIncludeCount = Number.parseInt(artifactFields.OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_COUNT ?? "", 10);
  const resolvedInternalIncludeDirs = resolvedGccToolchain?.internalIncludeDirs ?? [];
  const internalIncludeCount = Number.isInteger(artifactInternalIncludeCount) && artifactInternalIncludeCount >= 0
    ? artifactInternalIncludeCount
    : resolvedInternalIncludeDirs.length;
  params.output.appendLine(`OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_COUNT=${internalIncludeCount}`);
  for (let i = 0; i < internalIncludeCount; i += 1) {
    params.output.appendLine(
      `OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_${i}=${artifactFields[`OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_${i}`] ?? resolvedInternalIncludeDirs[i] ?? "missing"}`
    );
  }
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_LD_PATH=${artifactFields.OS4TB_GCC_PROJECT_LD_PATH ?? resolvedGccToolchain?.ldPath ?? "n/a"}`
  );
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_DIRECTORY=${artifactFields.OS4TB_GCC_PROJECT_DIRECTORY ?? buildGuestProjectDirectoryPath(generatedRequest.requestId)}`
  );
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_MANIFEST=${artifactFields.OS4TB_GCC_PROJECT_MANIFEST ?? buildGuestProjectManifestPath(generatedRequest.requestId)}`
  );
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_MANIFEST_STATUS=${artifactFields.OS4TB_GCC_PROJECT_MANIFEST_STATUS ?? "missing"}`
  );
  if (artifactFields.OS4TB_GCC_PROJECT_COMMAND_BUFFER_STATUS) {
    params.output.appendLine(
      `OS4TB_GCC_PROJECT_COMMAND_BUFFER_STATUS=${artifactFields.OS4TB_GCC_PROJECT_COMMAND_BUFFER_STATUS}`
    );
  }
  params.output.appendLine(`OS4TB_GCC_PROJECT_LINK_EXIT=${artifactFields.OS4TB_GCC_PROJECT_LINK_EXIT ?? "missing"}`);
  params.output.appendLine(
    `OS4TB_GCC_PROJECT_EXECUTABLE_STATUS=${artifactFields.OS4TB_GCC_PROJECT_EXECUTABLE_STATUS ?? "missing"}`
  );
  if (artifactFields.OS4TB_GCC_LINK_STRATEGY) {
    params.output.appendLine(`OS4TB_GCC_LINK_STRATEGY=${artifactFields.OS4TB_GCC_LINK_STRATEGY}`);
  }
  if (artifactFields.OS4TB_GCC_DIRECT_LINK_EXIT) {
    params.output.appendLine(`OS4TB_GCC_DIRECT_LINK_EXIT=${artifactFields.OS4TB_GCC_DIRECT_LINK_EXIT}`);
  }
  if (artifactFields.OS4TB_GCC_DIRECT_LINK_FINAL) {
    params.output.appendLine(`OS4TB_GCC_DIRECT_LINK_FINAL=${artifactFields.OS4TB_GCC_DIRECT_LINK_FINAL}`);
  }
  if (artifactFields.OS4TB_GCC_DIRECT_LINK_EXECUTABLE_STATUS) {
    params.output.appendLine(
      `OS4TB_GCC_DIRECT_LINK_EXECUTABLE_STATUS=${artifactFields.OS4TB_GCC_DIRECT_LINK_EXECUTABLE_STATUS}`
    );
  }
  if (artifactFields.OS4TB_GCC_DIRECT_LIBGCC_STATUS) {
    params.output.appendLine(`OS4TB_GCC_DIRECT_LIBGCC_STATUS=${artifactFields.OS4TB_GCC_DIRECT_LIBGCC_STATUS}`);
  }
  if (artifactFields.OS4TB_GCC_DIRECT_LIBGCC_EH_STATUS) {
    params.output.appendLine(`OS4TB_GCC_DIRECT_LIBGCC_EH_STATUS=${artifactFields.OS4TB_GCC_DIRECT_LIBGCC_EH_STATUS}`);
  }
  if (artifactFields.OS4TB_PROGRAM_OUTPUT_FILE) {
    params.output.appendLine(`OS4TB_PROGRAM_OUTPUT_FILE=${artifactFields.OS4TB_PROGRAM_OUTPUT_FILE}`);
  }
  params.output.appendLine(`OS4TB_GCC_BUILD_ERRORS=${counts.errorCount}`);
  params.output.appendLine(`OS4TB_GCC_BUILD_WARNINGS=${counts.warningCount}`);
  params.output.appendLine(`OS4TB_GCC_BUILD_NOTES=${counts.infoCount}`);
  params.output.appendLine(`OS4TB_GCC_PROBLEMS_PUBLISHED=${problemPlan.mappedCount}`);
  params.output.appendLine(`OS4TB_GCC_PROBLEMS_ERRORS=${problemPlan.errorCount}`);
  params.output.appendLine(`OS4TB_GCC_PROBLEMS_WARNINGS=${problemPlan.warningCount}`);
  params.output.appendLine(`OS4TB_GCC_PROBLEMS_NOTES=${problemPlan.infoCount}`);
  params.output.appendLine(`OS4TB_GCC_PROBLEMS_UNMAPPED=${problemPlan.unmappedCount}`);
  params.output.appendLine(`OS4TB_PROJECT_UNBOUND_DIAGNOSTIC_COUNT=${problemPlan.unboundDiagnostics.length}`);
  for (let i = 0; i < problemPlan.unboundDiagnostics.length && i < 8; i += 1) {
    const diagnostic = problemPlan.unboundDiagnostics[i];
    const parts = [
      `family=${diagnostic.family}`,
      `stage=${diagnostic.stage}`,
      `severity=${diagnostic.severity}`,
      `code=${diagnostic.code ?? "none"}`,
      `file=${diagnostic.file ?? "none"}`,
      `line=${diagnostic.line ?? "none"}`,
      `message=${diagnostic.message}`
    ];
    params.output.appendLine(`OS4TB_PROJECT_UNBOUND_DIAGNOSTIC_${i}=${parts.join(";")}`);
  }
  params.output.appendLine("OS4TB_GCC_PROBLEMS_FINAL=PASS");

  const primaryErrorLabel = selectProblemSummaryLabel(problemPlan, "project");

  if (outcome.buildFinal === "FAIL") {
    params.output.appendLine("OS4TB_GCC_PROJECT_BUILD_FINAL=FAIL");
    params.output.appendLine("OS4TB_GCC_BUILD_FINAL=FAIL");
    params.output.appendLine("OS4TB_PROGRAM_FINAL=NOT_RUN");
    setStatus(params.status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB project build FAIL (${primaryErrorLabel}, errors=${counts.errorCount}, warnings=${counts.warningCount})`
    );
    return;
  }

  params.output.appendLine("OS4TB_GCC_PROJECT_BUILD_FINAL=PASS");
  params.output.appendLine("OS4TB_GCC_BUILD_FINAL=PASS");
  if (outcome.programFinal === "PASS") {
    params.output.appendLine("OS4TB_PROGRAM_FINAL=PASS");
    setStatus(params.status, "PASS");
    vscode.window.showInformationMessage(`${params.successLabel} (${artifactSourceCount} sources, exit=0)`);
    return;
  }

  params.output.appendLine("OS4TB_PROGRAM_FINAL=FAIL");
  setStatus(params.status, "FAIL");
  vscode.window.showErrorMessage(`OS4TB project run FAIL (exit=${buildSummary.programExit ?? "unknown"})`);
}

async function runGccDiagnosticsCommand(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  status: vscode.StatusBarItem,
  gccProblems: vscode.DiagnosticCollection
): Promise<void> {
  gccProblems.clear();
  const cfg = getConfig();
  if (!cfg.configPath) {
    vscode.window.showErrorMessage("Set os4TestBridge.configPath before running GCC diagnostics.");
    setStatus(status, "FAIL");
    return;
  }

  try {
    validateRequiredPayloadSetting("gccDiagnostics", cfg.gccDiagnosticsPayloadName);
  } catch (err) {
    setStatus(status, "FAIL");
    const message = (err as Error).message;
    if (message === "gcc_diagnostics_payload_setting_missing") {
      vscode.window.showErrorMessage(
        "Set os4TestBridge.gccDiagnosticsPayloadName before testing GCC diagnostics."
      );
      return;
    }
    vscode.window.showErrorMessage(`GCC diagnostics payload validation failed: ${message}`);
    return;
  }

  const requestDirectory = resolveGeneratedRequestDirectory(context, cfg.generatedRequestDirectory);
  const client = new Os4tbClient(cfg.executablePath, cfg.gccDiagnosticsTimeoutMs);
  setStatus(status, "Running GCC diagnostics...");

  let generatedRequest;
  try {
    generatedRequest = await createGeneratedRequest({
      kind: "gccDiagnostics",
      payloadName: cfg.gccDiagnosticsPayloadName,
      directory: requestDirectory
    });
  } catch (err) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(`Unable to generate GCC diagnostics request: ${(err as Error).message}`);
    return;
  }

  const result = await client.runRequest(cfg.configPath, generatedRequest.requestPath, {
    orchestratorTimeoutSeconds: cfg.gccDiagnosticsTimeoutSeconds
  });
  const parsed = parseKeyValueOutput(result.stdout);
  const contract = evaluateRunContract(result.exitCode, parsed);

  appendInvocation(output, "Test GCC Diagnostics", result);
  output.appendLine("command_class=test_gcc_diagnostics");
  output.appendLine(`request_path=${generatedRequest.requestPath}`);
  appendToken(output, parsed, "OS4TB_TARGET_NAME");
  appendToken(output, parsed, "OS4TB_RUN_REQUEST_ID");
  appendToken(output, parsed, "OS4TB_RUN_OPERATION");
  appendToken(output, parsed, "OS4TB_LOG_PATH");
  appendToken(output, parsed, "OS4TB_RUN_FAILURE_REASON");
  appendToken(output, parsed, "OS4TB_RUN_FINAL");
  if (result.stderr.trim().length > 0) {
    output.appendLine(`stderr=${result.stderr.trim()}`);
  }

  if (!contract.ok) {
    setStatus(status, "FAIL");
    const target = parsed.fields.OS4TB_TARGET_NAME ?? "unknown";
    const requestId = parsed.fields.OS4TB_RUN_REQUEST_ID ?? generatedRequest.requestId;
    const reason = parsed.fields.OS4TB_RUN_FAILURE_REASON ?? contract.reason;
    const exitCode = result.exitCode === null ? "null" : String(result.exitCode);
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (target=${target}, request_id=${requestId}, reason=${reason}, exit=${exitCode}).`
    );
    return;
  }

  const logPath = parsed.fields.OS4TB_LOG_PATH;
  const artifactPath = parsed.fields.OS4TB_ARTIFACT_PATH;
  if (!artifactPath) {
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      "OS4TB GCC diagnostics FAIL (reason=gcc_artifact_path_missing). Backend did not return OS4TB_ARTIFACT_PATH."
    );
    return;
  }

  const maxFileBytes = 262144;
  let artifactText = "";
  try {
    artifactText = await readUtf8FileWithEnoentRetry({
      filePath: artifactPath,
      maxBytes: maxFileBytes,
      timeoutMs: 2500,
      pollMs: 100
    });
  } catch (err) {
    setStatus(status, "FAIL");
    const message = (err as Error).message;
    if (message.startsWith("file_too_large:")) {
      const bytes = message.slice("file_too_large:".length);
      vscode.window.showErrorMessage(
        `OS4TB GCC diagnostics FAIL (reason=gcc_artifact_too_large, bytes=${bytes}).`
      );
      return;
    }
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (reason=gcc_artifact_read_failed, detail=${(err as Error).message}).`
    );
    return;
  }

  const artifactParsed = parseKeyValueOutput(artifactText);
  const artifactFields = artifactParsed.fields;
  const artifactVersion = artifactFields.OS4TB_GCC_VERSION;
  const cc1Discovery = artifactFields.OS4TB_GCC_CC1_DISCOVERY;
  const cc1Path = artifactFields.OS4TB_GCC_CC1_PATH;
  const childEnv = artifactFields.OS4TB_GCC_CHILD_ENV;
  const asDiscovery = artifactFields.OS4TB_GCC_AS_DISCOVERY;
  const asPath = artifactFields.OS4TB_GCC_AS_PATH;
  const toolchainEnv = artifactFields.OS4TB_GCC_TOOLCHAIN_ENV;
  const versionQueryExit = artifactFields.OS4TB_GCC_VERSION_QUERY_EXIT;
  const errorFixtureState = artifactFields.OS4TB_GCC_ERROR_FIXTURE;
  const warningFixtureState = artifactFields.OS4TB_GCC_WARNING_FIXTURE;
  const errorCompileExit = artifactFields.OS4TB_GCC_ERROR_COMPILE_EXIT;
  const warningCompileExit = artifactFields.OS4TB_GCC_WARNING_COMPILE_EXIT;
  const probeFinal = artifactFields.OS4TB_GCC_PROBE_FINAL;

  const diagnosticsPath = (() => {
    try {
      return resolveCompilerDiagnosticsPath(artifactPath, artifactFields.OS4TB_GCC_DIAGNOSTIC_FILE);
    } catch (err) {
      setStatus(status, "FAIL");
      vscode.window.showErrorMessage(
        `OS4TB GCC diagnostics FAIL (reason=${(err as Error).message}).`
      );
      return undefined;
    }
  })();
  if (!diagnosticsPath) {
    return;
  }
  output.appendLine(`OS4TB_GCC_DIAGNOSTIC_PATH=${diagnosticsPath}`);

  let diagnosticsText = "";
  try {
    diagnosticsText = await readUtf8FileWithEnoentRetry({
      filePath: diagnosticsPath,
      maxBytes: maxFileBytes,
      timeoutMs: 2500,
      pollMs: 100
    });
  } catch (err) {
    setStatus(status, "FAIL");
    const message = (err as Error).message;
    if (message.startsWith("file_too_large:")) {
      const bytes = message.slice("file_too_large:".length);
      vscode.window.showErrorMessage(
        `OS4TB GCC diagnostics FAIL (reason=gcc_diagnostics_file_too_large, bytes=${bytes}).`
      );
      return;
    }
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (reason=gcc_diagnostics_read_failed, detail=${(err as Error).message}).`
    );
    return;
  }

  const diagnostics = parseGccDiagnostics(diagnosticsText);
  const summary = summarizeGccDiagnostics(diagnostics);
  const gccVersion = artifactVersion ?? extractGccVersion(diagnosticsText);
  output.appendLine(`OS4TB_GCC_DIAGNOSTIC_COUNT=${summary.total}`);
  output.appendLine(`OS4TB_GCC_ERROR_COUNT=${summary.errorCount}`);
  output.appendLine(`OS4TB_GCC_WARNING_COUNT=${summary.warningCount}`);
  output.appendLine(`OS4TB_GCC_NOTE_COUNT=${summary.noteCount}`);
  if (gccVersion) {
    output.appendLine(`OS4TB_GCC_VERSION=${gccVersion}`);
  }

  if (!gccVersion || !/^11\.5(\.|$)/.test(gccVersion)) {
    output.appendLine("OS4TB_GCC_DIAGNOSTICS=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS_REASON=unexpected_gcc_version");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (reason=unexpected_gcc_version, value=${gccVersion ?? "missing"}).`
    );
    return;
  }

  if (versionQueryExit !== "0") {
    output.appendLine("OS4TB_GCC_DIAGNOSTICS=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS_REASON=version_query_failed");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (reason=version_query_failed, value=${versionQueryExit ?? "missing"}).`
    );
    return;
  }

  if (cc1Discovery !== "found" || childEnv !== "ready") {
    output.appendLine("OS4TB_GCC_DIAGNOSTICS=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS_REASON=cc1_discovery_failed");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (reason=cc1_discovery_failed, discovery=${cc1Discovery ?? "missing"}, child_env=${childEnv ?? "missing"}, cc1_path=${cc1Path ?? "unknown"}).`
    );
    return;
  }

  if (asDiscovery !== "found" || toolchainEnv !== "ready") {
    output.appendLine("OS4TB_GCC_DIAGNOSTICS=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS_REASON=assembler_discovery_failed");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (reason=assembler_discovery_failed, as_discovery=${asDiscovery ?? "missing"}, as_path=${asPath ?? "unknown"}, toolchain_env=${toolchainEnv ?? "missing"}).`
    );
    return;
  }

  if (errorFixtureState !== "present" || warningFixtureState !== "present") {
    output.appendLine("OS4TB_GCC_DIAGNOSTICS=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS_REASON=fixture_missing");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (reason=fixture_missing, error_fixture=${errorFixtureState ?? "missing"}, warning_fixture=${warningFixtureState ?? "missing"}).`
    );
    return;
  }

  if (!errorCompileExit || errorCompileExit === "0") {
    output.appendLine("OS4TB_GCC_DIAGNOSTICS=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS_REASON=error_fixture_exit_unexpected");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (reason=error_fixture_exit_unexpected, value=${errorCompileExit ?? "missing"}).`
    );
    return;
  }

  if (warningCompileExit !== "0") {
    output.appendLine("OS4TB_GCC_DIAGNOSTICS=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS_REASON=warning_fixture_exit_unexpected");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (reason=warning_fixture_exit_unexpected, value=${warningCompileExit ?? "missing"}).`
    );
    return;
  }

  if (probeFinal !== "PASS") {
    output.appendLine("OS4TB_GCC_DIAGNOSTICS=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS_REASON=probe_final_not_pass");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (reason=probe_final_not_pass, value=${probeFinal ?? "missing"}).`
    );
    return;
  }

  if (summary.total === 0 || summary.errorCount < 1 || summary.warningCount < 1) {
    output.appendLine("OS4TB_GCC_DIAGNOSTICS=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS_REASON=insufficient_diagnostics_found");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      "OS4TB GCC diagnostics FAIL (reason=insufficient_diagnostics_found)."
    );
    return;
  }

  let incomingDirectory: string | undefined;
  try {
    incomingDirectory = await loadBridgeIncomingDirectory(cfg.configPath);
  } catch (err) {
    output.appendLine("OS4TB_GCC_PROBLEMS_PUBLISHED=0");
    output.appendLine("OS4TB_GCC_PROBLEMS_ERRORS=0");
    output.appendLine("OS4TB_GCC_PROBLEMS_WARNINGS=0");
    output.appendLine("OS4TB_GCC_PROBLEMS_NOTES=0");
    output.appendLine(`OS4TB_GCC_PROBLEMS_UNMAPPED=${summary.total}`);
    output.appendLine("OS4TB_GCC_PROBLEMS_FINAL=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS_REASON=problems_config_read_failed");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (reason=problems_config_read_failed, detail=${(err as Error).message}).`
    );
    return;
  }

  if (!incomingDirectory) {
    output.appendLine("OS4TB_GCC_PROBLEMS_PUBLISHED=0");
    output.appendLine("OS4TB_GCC_PROBLEMS_ERRORS=0");
    output.appendLine("OS4TB_GCC_PROBLEMS_WARNINGS=0");
    output.appendLine("OS4TB_GCC_PROBLEMS_NOTES=0");
    output.appendLine(`OS4TB_GCC_PROBLEMS_UNMAPPED=${summary.total}`);
    output.appendLine("OS4TB_GCC_PROBLEMS_FINAL=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS_REASON=problems_incoming_dir_missing");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      "OS4TB GCC diagnostics FAIL (reason=problems_incoming_dir_missing)."
    );
    return;
  }

  const problemPlan = buildProblemPublishPlan(diagnostics, incomingDirectory);
  if (problemPlan.unmappedCount > 0) {
    output.appendLine("OS4TB_GCC_PROBLEMS_PUBLISHED=0");
    output.appendLine("OS4TB_GCC_PROBLEMS_ERRORS=0");
    output.appendLine("OS4TB_GCC_PROBLEMS_WARNINGS=0");
    output.appendLine("OS4TB_GCC_PROBLEMS_NOTES=0");
    output.appendLine(`OS4TB_GCC_PROBLEMS_UNMAPPED=${problemPlan.unmappedCount}`);
    output.appendLine("OS4TB_GCC_PROBLEMS_FINAL=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS=FAIL");
    output.appendLine("OS4TB_GCC_DIAGNOSTICS_REASON=problems_unmapped_diagnostics");
    setStatus(status, "FAIL");
    vscode.window.showErrorMessage(
      `OS4TB GCC diagnostics FAIL (reason=problems_unmapped_diagnostics, unmapped=${problemPlan.unmappedCount}).`
    );
    return;
  }

  const vscodeEntries: Array<[string, vscode.Diagnostic[]]> = [];
  for (const [filePath, entries] of Object.entries(problemPlan.entriesByFile)) {
    const diagnosticsForFile = entries.map((entry) => {
      const range = new vscode.Range(
        entry.lineZero,
        entry.startColumnZero,
        entry.lineZero,
        entry.endColumnZero
      );
      let severity = vscode.DiagnosticSeverity.Information;
      if (entry.severity === "error") {
        severity = vscode.DiagnosticSeverity.Error;
      } else if (entry.severity === "warning") {
        severity = vscode.DiagnosticSeverity.Warning;
      }
      const diagnostic = new vscode.Diagnostic(range, entry.message, severity);
      diagnostic.source = entry.source;
      return diagnostic;
    });
    vscodeEntries.push([filePath, diagnosticsForFile]);
  }

  replaceProblemsCollection(
    {
      clear: () => gccProblems.clear(),
      set: (entries) => {
        const mappedEntries: Array<[vscode.Uri, vscode.Diagnostic[]]> = entries.map(([filePath, diags]) => [
          vscode.Uri.file(filePath),
          diags
        ]);
        gccProblems.set(mappedEntries);
      }
    },
    Object.fromEntries(vscodeEntries)
  );
  output.appendLine(`OS4TB_GCC_PROBLEMS_PUBLISHED=${problemPlan.mappedCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_ERRORS=${problemPlan.errorCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_WARNINGS=${problemPlan.warningCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_NOTES=${problemPlan.noteCount}`);
  output.appendLine(`OS4TB_GCC_PROBLEMS_UNMAPPED=${problemPlan.unmappedCount}`);
  output.appendLine("OS4TB_GCC_PROBLEMS_FINAL=PASS");

  output.appendLine("OS4TB_GCC_DIAGNOSTICS=PASS");
  setStatus(status, "PASS");
  vscode.window.showInformationMessage(
    `OS4TB GCC diagnostics PASS (count=${summary.total}, errors=${summary.errorCount}, warnings=${summary.warningCount}, notes=${summary.noteCount}).`
  );
}

function resolveGeneratedRequestDirectory(
  context: vscode.ExtensionContext,
  configuredDirectory: string
): string {
  if (configuredDirectory.length > 0) {
    return configuredDirectory;
  }
  return path.join(context.globalStorageUri.fsPath, "generated-requests");
}

function resolveToolchainDiscoveryCachePath(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "toolchain-discovery-cache.json");
}

async function resolveRequestPath(uri?: vscode.Uri): Promise<string | undefined> {
  if (uri?.fsPath && uri.fsPath.endsWith(".req")) {
    return uri.fsPath;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Select OS4TB Request File",
    filters: {
      "OS4TB Request": ["req"]
    }
  });

  if (!selected || selected.length === 0) {
    return undefined;
  }

  return selected[0].fsPath;
}

export function deactivate(): void {
  // no-op
}
