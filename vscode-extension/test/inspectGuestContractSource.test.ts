import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readText(relativePath: string): Promise<string> {
  return fs.readFile(path.resolve(__dirname, "..", relativePath), "utf8");
}

test("inspect toolchains uses explicit orchestrator timeout contract", async () => {
  const source = await readText("../src/extension.ts");
  assert.match(source, /const client = new Os4tbClient\(cfg\.executablePath, cfg\.inspectToolchainsTimeoutMs\);/);
  assert.match(
    source,
    /runInspectToolchainsCommand[\s\S]*client\.runRequest\(cfg\.configPath, generatedRequest\.requestPath, \{\s*orchestratorTimeoutSeconds: cfg\.inspectToolchainsTimeoutSeconds\s*\}\);/
  );
});

test("inspect toolchains timeout setting has bounded default", async () => {
  const packageJson = await readText("../package.json");
  assert.match(packageJson, /"os4TestBridge\.inspectToolchainsTimeoutSeconds": \{/);
  assert.match(packageJson, /"default": 180/);
});

test("run and validate workflow timeout behavior remains unchanged", async () => {
  const source = await readText("../src/extension.ts");
  assert.match(
    source,
    /runGeneratedWorkflowCommand[\s\S]*const result = await client\.runRequest\(cfg\.configPath, generatedRequest\.requestPath\);/
  );
  const inspectTimeoutForwardCount = (source.match(/orchestratorTimeoutSeconds: cfg\.inspectToolchainsTimeoutSeconds/g) ?? [])
    .length;
  assert.equal(inspectTimeoutForwardCount, 1);
});
