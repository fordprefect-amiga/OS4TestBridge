# Phase 5 Portable Tool Contract

## Goals

1. Portable host configuration model.
2. Stable installation-independent CLI contract.
3. Deterministic line-oriented machine output.
4. Target identity/configuration validation.
5. Backend contract suitable for future editor/tool integrations.

## Config format

- `key=value` text file
- data-only (never sourced/executed)
- bounded size
- known keys only
- duplicate keys rejected
- malformed lines rejected

## Config lookup precedence

1. `--config <path>`
2. `OS4TB_CONFIG` environment variable
3. `~/.config/os4testbridge/config`

No cwd-based implicit runtime config lookup.

## Target model

Single selected target per config file:

- `target_name`
- `share_root`
- `default_timeout_seconds`
- optional directory overrides

Directory defaults derive from `share_root`:

- incoming = `<share_root>/incoming`
- results = `<share_root>/results`
- logs = `<share_root>/logs`
- processed = `<share_root>/processed`

## Stable CLI

- `os4tb version`
- `os4tb check`
- `os4tb run <request-file>`

`os4tb run` preserves established Phase 4 semantics via composition of existing submit/validate helpers.

## Machine-readable output contract

Line-oriented `KEY=value` tokens.

Core contract tokens include:

- `OS4TB_TOOL_VERSION`
- `OS4TB_PROTOCOL_VERSION`
- `OS4TB_TARGET_NAME`
- `OS4TB_CONFIG_PATH`

Run contract preserves existing `OS4TB_RUN_*` tokens and exit-code semantics.

## Error taxonomy

Run exit codes:

- 0 PASS
- 1 request invalid
- 2 stale/submit failure
- 3 timeout
- 4 result/execution validation failure
- 5 artifact-only postcondition failure
- 6 internal/usage/config error

## Installation model

Host CLI resolves helper paths relative to its own script location, not caller cwd.

## Backward compatibility

- Protocol v1 unchanged.
- Guest behavior unchanged.
- Submit and validator semantics unchanged.

## Future VS Code extension relationship

Future extension should rely only on:

- `os4tb` executable path
- config/target selection
- stable command syntax
- stable `KEY=value` output
- stable exit codes

Extension should not depend on SMB internals, processed directory details, or guest startup details.

## Out of scope

- VS Code extension implementation
- Jeeves integration
- guest protocol changes
- guest startup changes
- transport replacement

## Final real validation status

Real Sam460EX portable CLI runs:

- `phase5_001`: PASS
- `phase5_002`: PASS

Observed stable contract:

- `OS4TB_TOOL_VERSION=0.1.0`
- `OS4TB_PROTOCOL_VERSION=1`
- `OS4TB_TARGET_NAME=sam460ex`
- `OS4TB_CONFIG_PATH=<configured path>`
- `OS4TB_RUN_STALE_GUARD=PASS`
- `OS4TB_RUN_SUBMIT=PASS`
- `OS4TB_RUN_RESULT_WAIT=PASS`
- `OS4TB_REQUEST_PARSE=PASS`
- `OS4TB_RESULT_PARSE=PASS`
- `OS4TB_CORRELATION=PASS`
- `OS4TB_EXECUTION=PASS`
- `OS4TB_ARTIFACT=PASS`
- `OS4TB_FINAL=PASS`
- `OS4TB_RUN_RESULT=PASS`
- `OS4TB_RUN_ARTIFACT=PASS`
- `OS4TB_RUN_FINAL=PASS`

Authoritative Phase 5 tokens:

- `OS4TB_PHASE5_DESIGN=PASS`
- `OS4TB_PHASE5_CONFIG_PARSER=PASS`
- `OS4TB_PHASE5_STABLE_CLI=PASS`
- `OS4TB_PHASE5_CHECK_COMMAND=PASS`
- `OS4TB_PHASE5_VERSION_CONTRACT=PASS`
- `OS4TB_PHASE5_HOST_TESTS=PASS`
- `OS4TB_PHASE5_CWD_INDEPENDENCE=PASS`
- `OS4TB_PHASE5_REAL_REQUEST_001=PASS`
- `OS4TB_PHASE5_REAL_REQUEST_002=PASS`
- `OS4TB_PHASE5_TOTAL=PASS`

Phase 5 closure notes:

- Stable portable config and stable target identity validated.
- Runtime hardcoded `/home/ford` paths are removed from host tooling runtime behavior.
- Real portable CLI validation against Sam target is complete.
