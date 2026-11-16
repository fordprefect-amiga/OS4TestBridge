# Phase 2 Manual Round Trip (Sam460EX)

## VERIFIED

- Protocol v1 request/result format and strict validator exist in this repository.
- Host validator is [host/os4tb_validate.c](/home/ford/dev/OS4TestBridge/host/os4tb_validate.c).
- Real host share path is `/home/ford/AmigaVM/smb`.
- Guest mount path is `SAMDROP:`.
- Kyvos/QEMU SMB endpoint is `smb://10.0.2.4/qemu`.
- Manual transport proof is complete (mount/read/write/bidirectional PASS).
- Real-share subpaths in use:
  - `/home/ford/AmigaVM/smb/incoming`
  - `/home/ford/AmigaVM/smb/results`
  - `/home/ford/AmigaVM/smb/logs`
- Prior Jeeves `vm_drop` path is legacy/transitional evidence only and not used for Phase 2 execution.

## IMPLEMENTED (Phase 2 prep)

- Guest runner source: [guest/os4tb_guest_runner.c](/home/ford/dev/OS4TestBridge/guest/os4tb_guest_runner.c)
- Test payload source: [guest/os4tb_phase2_payload.c](/home/ford/dev/OS4TestBridge/guest/os4tb_phase2_payload.c)
- Canonical request: [protocol/requests/request_phase2_001.req](/home/ford/dev/OS4TestBridge/protocol/requests/request_phase2_001.req)
- Bundle staging directory: `build/phase2_bundle/`

## Guest runner behavior

- Manual one-shot CLI program (no daemon).
- Reads exactly one request file from `SAMDROP:incoming`.
- Enforces Protocol v1 core checks:
  - required keys present;
  - duplicate/unknown/malformed keys rejected;
  - `protocol_version=1`;
  - `operation=RUN_BINARY`;
  - safe `request_id`;
  - basename-only safe `payload_name` and `expected_artifact_name`.
- Rejects forbidden shell-like keys (`command`, `shell`, `script`).
- Executes only validated payload basename from fixed incoming directory.
- Writes structured result file to `SAMDROP:results/result_<request_id>.res`.
- Writes optional bounded log file to `SAMDROP:logs/log_<request_id>.txt`.

## Execution safety boundary

- Request cannot choose directories.
- Runner uses fixed directories (`SAMDROP:incoming`, `SAMDROP:results`, `SAMDROP:logs`).
- Payload and artifact fields are basename-only and character-restricted.
- Runner uses a command string only from validated bounded fields:
  - `SAMDROP:incoming/<payload_name> <expected_artifact_name>`
- No request-provided arbitrary shell field is accepted.

## Result writing strategy

- Runner writes result/log via temporary file then rename (`.tmp` → final).
- Goal: reduce risk of host reading partial files.

## Host validation command (after Sam run)

```bash
/home/ford/dev/OS4TestBridge/build/host/os4tb_validate \
  /home/ford/dev/OS4TestBridge/protocol/requests/request_phase2_001.req \
  /home/ford/AmigaVM/smb/results/result_phase2_001.res
```

Note: host validator now also checks that the reported artifact file exists and is non-empty in the same directory as the result file.

## Exact manual Sam command

```text
SAMDROP:incoming/os4tb_guest_runner request_phase2_001.req
```

## Expected outputs for success run

- `SAMDROP:results/result_phase2_001.res`
- `SAMDROP:results/phase2_001.artifact` (non-empty)
- optional `SAMDROP:logs/log_phase2_001.txt`

## Real-guest execution status (closed)

Real Sam460EX run succeeded end-to-end and host validator returned PASS.

- `OS4TB_PHASE2_GUEST_RUNNER=PASS`
- `OS4TB_PHASE2_PAYLOAD_EXECUTION=PASS`
- `OS4TB_PHASE2_RESULT_WRITE=PASS`
- `OS4TB_PHASE2_ARTIFACT_POSTCONDITION=PASS`
- `OS4TB_PHASE2_HOST_VALIDATOR=PASS`
- `OS4TB_PHASE2_TOTAL=PASS`

## PLANNED (deferred)

- Automated guest trigger/polling.
- Broader stdout/stderr capture.
- Additional guest negative test executions (nonzero child, missing artifact, malformed request, unsafe traversal input).
- Decoupled OS4TestBridge-owned transport path replacing transitional shared path.
