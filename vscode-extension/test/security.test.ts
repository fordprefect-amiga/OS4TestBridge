import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { Os4tbClient } from "../src/os4tbClient";

async function makeExecutable(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { encoding: "utf8" });
  await fs.chmod(filePath, 0o755);
}

test("shell metacharacters in args stay literal (no command injection)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-ext-security-"));
  const sentinel = path.join(dir, "must_not_exist.txt");
  const exe = path.join(dir, "fake-os4tb.sh");
  await makeExecutable(
    exe,
    "#!/usr/bin/env bash\nset -euo pipefail\necho HOST_CONFIGURATION=PASS\n"
  );

  const metacharArg = `${path.join(dir, "cfg.conf")}; touch ${sentinel}`;
  const client = new Os4tbClient(exe, 5000);
  const result = await client.check(metacharArg);
  assert.equal(result.exitCode, 0);

  let sentinelExists = true;
  try {
    await fs.stat(sentinel);
  } catch {
    sentinelExists = false;
  }
  assert.equal(sentinelExists, false);
});
