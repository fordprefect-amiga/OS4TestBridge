# Phase 7A GCC Diagnostics Adapter

## Purpose

Phase 7A proves an end-to-end bounded adapter path for real AmigaOS-side GCC diagnostics:

1. bounded Protocol v1 `RUN_BINARY` request,
2. bounded guest probe execution on Sam460EX,
3. captured compiler output returned through existing result/log/artifact flow,
4. deterministic host-side diagnostic parsing to structured tokens.

The guest compiler is authoritative. No Linux-side GCC output is treated as source of truth.

## Non-goals

- no general project build system
- no arbitrary remote command execution
- no Debug command
- no Db101 integration
- no protocol redesign

## Security boundary

- Request grammar remains Protocol v1.
- `payload_name` and `expected_artifact_name` remain basename-only validated.
- No `command=`, `shell=`, `script=` request fields are accepted.
- The Phase 7A payload executes only fixed GCC probe commands with fixed arguments.
- No user-provided command text is passed through a shell.

## GCC 11.5 authority and version evidence

The probe queries the configured guest compiler with:

- `gcc -dumpfullversion -dumpversion`

It writes a conservative captured value to:

- `OS4TB_GCC_VERSION=<value>`

Host extraction requires `11.5` prefix match and does not hardcode patch-level format.

## Diagnostic data model

Extension model (Phase 7A):

```ts
interface GCCDiagnostic {
  file: string;
  line: number;
  column?: number;
  severity: "error" | "warning" | "note";
  message: string;
}
```

Implemented in [gccDiagnostics.ts](/home/ford/dev/OS4TestBridge/vscode-extension/src/gccDiagnostics.ts).

## Fixture strategy

Repository fixtures (deterministic probe inputs):

- [error_missing_semicolon.c](/home/ford/dev/OS4TestBridge/guest/fixtures/gcc_diagnostics/error_missing_semicolon.c)
- [warning_unused_variable.c](/home/ford/dev/OS4TestBridge/guest/fixtures/gcc_diagnostics/warning_unused_variable.c)

The probe writes equivalent sources into `T:` on guest and compiles only those fixed fixtures.

## Guest probe behavior

Probe source: [os4tb_gcc_diagnostics_probe.c](/home/ford/dev/OS4TestBridge/guest/os4tb_gcc_diagnostics_probe.c)

Workflow:

1. read deterministic fixtures from fixed incoming paths:
   - `SAMDROP:incoming/error_missing_semicolon.c`
   - `SAMDROP:incoming/warning_unused_variable.c`
2. query GCC version (`-dumpfullversion -dumpversion`)
3. compile known error fixture with `-Wall -Wextra -c`
4. compile known warning fixture with `-Wall -Wextra -c`
5. write bounded artifact summary tokens
6. emit raw probe log to stdout for guest-runner log capture

## Result/log/artifact convention

No Protocol v1 grammar change.

Host run flow now emits:

- `OS4TB_LOG_PATH=<.../logs/log_<request_id>.txt>`
- `OS4TB_ARTIFACT_PATH=<.../results/<artifact>>`

Guest runner writes:

- `result_<request_id>.res` (schema result)
- `log_name=log_<request_id>.txt` execution-summary metadata only

GCC compiler diagnostics are emitted by the probe into a separate deterministic file in `results/` and advertised via artifact token:

- `OS4TB_GCC_DIAGNOSTIC_FILE=<basename>`
- `OS4TB_GCC_ERROR_FIXTURE=present|missing`
- `OS4TB_GCC_WARNING_FIXTURE=present|missing`

Capture implementation detail:

- the probe uses OS4 `SystemTags` with fixed command strings and fixed output/error handles (no shell redirection operators) so stderr diagnostics are captured deterministically.
- the probe emits telemetry from `gcc -print-prog-name=cc1` and `gcc -print-search-dirs` into the dedicated diagnostic file.
- for Sam460EX Phase 7A proof, execution uses fixed verified helper path:
  - `Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/cc1`
  - `Work:SDK/gcc/ppc-amigaos/bin/as`
  - `-BWork:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/`
  - `-BWork:SDK/gcc/ppc-amigaos/bin/`
- artifact token `OS4TB_GCC_CC1_DISCOVERY_METHOD=configured_sdk_path` indicates this bounded target-specific path mode.

## Host diagnostic extraction

Extension command:

- `OS4 Test Bridge: Test GCC Diagnostics`

Implementation:

- [extension.ts](/home/ford/dev/OS4TestBridge/vscode-extension/src/extension.ts)
- [gccDiagnostics.ts](/home/ford/dev/OS4TestBridge/vscode-extension/src/gccDiagnostics.ts)

The command:

1. runs bounded request through existing `os4tb run`
2. reads returned artifact (`OS4TB_ARTIFACT_PATH`)
3. resolves `OS4TB_GCC_DIAGNOSTIC_FILE` as basename-safe file in `results/`
4. reads compiler-output file with bounded ENOENT-only retry
5. parses diagnostics
6. emits deterministic summary tokens:
   - `OS4TB_GCC_DIAGNOSTIC_COUNT`
   - `OS4TB_GCC_ERROR_COUNT`
   - `OS4TB_GCC_WARNING_COUNT`
   - `OS4TB_GCC_NOTE_COUNT`
   - `OS4TB_GCC_VERSION`
   - `OS4TB_GCC_DIAGNOSTICS=PASS|FAIL`

### Timeout policy

- global timeout (`os4TestBridge.defaultTimeoutSeconds`, default `45`) remains tuned for short bridge operations.
- GCC diagnostics command uses a dedicated timeout (`os4TestBridge.gccDiagnosticsTimeoutSeconds`, default `120`) propagated as CLI run timeout (`os4tb --config <cfg> run --timeout <seconds> <request>`), which drives backend result wait in `os4tb_run.sh`.
- GCC diagnostics also uses a separate extension child-process safety timeout with a bounded margin above backend timeout (current policy: backend timeout + 10 seconds).
- this split is based on real Sam460EX/QEMU evidence where GCC diagnostics probes completed successfully after earlier host-side timeout failures.
- timeout protection remains bounded and deterministic; timeout outcomes remain failures (`OS4TB_RUN_FAILURE_REASON=timeout_waiting_for_result`) and are not converted to PASS.

Future timeout architecture (not implemented in Phase 7A repair):

- per-operation timeout policies beyond GCC diagnostics;
- longer compile/link/test execution windows for heavier payloads;
- heartbeat/activity-based timeout semantics instead of a single fixed deadline.

Expected probe artifact evidence:

- `OS4TB_GCC_VERSION=11.5.x`
- `OS4TB_GCC_CC1_DISCOVERY=found`
- `OS4TB_GCC_CC1_PATH=<resolved path>`
- `OS4TB_GCC_AS_DISCOVERY=found`
- `OS4TB_GCC_AS_PATH=<resolved path>`
- `OS4TB_GCC_TOOLCHAIN_ENV=ready`
- `OS4TB_GCC_CHILD_ENV=ready`
- `OS4TB_GCC_VERSION_QUERY_EXIT=0`
- `OS4TB_GCC_ERROR_COMPILE_EXIT=<nonzero>`
- `OS4TB_GCC_WARNING_COMPILE_EXIT=0`
- `OS4TB_GCC_PROBE_FINAL=PASS`

Raw multiline compiler output remains in the dedicated compiler-output file.

## Native Problems panel integration (Phase 7B)

- The extension publishes parsed GCC diagnostics into a dedicated VS Code `DiagnosticCollection` named `os4TestBridge.gcc`.
- On each GCC diagnostics command start, the collection is cleared first to prevent stale Problems entries.
- Host path mapping is intentionally bounded in Phase 7B:
  - accepted: `SAMDROP:incoming/<safe-relative-path>`
  - mapped to: configured bridge incoming directory from extension config path (`incoming_dir`, or `share_root/incoming` fallback)
  - rejected: traversal, unsupported volume/device forms, and arbitrary absolute host paths.
- 1-based GCC locations are converted to 0-based VS Code ranges:
  - line: `line - 1`
  - column: `column - 1` when present
  - missing column: minimal range `[0,1)` on the target line.
- Severity mapping:
  - `error -> Error`
  - `warning -> Warning`
  - `note -> Information`
- Problems telemetry tokens emitted by command output:
  - `OS4TB_GCC_PROBLEMS_PUBLISHED`
  - `OS4TB_GCC_PROBLEMS_ERRORS`
  - `OS4TB_GCC_PROBLEMS_WARNINGS`
  - `OS4TB_GCC_PROBLEMS_NOTES`
  - `OS4TB_GCC_PROBLEMS_UNMAPPED`
  - `OS4TB_GCC_PROBLEMS_FINAL`
- Current Phase 7B policy: unmapped diagnostics are treated as failure (`OS4TB_GCC_PROBLEMS_FINAL=FAIL`) to avoid partial, stale, or misleading Problems state.

## Real-test procedure (Sam460EX)

1. Build payload:

```bash
bash /home/ford/dev/OS4TestBridge/tests/build_phase7a_os4_bundle.sh
```

2. Copy probe payload to guest incoming location (same pattern used for existing payloads):

```bash
cp /home/ford/dev/OS4TestBridge/build/phase7a_bundle/os4tb_gcc_diagnostics_probe <SHARE_ROOT>/incoming/os4tb_gcc_diagnostics_probe
```

3. In Extension Development Host, configure:
   - `os4TestBridge.configPath`
   - `os4TestBridge.gccDiagnosticsPayloadName=os4tb_gcc_diagnostics_probe`

4. Run:
   - `OS4 Test Bridge: Test GCC Diagnostics`

5. Validate output channel tokens:
   - `OS4TB_GCC_VERSION=11.5.x`
   - `OS4TB_GCC_DIAGNOSTIC_COUNT>=1`
   - `OS4TB_GCC_DIAGNOSTICS=PASS`

## Future Phase 7B seam

Planned mapping (not implemented in Phase 7A):

`GCCDiagnostic -> vscode.Diagnostic -> vscode.DiagnosticCollection -> Problems panel`

Proposed severities:

- error -> `DiagnosticSeverity.Error`
- warning -> `DiagnosticSeverity.Warning`
- note -> `DiagnosticSeverity.Information`
