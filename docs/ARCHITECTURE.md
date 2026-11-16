# OS4 Test Bridge Architecture (Bootstrap)

## Design boundaries

### 1) HOST CONTROLLER

Responsible for:

- creating request files;
- placing transfer payloads;
- waiting/polling (future);
- retrieving result files;
- verifying execution + artifact postconditions.

Not responsible for guest execution internals.

### 2) TRANSPORT

Initial transport: shared-folder/Samba drop path.

Responsibilities:

- move request/payload/result files between host and guest-visible path.

Must not own or reinterpret execution semantics.

### 3) GUEST RUNNER (future)

Future bounded AmigaOS-side runner that:

- accepts typed requests;
- validates required fields;
- executes only supported operations;
- writes structured result files;
- optionally writes raw logs/evidence files.

No persistent daemon required for Phase 2.
Manual launch in guest is acceptable for first proof.

### 4) PROTOCOL

Must define:

- request ID/correlation ID;
- operation token (typed, bounded);
- executable/artifact references;
- validated argument fields (if enabled);
- expected outputs/postconditions;
- result status and process exit status;
- timestamps where useful;
- references to raw logs/evidence.

### 5) RESULT VERIFIER (host-side)

Must distinguish:

1. transport success
2. execution success
3. artifact/postcondition success

A zero exit code alone is insufficient.

## Phase 2: minimum manual-trigger proof

1. Host writes `request_<id>.req` and places one approved executable payload in incoming path.
2. Guest user manually starts one bounded runner action.
3. Runner executes only the approved operation and writes `result_<id>.res` (and optional `log_<id>.txt`).
4. Host reads and verifies:
   - correlation ID match;
   - result status;
   - expected result/artifact existence;
   - artifact non-zero check where required.

No remote activation, no background guest service, no arbitrary command channel.

## Request/result format recommendation

### Compared briefly

- **key=value (line-oriented text):**
  - Pros: trivial C11 parsing, deterministic, human-readable, no dependency.
  - Cons: must define escaping/encoding rules.
- **JSON:**
  - Pros: standard and expressive.
  - Cons: parser complexity/dependency burden on strict C11/AmigaOS bootstrap phase.
- **CSV/TSV-style lightweight table:**
  - Pros: simple for flat records.
  - Cons: poor for nested/postcondition fields and repeated keys.

### Recommendation for bootstrap

Use **line-oriented `key=value` text v1** with strict schema/version keys and fixed allowed fields.

Why now:

- easiest deterministic parser in C11 without external libraries;
- easy inspection in Linux and AmigaOS;
- easy to reject unknown/missing/duplicate-required fields fail-closed.

## Safety rules (future enforcement)

- Host request `operation` maps to known operation enum; never execute raw host command strings.
- Reject paths that are absolute where not allowed, contain `..`, or escape approved directories.
- Never pass host-supplied strings through shell evaluation.
- Include request ID + nonce/timestamp window to reduce stale replay acceptance.
- Bind result to request ID and include runner-side status token to avoid result confusion/mix-ups.

## Conceptual patterns observed in JEd (read-only, not copied)

Useful patterns worth reusing conceptually:

- typed enums for request/action/status rather than free-form command text;
- explicit request IDs/correlation IDs across request/response;
- separate transport status from execution status from artifact validation status;
- bounded capacities and fail-closed invalid-state handling.

These ideas are reusable without coupling OS4 Test Bridge to JEd implementation.
