export interface TimeoutSettings {
  defaultTimeoutSeconds: number;
  inspectToolchainsTimeoutSeconds: number;
  gccDiagnosticsTimeoutSeconds: number;
  gccCompileTimeoutSeconds: number;
  gccBuildRunTimeoutSeconds: number;
}

export type TimeoutCommandKind =
  | "version"
  | "check"
  | "runRequest"
  | "run"
  | "validate"
  | "inspectToolchains"
  | "gccDiagnostics"
  | "gccCompile"
  | "gccBuildRun";

const DEFAULT_TIMEOUT_SECONDS = 45;
const DEFAULT_INSPECT_TOOLCHAINS_TIMEOUT_SECONDS = 180;
const DEFAULT_GCC_DIAGNOSTICS_TIMEOUT_SECONDS = 120;
const DEFAULT_GCC_COMPILE_TIMEOUT_SECONDS = 120;
const DEFAULT_GCC_BUILD_RUN_TIMEOUT_SECONDS = 180;
const GCC_DIAGNOSTICS_PROCESS_MARGIN_SECONDS = 10;

function normalizeTimeoutSeconds(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return value;
}

export function resolveTimeoutSettings(
  defaultTimeoutSecondsRaw: unknown,
  inspectToolchainsTimeoutSecondsRaw: unknown,
  gccDiagnosticsTimeoutSecondsRaw: unknown,
  gccCompileTimeoutSecondsRaw: unknown,
  gccBuildRunTimeoutSecondsRaw: unknown
): TimeoutSettings {
  return {
    defaultTimeoutSeconds: normalizeTimeoutSeconds(defaultTimeoutSecondsRaw, DEFAULT_TIMEOUT_SECONDS),
    inspectToolchainsTimeoutSeconds: normalizeTimeoutSeconds(
      inspectToolchainsTimeoutSecondsRaw,
      DEFAULT_INSPECT_TOOLCHAINS_TIMEOUT_SECONDS
    ),
    gccDiagnosticsTimeoutSeconds: normalizeTimeoutSeconds(
      gccDiagnosticsTimeoutSecondsRaw,
      DEFAULT_GCC_DIAGNOSTICS_TIMEOUT_SECONDS
    ),
    gccCompileTimeoutSeconds: normalizeTimeoutSeconds(
      gccCompileTimeoutSecondsRaw,
      DEFAULT_GCC_COMPILE_TIMEOUT_SECONDS
    ),
    gccBuildRunTimeoutSeconds: normalizeTimeoutSeconds(
      gccBuildRunTimeoutSecondsRaw,
      DEFAULT_GCC_BUILD_RUN_TIMEOUT_SECONDS
    )
  };
}

function timeoutMsFromSeconds(seconds: number): number {
  return Math.max(1000, Math.floor(seconds * 1000));
}

export function timeoutMsForCommand(kind: TimeoutCommandKind, settings: TimeoutSettings): number {
  if (kind === "inspectToolchains") {
    return timeoutMsFromSeconds(settings.inspectToolchainsTimeoutSeconds);
  }
  if (kind === "gccDiagnostics") {
    return timeoutMsFromSeconds(settings.gccDiagnosticsTimeoutSeconds);
  }
  if (kind === "gccCompile") {
    return timeoutMsFromSeconds(settings.gccCompileTimeoutSeconds);
  }
  if (kind === "gccBuildRun") {
    return timeoutMsFromSeconds(settings.gccBuildRunTimeoutSeconds);
  }
  return timeoutMsFromSeconds(settings.defaultTimeoutSeconds);
}

export function gccDiagnosticsProcessTimeoutMs(settings: TimeoutSettings): number {
  const processCeilingSeconds =
    settings.gccDiagnosticsTimeoutSeconds + GCC_DIAGNOSTICS_PROCESS_MARGIN_SECONDS;
  return timeoutMsFromSeconds(processCeilingSeconds);
}

export function gccCompileProcessTimeoutMs(settings: TimeoutSettings): number {
  const processCeilingSeconds =
    settings.gccCompileTimeoutSeconds + GCC_DIAGNOSTICS_PROCESS_MARGIN_SECONDS;
  return timeoutMsFromSeconds(processCeilingSeconds);
}

export function gccBuildRunProcessTimeoutMs(settings: TimeoutSettings): number {
  const processCeilingSeconds =
    settings.gccBuildRunTimeoutSeconds + GCC_DIAGNOSTICS_PROCESS_MARGIN_SECONDS;
  return timeoutMsFromSeconds(processCeilingSeconds);
}

export function inspectToolchainsProcessTimeoutMs(settings: TimeoutSettings): number {
  const processCeilingSeconds =
    settings.inspectToolchainsTimeoutSeconds + GCC_DIAGNOSTICS_PROCESS_MARGIN_SECONDS;
  return timeoutMsFromSeconds(processCeilingSeconds);
}
