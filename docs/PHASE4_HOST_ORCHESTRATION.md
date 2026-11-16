# Phase 4 Host Orchestration

## Purpose

Provide one host command that performs the complete bounded lifecycle:

request -> validate -> submit -> wait -> validate result/artifact -> deterministic PASS/FAIL

without requiring separate manual `os4tb_submit.sh` and `os4tb_validate` steps.

## Command

- `host/os4tb_run.sh <request-file>`
- optional: `--timeout <seconds>`

## Lifecycle

1. Validate request via existing `os4tb_validate --check-request`.
2. Extract `request_id`, `operation`, `expected_artifact_name`.
3. Compute correlated paths in share.
4. Enforce stale/collision guards before submission.
5. Submit using existing `os4tb_submit.sh`.
6. Poll for `results/result_<request_id>.res` with bounded timeout.
7. Validate with existing `os4tb_validate`.
8. Return deterministic exit code and machine tokens.

## Timeout model

- Default timeout: 30 seconds.
- Override: `--timeout <seconds>`.
- Timeout failure is distinct from execution/validation failure.

## Polling model

- Filesystem polling, fixed interval 1 second.
- No inotify dependency.
- No busy-loop.

## Correlation requirements

- Result filename must match request ID convention.
- Request ID and operation must match in validated result.
- Validator enforces artifact and postconditions.

## Stale-result protection

Before submit, refuse run when any per-request path already exists:

- ready request
- claimed request
- result file
- expected artifact file
- log file
- processed done/rejected markers

This requires fresh request IDs and preserves prior evidence.

## Processed-request interaction

- `os4tb_submit.sh` already rejects processed-marker duplicates.
- `os4tb_run.sh` pre-checks processed markers before submit to fail early with explicit stale/duplicate classification.

## Artifact verification

No duplicate parsing logic in orchestrator.
Artifact existence/non-zero and schema checks remain delegated to `os4tb_validate`.

## Exit code contract

- `0` = full PASS
- `1` = request invalid
- `2` = submit failure or stale/duplicate guard failure
- `3` = timeout waiting for result
- `4` = result validation failure
- `5` = artifact/postcondition failure
- `6` = internal/usage/orchestration parameter error

## Output contract

Machine-readable tokens are authoritative.

Success emits:

- `OS4TB_RUN_REQUEST_ID=<id>`
- `OS4TB_LOG_PATH=<share>/logs/log_<request_id>.txt`
- `OS4TB_ARTIFACT_PATH=<share>/results/<expected_artifact_name>`
- `OS4TB_RUN_SUBMIT=PASS`
- `OS4TB_RUN_RESULT=PASS`
- `OS4TB_RUN_ARTIFACT=PASS`
- `OS4TB_RUN_FINAL=PASS`

Failure emits corresponding `FAIL` tokens and bounded reason:

- `OS4TB_RUN_FAILURE_REASON=<token>`

Failure-precedence semantics:

1. request invalid
2. stale/submit failure
3. timeout
4. result/execution validation failure
5. artifact-only postcondition failure
6. internal/orchestration error

Host regression coverage explicitly includes:

- execution/result failure + downstream artifact failure -> exit `4` / `result_validation_failed`
- artifact-only postcondition failure (execution semantics otherwise PASS) -> exit `5` / `artifact_postcondition_failed`

## Cleanup policy

- No automatic deletion of prior evidence.
- No automatic result/artifact cleanup.
- Fresh request IDs are required for orchestration runs.

## Out of scope

- Guest-agent behavior changes
- WBStartup/startup-script changes
- SAMDROP mount/network changes
- Protocol v1 schema changes
- sockets/HTTP/SSH/remote shell

## Future integration contract

`os4tb_run.sh` is intended as the stable external entrypoint that later integrations can call:

- Codex extension wrappers
- Jeeves integration wrappers
- CI-style OS4 test jobs
- other Amiga developer workflows

without changing guest protocol/runtime behavior.

## Real guest status (final)

Positive real orchestration:

- `phase4_001` PASS
- `phase4_002` PASS

Initial negative real orchestration (`phase4_neg_001`) rejected correctly (no false PASS), but exposed host failure-reason precedence defect.

Host-only precedence repair applied.

Negative retest (`phase4_neg_002`) confirmed:

- top-level `OS4TB_RUN_FAILURE_REASON=result_validation_failed`
- shell exit status `4`

Final authoritative Phase 4 tokens:

- `OS4TB_PHASE4_DESIGN=PASS`
- `OS4TB_PHASE4_ORCHESTRATOR_BUILD=PASS`
- `OS4TB_PHASE4_HOST_TESTS=PASS`
- `OS4TB_PHASE4_TIMEOUT=PASS`
- `OS4TB_PHASE4_STALE_GUARD=PASS`
- `OS4TB_PHASE4_REAL_REQUEST_001=PASS`
- `OS4TB_PHASE4_REAL_REQUEST_002=PASS`
- `OS4TB_PHASE4_REAL_NEGATIVE=PASS`
- `OS4TB_PHASE4_TOTAL=PASS`
