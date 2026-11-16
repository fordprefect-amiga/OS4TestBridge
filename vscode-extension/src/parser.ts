export interface ParsedCliOutput {
  fields: Record<string, string>;
  duplicates: string[];
  diagnostics: string[];
}

const KEY_PATTERN = /^[A-Z0-9_]+$/;

export function parseKeyValueOutput(output: string): ParsedCliOutput {
  const fields: Record<string, string> = {};
  const duplicates: string[] = [];
  const diagnostics: string[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.length === 0) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      diagnostics.push(line);
      continue;
    }

    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);

    if (!KEY_PATTERN.test(key)) {
      diagnostics.push(line);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      duplicates.push(key);
      continue;
    }

    fields[key] = value;
  }

  return { fields, duplicates, diagnostics };
}

export interface RunContractResult {
  ok: boolean;
  reason:
    | "run_pass"
    | "process_exit_nonzero"
    | "missing_run_final"
    | "run_final_not_pass"
    | "duplicate_authoritative_key";
}

export function evaluateRunContract(exitCode: number | null, parsed: ParsedCliOutput): RunContractResult {
  if (parsed.duplicates.includes("OS4TB_RUN_FINAL")) {
    return { ok: false, reason: "duplicate_authoritative_key" };
  }

  if (exitCode !== 0) {
    return { ok: false, reason: "process_exit_nonzero" };
  }

  const runFinal = parsed.fields.OS4TB_RUN_FINAL;
  if (typeof runFinal !== "string") {
    return { ok: false, reason: "missing_run_final" };
  }

  if (runFinal !== "PASS") {
    return { ok: false, reason: "run_final_not_pass" };
  }

  return { ok: true, reason: "run_pass" };
}
