import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readText(relativePath: string): Promise<string> {
  return fs.readFile(path.resolve(__dirname, "..", relativePath), "utf8");
}

test("inspect command reports actionable missing-host executable guidance", async () => {
  const source = await readText("../src/extension.ts");
  assert.match(source, /const MISSING_HOST_BRIDGE_ERROR_PREFIX = "OS4 Test Bridge host CLI is not configured or was not found\.";/);
  assert.match(source, /Set os4TestBridge\.executablePath to a valid os4tb executable/);
  assert.match(source, /isMissingHostBridgeExecutable\(result\)/);
});

test("host bridge path authority remains the executablePath setting", async () => {
  const source = await readText("../src/extension.ts");
  assert.match(source, /config\.get<string>\("executablePath", "os4tb"\)\.trim\(\)/);
  assert.doesNotMatch(source, /\/home\/ford\/dev\/OS4TestBridge/);
  assert.doesNotMatch(source, /host\/os4tb/);
});
