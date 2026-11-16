import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { isSafeBasename, readUtf8FileWithEnoentRetry, resolveCompilerDiagnosticsPath } from "../src/gccDiagnosticsArtifact";

test("read helper returns immediately when file exists", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-gcc-artifact-"));
  const filePath = path.join(dir, "gccdiag.txt");
  await fs.writeFile(filePath, "hello\n", "utf8");
  const text = await readUtf8FileWithEnoentRetry({
    filePath,
    maxBytes: 4096,
    timeoutMs: 500,
    pollMs: 25
  });
  assert.equal(text, "hello\n");
});

test("read helper waits for ENOENT then succeeds", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-gcc-artifact-delay-"));
  const filePath = path.join(dir, "gccdiag-delayed.txt");
  setTimeout(async () => {
    await fs.writeFile(filePath, "delayed\n", "utf8");
  }, 120);
  const text = await readUtf8FileWithEnoentRetry({
    filePath,
    maxBytes: 4096,
    timeoutMs: 1200,
    pollMs: 50
  });
  assert.equal(text, "delayed\n");
});

test("read helper fails when file never appears", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-gcc-artifact-missing-"));
  const filePath = path.join(dir, "missing.txt");
  await assert.rejects(
    readUtf8FileWithEnoentRetry({
      filePath,
      maxBytes: 4096,
      timeoutMs: 200,
      pollMs: 50
    }),
    /ENOENT/
  );
});

test("read helper fails immediately for non-ENOENT read error", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "os4tb-gcc-artifact-eisdir-"));
  await assert.rejects(
    readUtf8FileWithEnoentRetry({
      filePath: dir,
      maxBytes: 4096,
      timeoutMs: 300,
      pollMs: 50
    }),
    /EISDIR|illegal operation on a directory/i
  );
});

test("invalid diagnostic basename is rejected", () => {
  assert.equal(isSafeBasename("../bad"), false);
  assert.throws(
    () =>
      resolveCompilerDiagnosticsPath(
        "/tmp/gccdiag.artifact",
        "../bad"
      ),
    /gcc_diagnostic_file_invalid/
  );
});
