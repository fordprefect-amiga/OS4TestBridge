import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { Os4tbClient } from "../src/os4tbClient";
import {
  gccBuildRunProcessTimeoutMs,
  gccCompileProcessTimeoutMs,
  gccDiagnosticsProcessTimeoutMs,
  resolveTimeoutSettings,
  timeoutMsForCommand
} from "../src/timeoutConfig";

async function makeExecutable(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { encoding: "utf8" });
  await fs.chmod(filePath, 0o755);
}

test("GCC diagnostics uses dedicated timeout setting", () => {
  const settings = resolveTimeoutSettings(45, 180, 120, 120, 180);
  assert.equal(timeoutMsForCommand("gccDiagnostics", settings), 120000);
  assert.equal(timeoutMsForCommand("run", settings), 45000);
});

test("default GCC diagnostics timeout is 120 seconds", () => {
  const settings = resolveTimeoutSettings(45, undefined, undefined, undefined, undefined);
  assert.equal(settings.gccDiagnosticsTimeoutSeconds, 120);
  assert.equal(timeoutMsForCommand("gccDiagnostics", settings), 120000);
});

test("GCC process timeout uses bounded safety margin above orchestrator timeout", () => {
  const settings = resolveTimeoutSettings(45, 180, 120, 120, 180);
  const backendTimeoutMs = timeoutMsForCommand("gccDiagnostics", settings);
  const processTimeoutMs = gccDiagnosticsProcessTimeoutMs(settings);
  assert.equal(backendTimeoutMs, 120000);
  assert.equal(processTimeoutMs, 130000);
  assert.ok(processTimeoutMs > backendTimeoutMs);
});

test("GCC compile process timeout uses bounded safety margin above orchestrator timeout", () => {
  const settings = resolveTimeoutSettings(45, 180, 120, 120, 180);
  const backendTimeoutMs = timeoutMsForCommand("gccCompile", settings);
  const processTimeoutMs = gccCompileProcessTimeoutMs(settings);
  assert.equal(backendTimeoutMs, 120000);
  assert.equal(processTimeoutMs, 130000);
  assert.ok(processTimeoutMs > backendTimeoutMs);
});

test("GCC build/run process timeout uses bounded safety margin above orchestrator timeout", () => {
  const settings = resolveTimeoutSettings(45, 180, 120, 120, 180);
  const backendTimeoutMs = timeoutMsForCommand("gccBuildRun", settings);
  const processTimeoutMs = gccBuildRunProcessTimeoutMs(settings);
  assert.equal(backendTimeoutMs, 180000);
  assert.equal(processTimeoutMs, 190000);
  assert.ok(processTimeoutMs > backendTimeoutMs);
});

test("changing gccDiagnosticsTimeoutSeconds changes only GCC diagnostics timeout", () => {
  const baseline = resolveTimeoutSettings(45, 180, 120, 120, 180);
  const updated = resolveTimeoutSettings(45, 180, 180, 120, 180);
  assert.equal(timeoutMsForCommand("run", baseline), timeoutMsForCommand("run", updated));
  assert.equal(timeoutMsForCommand("validate", baseline), timeoutMsForCommand("validate", updated));
  assert.notEqual(
    timeoutMsForCommand("gccDiagnostics", baseline),
    timeoutMsForCommand("gccDiagnostics", updated)
  );
  assert.equal(timeoutMsForCommand("gccDiagnostics", updated), 180000);
});

test("Run command timeout behavior continues using default timeout", () => {
  const settings = resolveTimeoutSettings(30, 180, 120, 120, 180);
  assert.equal(timeoutMsForCommand("run", settings), 30000);
});

test("GCC compile uses dedicated timeout setting", () => {
  const settings = resolveTimeoutSettings(45, 180, 120, 180, 180);
  assert.equal(timeoutMsForCommand("gccCompile", settings), 180000);
  assert.equal(timeoutMsForCommand("run", settings), 45000);
});

test("GCC build/run uses dedicated timeout setting", () => {
  const settings = resolveTimeoutSettings(45, 180, 120, 120, 210);
  assert.equal(timeoutMsForCommand("gccBuildRun", settings), 210000);
  assert.equal(timeoutMsForCommand("run", settings), 45000);
});

test("Validate command timeout behavior continues using default timeout", () => {
  const settings = resolveTimeoutSettings(30, 180, 120, 120, 180);
  assert.equal(timeoutMsForCommand("validate", settings), 30000);
});

test("GCC timeout still fails deterministically when exceeded", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-gcc-timeout-"));
  const exe = path.join(dir, "fake-os4tb.sh");
  await makeExecutable(
    exe,
    "#!/usr/bin/env bash\nset -euo pipefail\nsleep 2\necho OS4TB_RUN_FINAL=PASS\n"
  );

  const settings = resolveTimeoutSettings(45, 180, 1, 120, 180);
  const client = new Os4tbClient(exe, timeoutMsForCommand("gccDiagnostics", settings));
  const result = await client.version();
  assert.equal(result.timedOut, true);
});

test("invalid or missing GCC timeout configuration falls back safely", () => {
  const missing = resolveTimeoutSettings(45, undefined, undefined, undefined, undefined);
  const zero = resolveTimeoutSettings(45, 180, 0, 0, 0);
  const negative = resolveTimeoutSettings(45, 180, -1, -1, -1);
  const nanValue = resolveTimeoutSettings(45, 180, Number.NaN, Number.NaN, Number.NaN);
  const stringValue = resolveTimeoutSettings(45, 180, "bad", "bad", "bad");
  assert.equal(missing.gccDiagnosticsTimeoutSeconds, 120);
  assert.equal(zero.gccDiagnosticsTimeoutSeconds, 120);
  assert.equal(negative.gccDiagnosticsTimeoutSeconds, 120);
  assert.equal(nanValue.gccDiagnosticsTimeoutSeconds, 120);
  assert.equal(stringValue.gccDiagnosticsTimeoutSeconds, 120);
  assert.equal(missing.gccCompileTimeoutSeconds, 120);
  assert.equal(zero.gccCompileTimeoutSeconds, 120);
  assert.equal(negative.gccCompileTimeoutSeconds, 120);
  assert.equal(nanValue.gccCompileTimeoutSeconds, 120);
  assert.equal(stringValue.gccCompileTimeoutSeconds, 120);
  assert.equal(missing.gccBuildRunTimeoutSeconds, 180);
  assert.equal(zero.gccBuildRunTimeoutSeconds, 180);
  assert.equal(negative.gccBuildRunTimeoutSeconds, 180);
  assert.equal(nanValue.gccBuildRunTimeoutSeconds, 180);
  assert.equal(stringValue.gccBuildRunTimeoutSeconds, 180);
});

test("inspect toolchains uses dedicated timeout setting", () => {
  const settings = resolveTimeoutSettings(45, 180, 120, 120, 180);
  assert.equal(timeoutMsForCommand("inspectToolchains", settings), 180000);
  assert.equal(timeoutMsForCommand("run", settings), 45000);
});
