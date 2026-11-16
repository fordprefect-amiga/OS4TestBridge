import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createGeneratedRequest,
  validatePayloadBasename,
  validateRequiredPayloadSetting
} from "../src/requestBuilder";
import { buildWorkflowFailMessage, buildWorkflowPassMessage } from "../src/workflowMessages";
import { Os4tbClient } from "../src/os4tbClient";
import { evaluateRunContract, parseKeyValueOutput } from "../src/parser";

async function makeExecutable(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { encoding: "utf8" });
  await fs.chmod(filePath, 0o755);
}

test("valid Run request generation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-run-"));
  const generated = await createGeneratedRequest({
    kind: "run",
    payloadName: "os4tb_phase3a_payload",
    directory: dir
  });

  assert.match(generated.requestId, /^run_[0-9]{8}T[0-9]{9}Z_[0-9]{4}$/);
  assert.equal(generated.operation, "RUN_BINARY");
  assert.equal(generated.payloadName, "os4tb_phase3a_payload");
  assert.match(generated.artifactName, /^run_.*\.artifact$/);
});

test("valid Validate request generation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-validate-"));
  const generated = await createGeneratedRequest({
    kind: "validate",
    payloadName: "os4tb_phase3a_payload",
    directory: dir
  });

  assert.match(generated.requestId, /^validate_[0-9]{8}T[0-9]{9}Z_[0-9]{4}$/);
  assert.equal(generated.operation, "RUN_BINARY");
});

test("valid GCC diagnostics request generation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-gccdiag-"));
  const generated = await createGeneratedRequest({
    kind: "gccDiagnostics",
    payloadName: "os4tb_gcc_diagnostics_probe",
    directory: dir
  });

  assert.match(generated.requestId, /^gccdiag_[0-9]{8}T[0-9]{9}Z_[0-9]{4}$/);
  assert.equal(generated.operation, "RUN_BINARY");
});

test("valid GCC compile request generation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-gcccmp-"));
  const generated = await createGeneratedRequest({
    kind: "gccCompile",
    payloadName: "os4tb_gcc_compile_adapter",
    directory: dir
  });

  assert.match(generated.requestId, /^gcccmp_[0-9]{8}T[0-9]{9}Z_[0-9]{4}$/);
  assert.equal(generated.operation, "RUN_BINARY");
});

test("valid GCC build/run request generation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-gccrun-"));
  const generated = await createGeneratedRequest({
    kind: "gccBuildRun",
    payloadName: "os4tb_gcc_build_run_adapter",
    directory: dir
  });

  assert.match(generated.requestId, /^gccrun_[0-9]{8}T[0-9]{9}Z_[0-9]{4}$/);
  assert.equal(generated.operation, "RUN_BINARY");
});

test("valid GCC project build/run request generation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-gccproj-"));
  const generated = await createGeneratedRequest({
    kind: "gccProjectBuildRun",
    payloadName: "os4tb_gcc_project_build_run_adapter",
    directory: dir
  });

  assert.match(generated.requestId, /^gccproj_[0-9]{8}T[0-9]{9}Z_[0-9]{4}$/);
  assert.equal(generated.operation, "RUN_BINARY");
});

test("valid VBCC project build/run request generation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-vbccproj-"));
  const generated = await createGeneratedRequest({
    kind: "vbccProjectBuildRun",
    payloadName: "os4tb_vbcc_project_build_run_adapter",
    directory: dir
  });

  assert.match(generated.requestId, /^vbccproj_[0-9]{8}T[0-9]{9}Z_[0-9]{4}$/);
  assert.equal(generated.operation, "RUN_BINARY");
});

test("valid assembler project build/run request generation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-asmproj-"));
  const generated = await createGeneratedRequest({
    kind: "assemblerProjectBuildRun",
    payloadName: "os4tb_assembler_project_build_run_adapter",
    directory: dir
  });

  assert.match(generated.requestId, /^asmproj_[0-9]{8}T[0-9]{9}Z_[0-9]{4}$/);
  assert.equal(generated.operation, "RUN_BINARY");
});

test("valid toolchain inspection request generation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-inspect-"));
  const generated = await createGeneratedRequest({
    kind: "inspectToolchains",
    payloadName: "os4tb_toolchain_discovery_probe",
    directory: dir
  });

  assert.match(generated.requestId, /^inspect_[0-9]{8}T[0-9]{9}Z_[0-9]{4}$/);
  assert.equal(generated.operation, "RUN_BINARY");
});

test("inspect request artifact identity remains request-id correlated", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-inspect-correlation-"));
  const generated = await createGeneratedRequest({
    kind: "inspectToolchains",
    payloadName: "os4tb_toolchain_discovery_probe",
    directory: dir
  });
  assert.equal(generated.artifactName, `${generated.requestId}.artifact`);
});

test("unsafe payload basename rejected", () => {
  const badNames = ["../bad", "bad/name", ";bad", "bad&x", "bad|x", "bad$()", "`bad`"];
  for (const candidate of badNames) {
    assert.throws(() => validatePayloadBasename(candidate), /payload_name_invalid/);
  }
});

test("path traversal payload rejected", () => {
  assert.throws(() => validatePayloadBasename("../os4tb_phase3a_payload"), /payload_name_invalid/);
});

test("fresh request IDs differ", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-ids-"));
  const first = await createGeneratedRequest({
    kind: "run",
    payloadName: "os4tb_phase3a_payload",
    directory: dir
  });
  const second = await createGeneratedRequest({
    kind: "run",
    payloadName: "os4tb_phase3a_payload",
    directory: dir
  });
  assert.notEqual(first.requestId, second.requestId);
});

test("generated request format is correct", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-format-"));
  const generated = await createGeneratedRequest({
    kind: "run",
    payloadName: "os4tb_phase3a_payload",
    directory: dir
  });
  const requestBody = await fs.readFile(generated.requestPath, "utf8");
  assert.match(requestBody, /^protocol_version=1/m);
  assert.match(requestBody, /^request_id=/m);
  assert.match(requestBody, /^operation=RUN_BINARY$/m);
  assert.match(requestBody, /^payload_name=os4tb_phase3a_payload$/m);
  assert.match(requestBody, /^expected_artifact_name=.*\.artifact$/m);
});

test("generated-request directory behavior", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-dir-"));
  const generatedDir = path.join(root, "generated");
  const generated = await createGeneratedRequest({
    kind: "validate",
    payloadName: "os4tb_phase3a_payload",
    directory: generatedDir
  });
  assert.match(generated.requestPath, new RegExp(`^${generatedDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("backend still receives request through normal CLI contract", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-req-contract-"));
  const cfg = path.join(dir, "cfg.conf");
  const capture = path.join(dir, "capture.txt");
  const exe = path.join(dir, "fake-os4tb.sh");
  await makeExecutable(
    exe,
    `#!/usr/bin/env bash
set -euo pipefail
echo "ARG1=$1" > "${capture}"
echo "ARG2=$2" >> "${capture}"
echo "ARG3=$3" >> "${capture}"
echo "ARG4=$4" >> "${capture}"
if [[ "$3" != "run" ]]; then
  echo OS4TB_RUN_FINAL=FAIL
  exit 1
fi
if ! grep -q '^operation=RUN_BINARY$' "$4"; then
  echo OS4TB_RUN_FINAL=FAIL
  exit 1
fi
echo OS4TB_TARGET_NAME=sam460ex
echo OS4TB_RUN_REQUEST_ID=test_req
echo OS4TB_RUN_OPERATION=RUN_BINARY
echo OS4TB_RUN_FINAL=PASS
`
  );

  const generated = await createGeneratedRequest({
    kind: "run",
    payloadName: "os4tb_phase3a_payload",
    directory: path.join(dir, "generated")
  });
  const client = new Os4tbClient(exe, 5000);
  const result = await client.runRequest(cfg, generated.requestPath);
  const parsed = parseKeyValueOutput(result.stdout);
  const contract = evaluateRunContract(result.exitCode, parsed);
  assert.equal(contract.ok, true);
});

test("Run PASS presentation", () => {
  const message = buildWorkflowPassMessage({
    kind: "run",
    target: "sam460ex",
    requestId: "run_abc",
    operation: "RUN_BINARY"
  });
  assert.match(message, /run PASS/);
});

test("Run FAIL presentation", () => {
  const message = buildWorkflowFailMessage({
    kind: "run",
    target: "sam460ex",
    requestId: "run_abc",
    reason: "result_validation_failed",
    exitCode: "4"
  });
  assert.match(message, /run FAIL/);
  assert.match(message, /result_validation_failed/);
});

test("Validate PASS presentation", () => {
  const message = buildWorkflowPassMessage({
    kind: "validate",
    target: "sam460ex",
    requestId: "validate_abc",
    operation: "RUN_BINARY"
  });
  assert.match(message, /validate PASS/);
});

test("Validate FAIL presentation", () => {
  const message = buildWorkflowFailMessage({
    kind: "validate",
    target: "sam460ex",
    requestId: "validate_abc",
    reason: "artifact_postcondition_failed",
    exitCode: "5"
  });
  assert.match(message, /validate FAIL/);
  assert.match(message, /artifact_postcondition_failed/);
});

test("missing run payload setting", () => {
  assert.throws(() => validateRequiredPayloadSetting("run", " "), /run_payload_setting_missing/);
});

test("missing validation payload setting", () => {
  assert.throws(
    () => validateRequiredPayloadSetting("validate", " "),
    /validation_payload_setting_missing/
  );
});

test("missing gcc diagnostics payload setting", () => {
  assert.throws(
    () => validateRequiredPayloadSetting("gccDiagnostics", " "),
    /gcc_diagnostics_payload_setting_missing/
  );
});

test("missing gcc compile payload setting", () => {
  assert.throws(
    () => validateRequiredPayloadSetting("gccCompile", " "),
    /gcc_compile_payload_setting_missing/
  );
});

test("missing gcc build/run payload setting", () => {
  assert.throws(
    () => validateRequiredPayloadSetting("gccBuildRun", " "),
    /gcc_build_run_payload_setting_missing/
  );
});

test("missing gcc project build/run payload setting", () => {
  assert.throws(
    () => validateRequiredPayloadSetting("gccProjectBuildRun", " "),
    /gcc_project_build_run_payload_setting_missing/
  );
});

test("missing vbcc project build/run payload setting", () => {
  assert.throws(
    () => validateRequiredPayloadSetting("vbccProjectBuildRun", " "),
    /vbcc_project_build_run_payload_setting_missing/
  );
});

test("missing assembler project build/run payload setting", () => {
  assert.throws(
    () => validateRequiredPayloadSetting("assemblerProjectBuildRun", " "),
    /assembler_project_build_run_payload_setting_missing/
  );
});

test("missing inspect toolchains payload setting", () => {
  assert.throws(
    () => validateRequiredPayloadSetting("inspectToolchains", " "),
    /inspect_toolchains_payload_setting_missing/
  );
});
