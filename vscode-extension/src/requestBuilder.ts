import * as fs from "node:fs/promises";
import * as path from "node:path";

export type WorkflowKind =
  | "run"
  | "validate"
  | "gccDiagnostics"
  | "gccCompile"
  | "gccBuildRun"
  | "gccProjectBuildRun"
  | "vbccProjectBuildRun"
  | "assemblerProjectBuildRun"
  | "inspectToolchains";

export interface GeneratedRequest {
  requestId: string;
  operation: "RUN_BINARY";
  payloadName: string;
  artifactName: string;
  requestPath: string;
  requestText: string;
}

let requestCounter = 0;

const BASENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

function formatUtcStamp(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  const ss = d.getUTCSeconds().toString().padStart(2, "0");
  const ms = d.getUTCMilliseconds().toString().padStart(3, "0");
  return `${y}${m}${day}T${hh}${mm}${ss}${ms}Z`;
}

export function validatePayloadBasename(payloadName: string): void {
  if (payloadName.length === 0) {
    throw new Error("payload_name_missing");
  }
  if (payloadName.length > 128) {
    throw new Error("payload_name_too_long");
  }
  if (!BASENAME_PATTERN.test(payloadName)) {
    throw new Error("payload_name_invalid");
  }
  if (payloadName === "." || payloadName === "..") {
    throw new Error("payload_name_invalid");
  }
  if (payloadName.includes("/") || payloadName.includes("\\")) {
    throw new Error("payload_name_invalid");
  }
}

export function validateRequiredPayloadSetting(kind: WorkflowKind, payloadName: string): void {
  if (payloadName.trim().length === 0) {
    if (kind === "run") {
      throw new Error("run_payload_setting_missing");
    }
    if (kind === "validate") {
      throw new Error("validation_payload_setting_missing");
    }
    if (kind === "gccCompile") {
      throw new Error("gcc_compile_payload_setting_missing");
    }
    if (kind === "gccBuildRun") {
      throw new Error("gcc_build_run_payload_setting_missing");
    }
    if (kind === "gccProjectBuildRun") {
      throw new Error("gcc_project_build_run_payload_setting_missing");
    }
    if (kind === "vbccProjectBuildRun") {
      throw new Error("vbcc_project_build_run_payload_setting_missing");
    }
    if (kind === "assemblerProjectBuildRun") {
      throw new Error("assembler_project_build_run_payload_setting_missing");
    }
    if (kind === "inspectToolchains") {
      throw new Error("inspect_toolchains_payload_setting_missing");
    }
    throw new Error("gcc_diagnostics_payload_setting_missing");
  }
}

function nextRequestId(kind: WorkflowKind, now: Date): string {
  requestCounter = (requestCounter + 1) % 10000;
  let prefix = "validate";
  if (kind === "run") {
    prefix = "run";
  } else if (kind === "gccDiagnostics") {
    prefix = "gccdiag";
  } else if (kind === "gccCompile") {
    prefix = "gcccmp";
  } else if (kind === "gccBuildRun") {
    prefix = "gccrun";
  } else if (kind === "gccProjectBuildRun") {
    prefix = "gccproj";
  } else if (kind === "vbccProjectBuildRun") {
    prefix = "vbccproj";
  } else if (kind === "assemblerProjectBuildRun") {
    prefix = "asmproj";
  } else if (kind === "inspectToolchains") {
    prefix = "inspect";
  }
  const stamp = formatUtcStamp(now);
  const counter = requestCounter.toString().padStart(4, "0");
  return `${prefix}_${stamp}_${counter}`;
}

function buildRequestText(requestId: string, payloadName: string, artifactName: string): string {
  return [
    "protocol_version=1",
    `request_id=${requestId}`,
    "operation=RUN_BINARY",
    `payload_name=${payloadName}`,
    `expected_artifact_name=${artifactName}`,
    ""
  ].join("\n");
}

export async function createGeneratedRequest(params: {
  kind: WorkflowKind;
  payloadName: string;
  directory: string;
  now?: Date;
}): Promise<GeneratedRequest> {
  validateRequiredPayloadSetting(params.kind, params.payloadName);
  validatePayloadBasename(params.payloadName);
  await fs.mkdir(params.directory, { recursive: true });

  const now = params.now ?? new Date();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const requestId = nextRequestId(params.kind, now);
    const artifactName = `${requestId}.artifact`;
    const requestFileName = `request_${requestId}.req`;
    const requestPath = path.join(params.directory, requestFileName);
    const requestText = buildRequestText(requestId, params.payloadName, artifactName);

    try {
      await fs.writeFile(requestPath, requestText, { encoding: "utf8", flag: "wx" });
      return {
        requestId,
        operation: "RUN_BINARY",
        payloadName: params.payloadName,
        artifactName,
        requestPath,
        requestText
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
    }
  }

  throw new Error("request_id_generation_exhausted");
}
