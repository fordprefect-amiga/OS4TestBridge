import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readText(relativePath: string): Promise<string> {
  return fs.readFile(path.resolve(__dirname, "..", relativePath), "utf8");
}

test("target configuration and project bootstrap commands are contributed and activated", async () => {
  const packageText = await readText("../package.json");
  assert.match(packageText, /onCommand:os4TestBridge\.selectTargetConfiguration/);
  assert.match(packageText, /onCommand:os4TestBridge\.initializeProject/);
  assert.match(packageText, /"command": "os4TestBridge\.selectTargetConfiguration"/);
  assert.match(packageText, /"command": "os4TestBridge\.initializeProject"/);
});

test("target config selection updates existing configPath setting authority", async () => {
  const extensionSource = await readText("../src/extension.ts");
  assert.match(extensionSource, /config\.update\(\s*"configPath"/);
  assert.match(extensionSource, /getConfiguration\("os4TestBridge"\)/);
  assert.match(extensionSource, /return vscode\.ConfigurationTarget\.Global;/);
  assert.match(extensionSource, /config\.update\("configPath", undefined, vscode\.ConfigurationTarget\.Workspace\)/);
  assert.doesNotMatch(extensionSource, /ConfigurationTarget\.WorkspaceFolder/);
  assert.doesNotMatch(extensionSource, /targetRegistry/i);
});

test("bootstrap command preserves existing project files and writes canonical manifest atomically", async () => {
  const extensionSource = await readText("../src/extension.ts");
  assert.match(extensionSource, /PROJECT_MANIFEST_FILENAME\} already exists/);
  assert.match(extensionSource, /writeProjectManifestAtomically\(/);
  assert.match(extensionSource, /buildInitializedProjectManifestText\(/);
  assert.match(extensionSource, /toolchain_persisted=automatic_absence/);
  assert.match(extensionSource, /assembler_persisted=automatic_absence/);
});

test("target config status labels avoid long-path labels and include unavailable state", async () => {
  const source = await readText("../src/projectBootstrap.ts");
  assert.match(source, /label:\s*"OS4TB: No target config"/);
  assert.match(source, /label:\s*"OS4TB: Config unavailable"/);
  assert.match(source, /path\.basename\(configPath\)/);
});
