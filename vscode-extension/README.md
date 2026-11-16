# OS4 Test Bridge VS Code Extension

This extension is a thin adapter over the standalone OS4 Test Bridge CLI.

It does not reimplement bridge behavior. Bridge semantics remain in backend tools.

## Release status

- Phase 7J clean-install acceptance matrix (A-J): PASS.
- Technically ready for local/public distribution within current v1 scope.
- Marketplace publishing/administrative rollout is tracked separately.

## Packaging prerequisites (Phase 7J Slice 1 audit)

Before creating a VSIX:

- Use a currently supported Node.js LTS compatible with the current `@vscode/vsce` release.
- Build first: `npm run compile`.
- Package from `vscode-extension/`:
  - `npx @vscode/vsce package --no-yarn`

Notes:

- This repository includes `.vscodeignore` to keep VSIX contents bounded to runtime extension assets.
- In the audited Node 18 environment, `npx @vscode/vsce` and a legacy `vsce` attempt both failed due runtime/toolchain incompatibilities; this is an environment/tooling issue, not an extension behavior issue.
- See release gates: `docs/RELEASE_CHECKLIST.md`.

## Version component roles

Current component versions:

- Extension version: `0.0.1`
- Host tool version: `0.1.0`
- Protocol version: `1`
- Discovery schema version: `1`

Role model:

- Extension version tracks VS Code extension release state.
- Host tool version tracks host implementation release state.
- Protocol version tracks wire/request-response contract compatibility.
- Discovery schema version tracks discovery artifact schema compatibility.

These identifiers do not need to be numerically identical.

## Phase 6A real validation closure

Recorded real Extension Development Host results:

- Show Version: PASS
- Check Target: PASS
- `phase6a_001`: real extension-triggered PASS
- `phase6a_002`: real extension-triggered PASS
- No manual guest action required
- Backend unchanged

Phase 6A closure tokens:

- `OS4TB_PHASE6A_DESIGN=PASS`
- `OS4TB_PHASE6A_EXTENSION_BUILD=PASS`
- `OS4TB_PHASE6A_VERSION_COMMAND=PASS`
- `OS4TB_PHASE6A_CHECK_COMMAND=PASS`
- `OS4TB_PHASE6A_RUN_COMMAND=PASS`
- `OS4TB_PHASE6A_OUTPUT_PARSER=PASS`
- `OS4TB_PHASE6A_SECURITY_TESTS=PASS`
- `OS4TB_PHASE6A_HOST_TESTS=PASS`
- `OS4TB_PHASE6A_REAL_REQUEST_001=PASS`
- `OS4TB_PHASE6A_REAL_REQUEST_002=PASS`
- `OS4TB_PHASE6A_TOTAL=PASS`

## Commands

- `OS4 Test Bridge: Show Version`
- `OS4 Test Bridge: Check Target`
- `OS4 Test Bridge: Run Request File`
- `OS4 Test Bridge: Run on AmigaOS 4`
- `OS4 Test Bridge: Validate on AmigaOS 4`
- `OS4 Test Bridge: Test GCC Diagnostics`
- `OS4 Test Bridge: Compile Current File on AmigaOS 4`
- `OS4 Test Bridge: Build and Run Current File on AmigaOS 4`
- `OS4 Test Bridge: Build and Run Multi-File Test Project on AmigaOS 4`
- `OS4 Test Bridge: Build and Run Project on AmigaOS 4`
- `OS4 Test Bridge: Select Target Configuration`
- `OS4 Test Bridge: Initialize Project`
- `OS4 Test Bridge: Inspect AmigaOS 4 SDK / Toolchains`
- `OS4 Test Bridge: Select Project Toolchain`
- `OS4 Test Bridge: Select Project Assembler`

## Required settings

- `os4TestBridge.executablePath`
- `os4TestBridge.configPath`
- `os4TestBridge.defaultTimeoutSeconds`
- `os4TestBridge.runPayloadName` (for Run on AmigaOS 4)
- `os4TestBridge.validationPayloadName` (for Validate on AmigaOS 4)
- `os4TestBridge.gccDiagnosticsPayloadName` (for Test GCC Diagnostics)
- `os4TestBridge.gccCompilePayloadName` (for Compile Current File on AmigaOS 4)
- `os4TestBridge.gccBuildRunPayloadName` (for Build and Run Current File on AmigaOS 4)
- `os4TestBridge.gccProjectBuildRunPayloadName` (for Build and Run Multi-File Test Project on AmigaOS 4 and Build and Run Project on AmigaOS 4)
- `os4TestBridge.vbccProjectBuildRunPayloadName` (for VBCC-family Build and Run Project on AmigaOS 4)
- `os4TestBridge.assemblerProjectBuildRunPayloadName` (for typed assembler project build/run workflows)
- `os4TestBridge.inspectToolchainsPayloadName` (for Inspect AmigaOS 4 SDK / Toolchains)

Optional:

- `os4TestBridge.generatedRequestDirectory` (if unset, extension storage is used)
- `os4TestBridge.inspectToolchainsTimeoutSeconds` (default 180)
- `os4TestBridge.gccDiagnosticsTimeoutSeconds` (default 120)
- `os4TestBridge.gccCompileTimeoutSeconds` (default 120)
- `os4TestBridge.gccBuildRunTimeoutSeconds` (default 180)

## First-use sequence

1. Install/configure host and OS4 bridge (`docs/GETTING_STARTED.md`).
2. Run `OS4 Test Bridge: Select Target Configuration`.
3. Run `OS4 Test Bridge: Initialize Project`.
4. Run `OS4 Test Bridge: Inspect AmigaOS 4 SDK / Toolchains`.
5. Optionally run `OS4 Test Bridge: Select Project Toolchain` or `OS4 Test Bridge: Select Project Assembler`.
6. Run `OS4 Test Bridge: Build and Run Project on AmigaOS 4`.
7. Review Problems output in the shared `os4TestBridge.gcc` diagnostics collection.

Timeout model:

- `os4TestBridge.defaultTimeoutSeconds` applies to generic bridge commands.
- `os4TestBridge.inspectToolchainsTimeoutSeconds` applies only to Inspect Toolchains and is intentionally larger/bounded for SDK discovery.

## Status bar quick indicators

- `OS4TB: <config-basename>`: active target configuration file is set and present.
- `OS4TB: No target config`: `os4TestBridge.configPath` is unset.
- `OS4TB: Config unavailable`: configured path is missing/unavailable.
- `OS4TB Toolchain: ...` and `OS4TB Assembler: ...`: current project selection/discovery state.

## Phase 6B command semantics

### Run on AmigaOS 4

Executes a bounded generated request using the configured `runPayloadName`.

### Validate on AmigaOS 4

Executes a bounded generated request using the configured `validationPayloadName`.

Validation is a distinct user-facing action, even though both actions currently invoke the same stable backend run contract.

### Test GCC Diagnostics

Executes a bounded GCC diagnostic probe payload and parses returned GCC diagnostic lines into deterministic summary tokens:

- `OS4TB_GCC_DIAGNOSTIC_COUNT`
- `OS4TB_GCC_ERROR_COUNT`
- `OS4TB_GCC_WARNING_COUNT`
- `OS4TB_GCC_NOTE_COUNT`
- `OS4TB_GCC_VERSION`
- `OS4TB_GCC_DIAGNOSTICS`

### Compile Current File on AmigaOS 4

Compiles the active saved `.c` file with a bounded GCC compile adapter, publishes returned diagnostics in the shared native Problems collection (`os4TestBridge.gcc`), and reports object/compile outcome telemetry.

### Build and Run Current File on AmigaOS 4

Builds and links the active saved `.c` file with a bounded GCC build/run adapter, publishes compile/link diagnostics in the shared native Problems collection (`os4TestBridge.gcc`), and reports both build and program exit outcomes.

Phase 7D uses a fixed direct-runtime-archive linker strategy (`OS4TB_GCC_LINK_STRATEGY=direct_runtime_archives`) with request-scoped object/executable naming and deterministic runtime-archive validation before `ld` runs.

### Build and Run Multi-File Test Project on AmigaOS 4

Builds a bounded two-file project shape (`main.c` + `helper.c`) by staging both files per-request, compiling both translation units independently, linking with the Phase 7D direct-runtime-archive strategy, and publishing native GCC diagnostics mapped back to each host source file.

### Build and Run Project on AmigaOS 4

Builds a bounded project manifest in the active file directory using `.os4tb-project` with explicit `source=<relative/path.c>`, optional `header=<relative/path.h>`, optional `include=<relative/include-dir>`, optional `define=<macro>` or `define=<macro>=<value>`, optional `library=<name>`, optional toolchain selection, and optional declarative build profile entries:

- `toolchain=gcc-<full-version>` (optional; when omitted, uses active discovered GCC)

- `c_standard=c90|c99|c11` (default: `c11`)
- `warning_level=default|extra|strict` (default: `extra`)
- `optimization=none|debug|release` (default: `none`)
- `debug_symbols=yes|no` (default: `no`)

Rules:

- source count must be `2..64` (finite bounded ceiling sized to carry canonical JEd-scale projects without enabling unbounded input)
- header count must be `0..8`
- include directory count must be `0..4`
- define count must be `0..16`
- library count must be `0..16`
- relative project paths only (bounded depth/segment charset, no traversal/absolute paths)
- source entries must be `.c`
- header entries must be `.h`
- include entries must resolve to directories under the same project root
- define names must match `[A-Za-z_][A-Za-z0-9_]*` (max length `64`)
- define values are optional and must match `[A-Za-z0-9_.+-]+` (max length `64`)
- duplicate define names are rejected (case-sensitive)
- library names must match `[A-Za-z0-9_][A-Za-z0-9_+-]*` (max length `64`)
- duplicate library names are rejected (order is preserved)
- reserved bridge-managed libraries are rejected: `c`, `gcc`, `gcc_eh`
- toolchain identifiers must match `gcc-<full-version>` (for example `gcc-11.5.0`)
- sequential compile in manifest order
- stop on first compile failure
- bounded request-scoped project staging preserves declared relative project paths
- bounded include strategy adds the request project directory and declared include directories (`-I<request_project_dir>` plus each `include=` entry)
- bounded define strategy emits only validated `-D` arguments (`-D<define-entry>` for each `define=` entry)
- bounded library strategy emits only validated linker arguments (`-l<name>` for each `library=` entry)
- bounded compile-profile strategy emits only validated compile arguments:
  - `c_standard`: `-std=c90|-std=c99|-std=c11`
  - `warning_level`: `-Wall` / `-Wall -Wextra` / `-Wall -Wextra -Werror`
  - `optimization`: `-O0|-Og|-O2`
  - `debug_symbols=yes`: `-g`
- bounded toolchain selection resolves only discovered GCC profiles and emits selected driver/prefix policy and versioned path provenance in project artifact fields (`TOOLCHAIN_DRIVER`, `TOOLCHAIN_DRIVER_PREFIX_POLICY`, runtime archives, internal include, linker path)
- guest manifest serializes ordered bounded internal GCC include directories as `TOOLCHAIN_INTERNAL_INCLUDE_COUNT` plus `TOOLCHAIN_INTERNAL_INCLUDE_<index>` entries (max `8`, order preserved)
- when `TOOLCHAIN_SDK_ROOT` is provided and `${TOOLCHAIN_SDK_ROOT}/MUI/C/include/libraries/mui.h` exists on target, the adapter appends `-idirafter ${TOOLCHAIN_SDK_ROOT}/MUI/C/include` to preserve `<libraries/mui.h>` portability across SDK layouts
- guest manifest line parsing splits on the first `=` (`KEY=<entire value>`), so typed define entries such as `DEFINE_0=TEST_MACRO=7` are accepted and then validated by bounded define grammar rules
- guest project manifest is staged deterministically at `SAMDROP:incoming/project_<request_id>/project_manifest.txt`
- direct runtime archive link strategy (`OS4TB_GCC_LINK_STRATEGY=direct_runtime_archives`)
- bounded link-object evidence file is emitted (`OS4TB_GCC_PROJECT_LINK_OBJECT_FILE`) with `OBJECT_COUNT` and `OBJECT_<i>`
- no Makefile/CMake/arbitrary flags support in this phase
- compiler diagnostics are parsed by toolchain family (GCC and VBCC) and surfaced in VS Code Problems when deterministic file/line attribution is available
- raw compiler/linker output remains preserved in bridge artifacts for troubleshooting, including cases where VBCC linker diagnostics do not provide a source line

### Select Project Toolchain

Opens a discovery-backed project toolchain selector for the active `.os4tb-project` root. The selector persists only `toolchain=<id>` intent in `.os4tb-project` for explicit selections (`gcc-<full-version>` or `vbcc-os4`), or removes `toolchain=` for automatic mode (active discovered GCC).

Rules:

- options are built from cached discovered toolchain inventory (no hardcoded toolchain list)
- if discovery cache is missing, the command runs `Inspect AmigaOS 4 SDK / Toolchains` first
- unavailable current selections remain visible in the picker as unavailable
- duplicate `toolchain=` lines in `.os4tb-project` are treated as malformed and rejected
- malformed `toolchain=` values are rejected (must match `gcc-<full-version>` or `vbcc-os4`)
- persistence uses atomic replace semantics (`write temp` then `rename`) to avoid partial writes
- persistence is project-scoped through `.os4tb-project` only
- status bar label (`OS4TB Toolchain: ...`) reflects project selection/discovery state and is informational only

Automatic toolchain behavior is represented canonically by the absence of `toolchain=` in `.os4tb-project`.

### Select Project Assembler

Opens a discovery-backed project assembler selector for the active `.os4tb-project` root. The selector persists only `assembler=<id>` intent in `.os4tb-project` for explicit selections (`gnu-as-os4` or `vasm-ppc-std`), or removes `assembler=` for automatic mode.

Rules:

- options are built from cached discovered assembler availability (GNU `as`, VBCC `vasmppc_std`)
- if discovery cache is missing, the command runs `Inspect AmigaOS 4 SDK / Toolchains` first
- unavailable current selections remain visible in the picker as unavailable
- duplicate `assembler=` lines in `.os4tb-project` are treated as malformed and rejected
- malformed `assembler=` values are rejected (must match `gnu-as-os4` or `vasm-ppc-std`)
- persistence uses atomic replace semantics (`write temp` then `rename`) to avoid partial writes
- persistence is project-scoped through `.os4tb-project` only
- status bar label (`OS4TB Assembler: ...`) reflects project selection/discovery state and is informational only

Automatic assembler behavior is represented canonically by the absence of `assembler=` in `.os4tb-project`.

### Select Target Configuration

Prompts for an existing bridge config file and persists the selected path through the existing `os4TestBridge.configPath` setting (no duplicate target registry).

The status bar reflects whether config is set, unset, or unavailable.

### Initialize Project

Creates a new `.os4tb-project` in the selected workspace folder using bounded source selection:

- finds supported source files (`.c`, `.s`) while excluding common non-source directories (`.git`, `node_modules`, `.artifacts`, `build`, `dist`, `out`, `coverage`)
- persists selected sources as relative paths in deterministic order
- preserves portability: no machine-specific compiler/assembler/linker/SDK paths are written
- keeps toolchain/assembler in Automatic mode using canonical absence semantics (no `toolchain=automatic`, no `assembler=automatic`)
- never silently overwrites an existing `.os4tb-project`

Example `.os4tb-project`:

```text
source=main.c
source=src/math.c
source=src/expected.c
header=include/project.h
include=include
define=OS4TB_FEATURE_ENABLED
define=OS4TB_EXPECTED_VALUE=42
library=m
library=auto
toolchain=gcc-11.5.0
c_standard=c11
warning_level=extra
optimization=none
debug_symbols=no
```

### Inspect AmigaOS 4 SDK / Toolchains

Executes a bounded read-only discovery payload that emits a deterministic key/value artifact. The extension validates artifact size/line bounds, parses the schema, writes a JSON cache snapshot, and prints summarized discovery telemetry.

Discovery contract:

- schema key: `OS4TB_DISCOVERY_VERSION=1`
- artifact byte limit: `262144`
- line length limit: `512`
- bounded parsed counts:
  - `OS4TB_GCC_COUNT` up to `8`
  - per-GCC include dirs up to `16`
  - per-GCC internal include dirs up to `8`
  - per-GCC library dirs up to `16`
  - per-GCC library inventory entries up to `256`
- include probe semantics are explicit:
  - `OS4TB_GCC_<n>_INCLUDE_PROBE_STREAM=stdout|stderr|none`
  - `OS4TB_GCC_<n>_INCLUDE_DISCOVERY_STATUS=found|empty|probe_failed`
- active frontend and installed-version discovery are distinct:
  - `OS4TB_GCC_ACTIVE_FRONTEND`
  - `OS4TB_GCC_ACTIVE_VERSION`
- optional tool status is separated from version extraction:
  - `OS4TB_AS_STATUS` / `OS4TB_AS_VERSION`
  - `OS4TB_LD_STATUS` / `OS4TB_LD_VERSION`
  - `OS4TB_VBCC_STATUS` / `OS4TB_VBCC_VERSION`
- includes runtime status fields for `libgcc`, `libgcc_eh`, `crtbegin`, and `crtend`
- records status values as `present|missing|symlink|broken_symlink|unknown` where applicable

Failure behavior is explicit and deterministic; malformed or oversized discovery artifacts fail with a surfaced `reason=` token and no fallback parsing.

## Current limitations

- No source-level debugger integration.
- No breakpoints/stepping/variable inspection.
- No artifact browser/navigation yet.
- No continuous monitoring/polling.

## Future optional developer-tool adapters (not current features)

- Compiler adapters.
- Validator adapters.
- Debugger adapters.
- Diagnostics adapters.
