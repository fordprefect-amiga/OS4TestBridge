import { spawn } from "node:child_process";

export interface Os4tbProcessResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  spawnError?: string;
}

export class Os4tbClient {
  constructor(
    private readonly executablePath: string,
    private readonly timeoutMs: number
  ) {}

  version(): Promise<Os4tbProcessResult> {
    return this.execute(["version"]);
  }

  check(configPath: string): Promise<Os4tbProcessResult> {
    return this.execute(["--config", configPath, "check"]);
  }

  runRequest(
    configPath: string,
    requestPath: string,
    options?: { orchestratorTimeoutSeconds?: number }
  ): Promise<Os4tbProcessResult> {
    const args = ["--config", configPath, "run"];
    if (options?.orchestratorTimeoutSeconds !== undefined) {
      args.push("--timeout", String(options.orchestratorTimeoutSeconds));
    }
    args.push(requestPath);
    return this.execute(args);
  }

  private execute(args: string[]): Promise<Os4tbProcessResult> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let spawnError: string | undefined;

      const child = spawn(this.executablePath, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, this.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (err) => {
        spawnError = err.message;
      });

      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({
          command: this.executablePath,
          args,
          stdout,
          stderr,
          exitCode: code,
          timedOut,
          spawnError
        });
      });
    });
  }
}
