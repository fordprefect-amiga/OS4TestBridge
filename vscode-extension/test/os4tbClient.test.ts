import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { Os4tbClient } from "../src/os4tbClient";
import { evaluateRunContract, parseKeyValueOutput } from "../src/parser";

async function makeExecutable(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { encoding: "utf8" });
  await fs.chmod(filePath, 0o755);
}

test("version PASS", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-version-"));
  const exe = path.join(dir, "fake-os4tb.sh");
  await makeExecutable(
    exe,
    "#!/usr/bin/env bash\nset -euo pipefail\necho OS4TB_TOOL_VERSION=0.1.0\necho OS4TB_PROTOCOL_VERSION=1\n"
  );
  const client = new Os4tbClient(exe, 5000);
  const result = await client.version();
  assert.equal(result.exitCode, 0);
  const parsed = parseKeyValueOutput(result.stdout);
  assert.equal(parsed.fields.OS4TB_TOOL_VERSION, "0.1.0");
  assert.equal(parsed.fields.OS4TB_PROTOCOL_VERSION, "1");
});

test("check PASS", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-check-"));
  const exe = path.join(dir, "fake-os4tb.sh");
  await makeExecutable(
    exe,
    "#!/usr/bin/env bash\nset -euo pipefail\necho OS4TB_TARGET_NAME=sam460ex\necho HOST_CONFIGURATION=PASS\necho REAL_GUEST_STATUS=UNKNOWN\n"
  );
  const client = new Os4tbClient(exe, 5000);
  const result = await client.check(path.join(dir, "cfg.conf"));
  assert.equal(result.exitCode, 0);
  const parsed = parseKeyValueOutput(result.stdout);
  assert.equal(parsed.fields.HOST_CONFIGURATION, "PASS");
});

test("run PASS", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-run-pass-"));
  const exe = path.join(dir, "fake-os4tb.sh");
  await makeExecutable(
    exe,
    "#!/usr/bin/env bash\nset -euo pipefail\necho OS4TB_RUN_REQUEST_ID=phase6a_001\necho OS4TB_RUN_FINAL=PASS\n"
  );
  const client = new Os4tbClient(exe, 5000);
  const result = await client.runRequest(path.join(dir, "cfg.conf"), path.join(dir, "request.req"));
  const parsed = parseKeyValueOutput(result.stdout);
  const contract = evaluateRunContract(result.exitCode, parsed);
  assert.equal(contract.ok, true);
});

test("stderr capture", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-stderr-"));
  const exe = path.join(dir, "fake-os4tb.sh");
  await makeExecutable(
    exe,
    "#!/usr/bin/env bash\nset -euo pipefail\necho warning_text >&2\necho OS4TB_TOOL_VERSION=0.1.0\necho OS4TB_PROTOCOL_VERSION=1\n"
  );
  const client = new Os4tbClient(exe, 5000);
  const result = await client.version();
  assert.match(result.stderr, /warning_text/);
});

test("timeout behavior", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-timeout-"));
  const exe = path.join(dir, "fake-os4tb.sh");
  await makeExecutable(
    exe,
    "#!/usr/bin/env bash\nset -euo pipefail\nsleep 5\necho OS4TB_RUN_FINAL=PASS\n"
  );
  const client = new Os4tbClient(exe, 100);
  const result = await client.version();
  assert.equal(result.timedOut, true);
});

test("executable path containing spaces", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-exe-space-"));
  const exe = path.join(dir, "fake os4tb.sh");
  await makeExecutable(
    exe,
    "#!/usr/bin/env bash\nset -euo pipefail\necho OS4TB_TOOL_VERSION=0.1.0\necho OS4TB_PROTOCOL_VERSION=1\n"
  );
  const client = new Os4tbClient(exe, 5000);
  const result = await client.version();
  assert.equal(result.exitCode, 0);
});

test("config path containing spaces", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-config-space-"));
  const exe = path.join(dir, "fake-os4tb.sh");
  const cfg = path.join(dir, "config with spaces.conf");
  await makeExecutable(
    exe,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "--config" && "$2" == "${cfg}" && "$3" == "check" ]]; then
  echo HOST_CONFIGURATION=PASS
  exit 0
fi
echo HOST_CONFIGURATION=FAIL
exit 1
`
  );
  const client = new Os4tbClient(exe, 5000);
  const result = await client.check(cfg);
  assert.equal(result.exitCode, 0);
});

test("request path containing spaces", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-request-space-"));
  const exe = path.join(dir, "fake-os4tb.sh");
  const cfg = path.join(dir, "cfg.conf");
  const req = path.join(dir, "request with spaces.req");
  await makeExecutable(
    exe,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "--config" && "$2" == "${cfg}" && "$3" == "run" && "$4" == "${req}" ]]; then
  echo OS4TB_RUN_FINAL=PASS
  exit 0
fi
echo OS4TB_RUN_FINAL=FAIL
exit 1
`
  );
  const client = new Os4tbClient(exe, 5000);
  const result = await client.runRequest(cfg, req);
  assert.equal(result.exitCode, 0);
});

test("run request with orchestrator timeout passes timeout argument to CLI", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-run-timeout-"));
  const exe = path.join(dir, "fake-os4tb.sh");
  const cfg = path.join(dir, "cfg.conf");
  const req = path.join(dir, "request.req");
  await makeExecutable(
    exe,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "--config" && "$2" == "${cfg}" && "$3" == "run" && "$4" == "--timeout" && "$5" == "120" && "$6" == "${req}" ]]; then
  echo OS4TB_RUN_FINAL=PASS
  exit 0
fi
echo OS4TB_RUN_FINAL=FAIL
exit 1
`
  );

  const client = new Os4tbClient(exe, 5000);
  const result = await client.runRequest(cfg, req, { orchestratorTimeoutSeconds: 120 });
  assert.equal(result.exitCode, 0);
});

test("run request without orchestrator timeout keeps legacy argument order", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-run-legacy-"));
  const exe = path.join(dir, "fake-os4tb.sh");
  const cfg = path.join(dir, "cfg.conf");
  const req = path.join(dir, "request.req");
  await makeExecutable(
    exe,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "--config" && "$2" == "${cfg}" && "$3" == "run" && "$4" == "${req}" ]]; then
  echo OS4TB_RUN_FINAL=PASS
  exit 0
fi
echo OS4TB_RUN_FINAL=FAIL
exit 1
`
  );

  const client = new Os4tbClient(exe, 5000);
  const result = await client.runRequest(cfg, req);
  assert.equal(result.exitCode, 0);
});

test("missing host executable returns spawn ENOENT without shell interpretation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-missing-exe-"));
  const cfg = path.join(dir, "cfg.conf");
  const req = path.join(dir, "request.req");
  const missingExe = path.join(dir, "does-not-exist-os4tb");
  const client = new Os4tbClient(missingExe, 5000);
  const result = await client.runRequest(cfg, req);
  assert.equal(result.exitCode, -2);
  assert.equal(result.timedOut, false);
  assert.match(result.spawnError ?? "", /ENOENT/);
});

test("executable path is treated as a direct path, not a shell command", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-noshell-"));
  const cfg = path.join(dir, "cfg.conf");
  const req = path.join(dir, "request.req");
  const payload = path.join(dir, "fake-os4tb.sh;echo hacked");
  const client = new Os4tbClient(payload, 5000);
  const result = await client.runRequest(cfg, req);
  assert.equal(result.exitCode, -2);
  assert.equal(result.timedOut, false);
  assert.match(result.spawnError ?? "", /ENOENT/);
});
