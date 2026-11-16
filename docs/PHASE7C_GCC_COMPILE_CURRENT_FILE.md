# Phase 7C — Compile Current File on AmigaOS 4

## Scope

Phase 7C adds one bounded developer command:

- `OS4 Test Bridge: Compile Current File on AmigaOS 4`

It compiles one saved `.c` file with real Sam GCC and publishes diagnostics in the existing `os4TestBridge.gcc` Problems collection.

## Bounded workflow

1. active editor must be a saved local `.c` file (dirty buffers are rejected),
2. file is staged to bridge incoming as:
   - `compile_<request_id>_source.c`
3. extension submits bounded request using payload:
   - `os4tb_gcc_compile_adapter`
4. guest adapter compiles with fixed flags and fixed helper paths:
   - `-c -Wall -Wextra`
5. adapter emits structured artifact tokens and dedicated diagnostics file,
6. extension parses diagnostics, remaps staged source path back to original source path, and replaces Problems.

## Path mapping and safety

- Only bridge-owned staged path is remapped for current compile request:
  - `SAMDROP:incoming/compile_<request_id>_source.c -> <original host source path>`
- Arbitrary AmigaDOS volumes and traversal remain rejected by shared path-mapping helpers.
- Mapping is request-scoped and replaced on subsequent requests.

## Compile outcome semantics

- `compile_exit=0` + `object_status=present` => compile PASS (warnings allowed).
- `compile_exit!=0` => compile FAIL (transport can still be successful).
- `compile_exit=0` + `object_status=missing` => compile FAIL.

## Out of scope

- no linking, no multi-file builds, no make/project integration, no arbitrary flags, no shell command injection path.

