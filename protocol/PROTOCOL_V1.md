# OS4 Test Bridge Protocol v1

## Scope

Protocol v1 defines a strict file-based request/result contract for:

- host request creation;
- future bounded guest runner processing;
- host-side result validation.

This version is intentionally small, line-oriented, and deterministic.

## Format

- Encoding: ASCII-compatible text (UTF-8 permitted only for ASCII subset in v1).
- Record format: one `key=value` field per line.
- Accepted newlines: `LF` and `CRLF`.
- Comments: forbidden.
- Empty lines: forbidden.
- Duplicate keys: reject.
- Unknown keys: reject.
- Malformed lines (missing `=` or empty key/value): reject.
- Missing required keys: reject.
- Oversized file/line/value: reject.
- Field order: not required.

## Limits (v1)

- Maximum file size: 4096 bytes.
- Maximum line length (excluding newline): 256 chars.
- Maximum request_id length: 64.
- Maximum operation token length: 32.
- Maximum basename field length (`payload_name`, `artifact_name`, `expected_artifact_name`, `log_name`): 128.
- Maximum `detail` length: 128.

## Request file schema (`request_<request_id>.req`)

Required keys:

- `protocol_version=1`
- `request_id=<id>`
- `operation=<token>`
- `payload_name=<basename>`
- `expected_artifact_name=<basename>`

Forbidden key examples (must be rejected if present):

- `command=...`
- `shell=...`
- `script=...`

## Result file schema (`result_<request_id>.res`)

Required keys:

- `protocol_version=1`
- `request_id=<id>`
- `operation=<token>`
- `transport_status=<token>`
- `execution_status=<token>`
- `exit_code=<int>`
- `artifact_status=<token>`

Optional keys:

- `artifact_name=<basename>`
- `log_name=<basename>`
- `detail=<short_text>`

## Operation vocabulary (v1)

Supported operation:

- `RUN_BINARY`

Semantics:

- execute one transferred payload by validated basename;
- no path traversal;
- no shell expansion;
- no arbitrary command line field.

## Allowed status tokens

`transport_status`:

- `ok`
- `not_applicable`
- `internal_error`

`execution_status`:

- `not_started`
- `success`
- `child_failed`
- `launch_failed`
- `rejected`
- `internal_error`

`artifact_status`:

- `not_required`
- `present`
- `missing`
- `invalid`

## request_id validation

`request_id` must:

- match `^[A-Za-z0-9_-]+$`;
- be 1..64 chars;
- contain no whitespace;
- contain no `/`, `\`, `:`, `..`, shell metacharacters, or control chars.

## Basename validation (`payload_name`, `expected_artifact_name`, `artifact_name`, `log_name`)

All basename fields must:

- be basename-only (no directory separators);
- be non-empty and 1..128 chars;
- not equal `.` or `..`;
- use only `[A-Za-z0-9._-]`.

Therefore forbidden:

- absolute paths;
- traversal components;
- shell metacharacters;
- whitespace.

## Deterministic filenames

- Request: `request_<request_id>.req`
- Result: `result_<request_id>.res`
- Log (if provided): `log_<request_id>.txt`

## Correlation and stale/replay guard (v1, non-cryptographic)

Host validator must reject when any mismatch occurs:

- request filename vs request_id;
- result filename vs request_id;
- result `request_id` vs request `request_id`;
- result `operation` vs request `operation`;
- result `log_name` (if present) vs `log_<request_id>.txt`.

Host-controller behavior for future dispatch:

- treat unmatched result filenames as stale/unrelated;
- avoid reusing old result files as current success evidence;
- optionally remove/rotate prior `result_<id>.res` before dispatch.

## Final PASS criteria

Overall PASS only when all hold:

1. request parse/validation PASS;
2. result parse/validation PASS;
3. correlation PASS;
4. supported operation (`RUN_BINARY`);
5. `transport_status=ok`;
6. `execution_status=success`;
7. `exit_code=0`;
8. `artifact_status=present`;
9. `artifact_name` exists and matches request `expected_artifact_name`.
10. Host-observed artifact file exists and is non-empty in the result directory.

`exit_code=0` alone is never sufficient.

## Example valid request

```text
protocol_version=1
request_id=test001
operation=RUN_BINARY
payload_name=hello_os4
expected_artifact_name=hello_os4.out
```

## Example valid result

```text
protocol_version=1
request_id=test001
operation=RUN_BINARY
transport_status=ok
execution_status=success
exit_code=0
artifact_status=present
artifact_name=hello_os4.out
log_name=log_test001.txt
detail=ok
```

## Future guest runner requirements (documented only)

Future guest runner must:

- read one validated request;
- reject malformed or unsupported requests;
- map operation to known internal handler;
- never execute arbitrary shell text from protocol fields;
- execute approved payload only;
- capture bounded execution result;
- write structured result atomically where practical;
- preserve separate log evidence;
- keep request/result correlation exact.
