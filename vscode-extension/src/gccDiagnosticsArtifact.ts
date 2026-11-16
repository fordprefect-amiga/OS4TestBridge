import * as fs from "node:fs/promises";
import * as path from "node:path";

const BASENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isSafeBasename(name: string): boolean {
  if (name.length === 0 || name.length > 128) {
    return false;
  }
  if (!BASENAME_PATTERN.test(name)) {
    return false;
  }
  if (name === "." || name === "..") {
    return false;
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return false;
  }
  return true;
}

export function resolveCompilerDiagnosticsPath(
  artifactPath: string,
  diagnosticFileBasename: string | undefined
): string {
  if (!diagnosticFileBasename) {
    throw new Error("gcc_diagnostic_file_missing");
  }
  if (!isSafeBasename(diagnosticFileBasename)) {
    throw new Error("gcc_diagnostic_file_invalid");
  }
  return path.join(path.dirname(artifactPath), diagnosticFileBasename);
}

export async function readUtf8FileWithEnoentRetry(params: {
  filePath: string;
  maxBytes: number;
  timeoutMs: number;
  pollMs: number;
}): Promise<string> {
  const deadline = Date.now() + params.timeoutMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let stat;
    try {
      stat = await fs.stat(params.filePath);
    } catch (err) {
      const errno = err as NodeJS.ErrnoException;
      if (errno.code === "ENOENT" && Date.now() < deadline) {
        await sleep(params.pollMs);
        continue;
      }
      throw err;
    }

    if (stat.size > params.maxBytes) {
      throw new Error(`file_too_large:${stat.size}`);
    }

    try {
      return await fs.readFile(params.filePath, "utf8");
    } catch (err) {
      const errno = err as NodeJS.ErrnoException;
      if (errno.code === "ENOENT" && Date.now() < deadline) {
        await sleep(params.pollMs);
        continue;
      }
      throw err;
    }
  }
}
