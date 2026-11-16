# Phase 3A File-Triggered Guest Agent

## Purpose

Remove per-request manual runner launch while keeping SMB file transport and bounded Protocol v1 semantics.

## Safety boundary

- No sockets/listeners (TCP/UDP/HTTP/SSH/telnet).
- No arbitrary shell/script fields.
- No arbitrary path selection from requests.
- Protocol v1 request contract remains authoritative (`RUN_BINARY` only).
- Guest execution path remains the existing bounded runner behavior.

## Directories and files

Host share root:

- `/home/ford/AmigaVM/smb/incoming`
- `/home/ford/AmigaVM/smb/results`
- `/home/ford/AmigaVM/smb/logs`
- `/home/ford/AmigaVM/smb/processed`

Guest paths:

- `SAMDROP:incoming`
- `SAMDROP:results`
- `SAMDROP:logs`
- `SAMDROP:processed`

## Host submission lifecycle

1. Validate request file via host validator request-only mode.
2. Extract `request_id`.
3. Write temporary file in incoming:
   - `request_<id>.req.tmp.<pid>`
4. Atomic rename to ready file:
   - `request_<id>.req`
5. Reject if ready file already exists.
6. Reject if processed evidence for same request already exists.

## Guest agent lifecycle

1. User launches agent manually from Sam Shell.
2. Agent verifies `incoming` and `processed` are accessible.
3. Agent polls `SAMDROP:incoming` every 1 second.
4. Eligible request files must match:
   - `request_<request_id>.req`
   - `<request_id>` must satisfy `[A-Za-z0-9_-]+`
   - files containing `.tmp` are ignored.
5. Agent claims one request by rename:
   - `request_<id>.req` -> `claimed_<id>.req`
6. Agent invokes bounded runner:
   - `SAMDROP:incoming/os4tb_guest_runner claimed_<id>.req`
7. Agent archives claimed request:
   - success -> `SAMDROP:processed/request_<id>.req.done`
   - failure/rejected -> `SAMDROP:processed/request_<id>.req.rejected`
8. Agent resumes polling.

## Request claiming and replay guard

- Claim is rename-based within incoming directory.
- Processed markers prevent immediate re-execution loops.
- If duplicate request for same ID appears after processing, it is moved to rejected marker path.

## Malformed request behavior

- Malformed request content is still claimed and passed to runner.
- Runner performs Protocol v1 parse/validation and writes bounded rejected result behavior.
- Agent archives request as rejected marker to avoid infinite retries.

## Duplicate request behavior

- Host submit rejects duplicates when processed marker exists.
- Guest agent also guards by checking processed markers before executing.

## Shutdown behavior

- Agent handles `SIGINT`/`SIGTERM`.
- Normal stop path: Ctrl-C in Sam Shell where supported.
- Agent exits cleanly after current poll loop.

## What remains manual in Phase 3A

- User manually starts guest agent.
- User manually observes guest shell output.
- User manually stops guest agent.
- Host-side submission and validation remain explicit commands.

## Real Sam validation closure (PASS)

Real Sam460EX Phase 3A run succeeded end-to-end:

- agent launched manually once;
- host submit returned PASS;
- request claimed automatically;
- bounded runner invoked automatically;
- real OS4 payload executed;
- result/artifact returned via SAMDROP;
- host validator returned `OS4TB_FINAL=PASS`;
- no per-request guest action was required.

Authoritative closure tokens:

- `OS4TB_PHASE3A_AGENT_BUILD=PASS`
- `OS4TB_PHASE3A_HOST_SUBMIT=PASS`
- `OS4TB_PHASE3A_REQUEST_CLAIM=PASS`
- `OS4TB_PHASE3A_AUTOMATIC_EXECUTION=PASS`
- `OS4TB_PHASE3A_RESULT_RETURN=PASS`
- `OS4TB_PHASE3A_REPLAY_GUARD=PASS`
- `OS4TB_PHASE3A_HOST_VALIDATOR=PASS`
- `OS4TB_PHASE3A_TOTAL=PASS`
