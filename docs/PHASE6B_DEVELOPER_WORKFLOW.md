# Phase 6B Developer Workflow

## Real guest closure status

Phase 6B is closed with real Extension Development Host execution against Sam460EX:

- Real Run: `OS4TB run PASS (target=sam460ex, request_id=run_20261104T011449289Z_0002, operation=RUN_BINARY).`
- Real Validate: `OS4TB validate PASS (target=sam460ex, request_id=validate_20261104T011548870Z_0003, operation=RUN_BINARY).`

Closure tokens:

- `OS4TB_PHASE6B_REAL_RUN=PASS`
- `OS4TB_PHASE6B_REAL_VALIDATE=PASS`
- `OS4TB_PHASE6B_TOTAL=PASS`

Classification:

`DEVELOPER-WORKFLOW-COMMANDS-IMPLEMENTED / HOST-TESTED / BACKEND-UNCHANGED / REAL-RUN-AND-VALIDATE-VALIDATED / PASS`

## Purpose

Provide explicit developer-facing extension commands while preserving strict delegation to the stable OS4 Test Bridge backend CLI.

The extension remains an adapter layer. It does not reimplement bridge logic.

## Command model

Phase 6B command set:

- `OS4 Test Bridge: Show Version`
- `OS4 Test Bridge: Check Target`
- `OS4 Test Bridge: Run Request File`
- `OS4 Test Bridge: Run on AmigaOS 4`
- `OS4 Test Bridge: Validate on AmigaOS 4`

## Run vs Validate semantics

Run:

- Executes the configured target payload on AmigaOS 4.
- Uses setting `os4TestBridge.runPayloadName`.

Validate:

- Executes the configured validation/test payload and reports whether backend-defined postconditions pass.
- Uses setting `os4TestBridge.validationPayloadName`.

Both commands currently generate bounded Protocol v1 requests and invoke the stable backend run contract. This shared backend invocation is an implementation detail, not a user-visible semantic collapse.

## Request generation boundary

Request generation is handled by extension module:

- `vscode-extension/src/requestBuilder.ts`

Rules:

- operation fixed to `RUN_BINARY`
- payload names are basename-only
- no paths, traversal, or shell metacharacters
- fresh bounded request IDs with deterministic format:
  - `run_<UTCSTAMP>_<counter>`
  - `validate_<UTCSTAMP>_<counter>`
- expected artifact name derived from request ID

Generated request files are written to:

- `os4TestBridge.generatedRequestDirectory` if configured
- otherwise extension global storage under `generated-requests`

Cleanup policy:

- Generated requests are retained by default for diagnostics/evidence.
- No automatic silent deletion before failure details are surfaced.

## Extension/backend boundary

Backend responsibilities (unchanged):

- request submission
- result waiting
- correlation and validation
- artifact postconditions
- final failure taxonomy

Extension responsibilities:

- launch backend command safely
- parse stable `KEY=value` output
- enforce success contract (`exit_code == 0` and `OS4TB_RUN_FINAL=PASS`)
- present concise PASS/FAIL feedback

## Why Debug is deferred

Phase 6B does not include debugger semantics:

- no breakpoints
- no stepping
- no variable inspection
- no stack navigation
- no pause/resume debugger protocol

Therefore no `Debug on AmigaOS 4` command is added at this phase.

## Current limitations

- No diagnostics provider integration.
- No compiler/linker/problem matcher integration.
- No artifact browser UI.
- No continuous background monitoring.

## Future developer tool adapters (concept only)

Potential future adapters:

- GCC/adtools adapter
- Db101 adapter
- crash/GrimReaper adapter
- linker diagnostics adapter
- profiler adapter

These remain future concepts only; Phase 6B is tool-agnostic and backend-contract-first.

## Future agent/tool integration boundary

Future human or agent tooling should invoke only stable extension commands or stable backend CLI contract, without coupling to transport internals or guest startup details.
