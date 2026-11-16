import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readText(relativePath: string): Promise<string> {
  return fs.readFile(path.resolve(__dirname, "..", relativePath), "utf8");
}

test("check target validates configured configPath before host invocation", async () => {
  const source = await readText("../src/extension.ts");
  assert.match(source, /runCheckCommand[\s\S]*await fs\.stat\(cfg\.configPath\)/);
  assert.match(
    source,
    /runCheckCommand[\s\S]*Configured os4TestBridge\.configPath was not found: \$\{cfg\.configPath\}[\s\S]*client\.check\(cfg\.configPath\)/
  );
});

test("target configuration selection clears workspace override after global write", async () => {
  const source = await readText("../src/extension.ts");
  assert.match(
    source,
    /runSelectTargetConfigurationCommand[\s\S]*config\.update\(\s*"configPath",\s*selectedPath,\s*getConfigPathUpdateTarget\(workspaceFolder\)\s*\)/
  );
  assert.match(
    source,
    /runSelectTargetConfigurationCommand[\s\S]*if \(workspaceFolder\) \{[\s\S]*config\.update\("configPath", undefined, vscode\.ConfigurationTarget\.Workspace\)/
  );
});
