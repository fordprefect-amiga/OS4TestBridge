import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { SELECT_PROJECT_TOOLCHAIN_COMMAND_ID } from "../src/toolchainSelection";

async function readText(relativePath: string): Promise<string> {
  return fs.readFile(path.resolve(__dirname, "..", relativePath), "utf8");
}

test("selector command is contributed and activated", async () => {
  const packageText = await readText("../package.json");
  assert.match(packageText, /onCommand:os4TestBridge\.selectProjectToolchain/);
  assert.match(packageText, /"command": "os4TestBridge\.selectProjectToolchain"/);
});

test("selector command is registered exactly once in extension activation", async () => {
  const extensionSource = await readText("../src/extension.ts");
  const token = `registerCommand(SELECT_PROJECT_TOOLCHAIN_COMMAND_ID`;
  const count = extensionSource.split(token).length - 1;
  assert.equal(count, 1, `Expected one registration for ${SELECT_PROJECT_TOOLCHAIN_COMMAND_ID}`);
});

test("project build path still resolves toolchain through resolver", async () => {
  const extensionSource = await readText("../src/extension.ts");
  assert.match(extensionSource, /resolveProjectToolchain\(/);
  assert.match(extensionSource, /toolchainId:\s*parsedManifest\.manifest\.toolchainId/);
});

test("project build path rejects unresolved toolchain before request creation", async () => {
  const extensionSource = await readText("../src/extension.ts");
  const resolveIndex = extensionSource.indexOf("const resolvedToolchain = resolveProjectToolchain(");
  const unresolvedGuardIndex = extensionSource.indexOf("if (!resolvedToolchain.ok) {", resolveIndex);
  const requestCreateIndex = extensionSource.indexOf("generatedRequest = await createGeneratedRequest({", resolveIndex);
  assert.ok(resolveIndex >= 0, "resolveProjectToolchain call not found");
  assert.ok(unresolvedGuardIndex > resolveIndex, "resolvedToolchain guard not found after resolve");
  assert.ok(requestCreateIndex > unresolvedGuardIndex, "request creation appears before resolver guard");
  const guardSlice = extensionSource.slice(unresolvedGuardIndex, requestCreateIndex);
  assert.match(guardSlice, /reason=\$\{resolvedToolchain\.reason\}/);
  assert.match(guardSlice, /return;/);
});

test("project build path rejects unresolved assembler before request creation", async () => {
  const extensionSource = await readText("../src/extension.ts");
  const resolveIndex = extensionSource.indexOf("const resolvedAssembler = resolveProjectAssembler(");
  const unresolvedGuardIndex = extensionSource.indexOf("if (!resolvedAssembler.ok) {", resolveIndex);
  const requestCreateIndex = extensionSource.indexOf("generatedRequest = await createGeneratedRequest({", resolveIndex);
  assert.ok(resolveIndex >= 0, "resolveProjectAssembler call not found");
  assert.ok(unresolvedGuardIndex > resolveIndex, "resolvedAssembler guard not found after resolve");
  assert.ok(requestCreateIndex > unresolvedGuardIndex, "request creation appears before resolver guard");
  const guardSlice = extensionSource.slice(unresolvedGuardIndex, requestCreateIndex);
  assert.match(guardSlice, /reason=\$\{resolvedAssembler\.reason\}/);
  assert.match(guardSlice, /return;/);
});
