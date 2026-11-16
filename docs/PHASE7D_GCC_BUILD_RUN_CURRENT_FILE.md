# Phase 7D — Build and Run Current File on AmigaOS 4

## Scope

Phase 7D adds one bounded developer command:

- `OS4 Test Bridge: Build and Run Current File on AmigaOS 4`

It builds, links, and runs one saved `.c` file with real Sam GCC and publishes compile diagnostics in the existing `os4TestBridge.gcc` Problems collection.

## Bounded workflow

1. active editor must be a saved local `.c` file (dirty buffers are rejected),
2. file is staged to bridge incoming as:
   - `compile_<request_id>_source.c`
3. extension submits bounded request using payload:
   - `os4tb_gcc_build_run_adapter`
4. guest adapter compiles/links with fixed helper paths and fixed flags:
   - `-Wall -Wextra`
   - bounded runtime-library path probe over a fixed whitelist derived from the same proven GCC 11.5 runtime directory:
     - `-LGCC:lib/gcc/ppc-amigaos/11.5.0/newlib/lib/small-data/`
     - `-LWork:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/`
     - `-Wl,-L,Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/`
     - `-LGCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/`
5. before each real build/link attempt, guest adapter captures a bounded non-executing GCC link trace (`-###`) for that same mode into a request-scoped trace artifact,
6. adapter captures bounded SDK-environment semantics (`SDK:` assign, `GCC:` assign, `Work:SDK/S/gcc-startup`, `Work:SDK/Tools/set_defGCC`) using command-free DOS-list assign discovery and request-scoped audit artifacts,
7. adapter captures bounded GCC runtime-tree structure into a request-scoped artifact across fixed directories only (`GCC:lib/...` expected tree and `GCC:ppc-amigaos/bin/lib/...` actual tree), capped to 128 immediate entries per directory with no recursive traversal,
8. adapter runs a bounded direct-runtime-archive proof link path (compile-to-object with GCC, then native `ld` with explicit `libgcc.a`/`libgcc_eh.a` archive paths) and captures request-scoped direct-link output,
9. adapter emits structured artifact tokens for build and run outcomes plus diagnostics filename,
10. extension parses diagnostics, remaps staged source path back to original source path, and replaces Problems.

## Outcome semantics

- Build PASS requires:
  - `OS4TB_GCC_BUILD_EXIT=0`
  - `OS4TB_GCC_EXECUTABLE_STATUS=present`
  - no compile errors in diagnostics.
- Build FAIL skips execution (`OS4TB_PROGRAM_FINAL=NOT_RUN`).
- Build PASS + `OS4TB_PROGRAM_EXIT=0` => full PASS.
- Build PASS + nonzero program exit => run FAIL.

Runtime library telemetry tokens:

- `OS4TB_GCC_LIBGCC_DISCOVERY=found|missing`
- `OS4TB_GCC_LIBGCC_EH_DISCOVERY=found|missing`
- `OS4TB_GCC_RUNTIME_LIB_ENV=ready|not_ready`
- `OS4TB_GCC_RUNTIME_LIB_PATH=Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/`
- `OS4TB_GCC_RUNTIME_LIB_NATIVE_PATH=Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/`
- `OS4TB_GCC_RUNTIME_LIB_SMALL_DATA_PATH=GCC:lib/gcc/ppc-amigaos/11.5.0/newlib/lib/small-data/`
- `OS4TB_GCC_RUNTIME_LIB_LINKER_PATH=<last-attempted-or-successful-linker-path>`
- `OS4TB_GCC_RUNTIME_LIB_PATH_MODE=<last-attempted-or-successful-mode>`
- `OS4TB_GCC_RUNTIME_LIB_PROBE=PASS|FAIL|NOT_RUN`
- `OS4TB_GCC_RUNTIME_LIB_PROBE_ATTEMPTS=<comma-separated-deterministic-mode-list>`
- `OS4TB_GCC_LINK_TRACE_STATUS=present|missing|failed`
- `OS4TB_GCC_LINK_TRACE_FILE=<request-scoped-trace-file>`
- `OS4TB_GCC_LINK_TRACE_MODE=<last-traced-mode>`
- `OS4TB_GCC_LINK_TRACE_EXIT=<last-trace-exit-code>`
- `OS4TB_GCC_LINK_TRACE_MODES=<comma-separated-traced-mode-list>`
- `OS4TB_GCC_SDK_ASSIGN_STATUS=found|missing`
- `OS4TB_GCC_SDK_ASSIGN_TARGET=<resolved-target-or-missing>`
- `OS4TB_GCC_GCC_ASSIGN_STATUS=found|missing`
- `OS4TB_GCC_GCC_ASSIGN_TARGET=<resolved-target-or-missing>`
- `OS4TB_GCC_STARTUP_SCRIPT_STATUS=present|missing|failed`
- `OS4TB_GCC_STARTUP_SCRIPT_PATH=Work:SDK/S/gcc-startup`
- `OS4TB_GCC_STARTUP_SCRIPT_AUDIT_FILE=<request-scoped-startup-capture>`
- `OS4TB_GCC_SETDEFGCC_STATUS=present_text|present_binary_or_nontext|missing|error`
- `OS4TB_GCC_SETDEFGCC_PATH=Work:SDK/Tools/set_defGCC`
- `OS4TB_GCC_SETDEFGCC_AUDIT_FILE=<request-scoped-setdefgcc-capture>`
- `OS4TB_GCC_SDK_ENV_AUDIT_STATUS=present|missing|failed`
- `OS4TB_GCC_SDK_ENV_AUDIT_FILE=<request-scoped-assign-path-capture>`
- `OS4TB_GCC_SDK_AUDIT_PROGRESS_FILE=<request-scoped-progress-file>`
- `OS4TB_GCC_SDK_AUDIT_STAGE=start|incomplete|complete`
- `OS4TB_GCC_SDK_AUDIT_ASSIGN_ENUM=PASS|FAIL`
- `OS4TB_GCC_SDK_AUDIT_STARTUP_CAPTURE=PASS|FAIL`
- `OS4TB_GCC_SDK_AUDIT_SETDEFGCC_CAPTURE=PASS|FAIL`
- `OS4TB_GCC_RUNTIME_TREE_AUDIT_STATUS=PASS|PARTIAL|FAIL`
- `OS4TB_GCC_RUNTIME_TREE_AUDIT_FILE=<request-scoped-runtime-tree-capture>`
- `OS4TB_GCC_EXPECTED_RUNTIME_DIR_STATUS=present|missing|error`
- `OS4TB_GCC_EXPECTED_LIBGCC_STATUS=present|missing|link|broken_link|unknown`
- `OS4TB_GCC_EXPECTED_LIBGCC_EH_STATUS=present|missing|link|broken_link|unknown`
- `OS4TB_GCC_SMALL_DATA_DIR_STATUS=present|missing|error`
- `OS4TB_GCC_SMALL_DATA_LIBGCC_STATUS=present|missing`
- `OS4TB_GCC_SMALL_DATA_LIBGCC_EH_STATUS=present|missing`
- `OS4TB_GCC_ACTUAL_RUNTIME_DIR_STATUS=present|missing|error`
- `OS4TB_GCC_ACTUAL_LIBGCC_STATUS=present|missing`
- `OS4TB_GCC_ACTUAL_LIBGCC_EH_STATUS=present|missing`
- `OS4TB_GCC_DIRECT_LINK_PROOF=enabled`
- `OS4TB_GCC_DIRECT_LINK_OBJECT=<request-scoped-object-name>`
- `OS4TB_GCC_DIRECT_LINK_LIBGCC=GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc.a`
- `OS4TB_GCC_DIRECT_LINK_LIBGCC_EH=GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc_eh.a`
- `OS4TB_GCC_DIRECT_LIBGCC_STATUS=present|missing`
- `OS4TB_GCC_DIRECT_LIBGCC_EH_STATUS=present|missing`
- `OS4TB_GCC_DIRECT_LIBGCC_SIZE=<bytes-or--1>`
- `OS4TB_GCC_DIRECT_LIBGCC_EH_SIZE=<bytes-or--1>`
- `OS4TB_GCC_DIRECT_LINK_OUTPUT_FILE=<request-scoped-direct-link-output>`
- `OS4TB_GCC_DIRECT_LINK_EXIT=<native-ld-exit>`
- `OS4TB_GCC_DIRECT_LINK_EXECUTABLE_STATUS=present|missing`
- `OS4TB_GCC_DIRECT_LINK_FINAL=PASS|FAIL|NOT_RUN`

## Timeout policy

- Per-operation timeout setting:
  - `os4TestBridge.gccBuildRunTimeoutSeconds` (default `180`)
- Backend/orchestrator timeout uses that value directly for `os4tb run --timeout <seconds>`.
- Extension process timeout uses bounded safety margin:
  - `gccBuildRunTimeoutSeconds + 10 seconds`
- No infinite waits; global default timeout remains unchanged for other commands.

## Out of scope

- no multi-file project builds,
- no arbitrary compile/link/runtime flags,
- no shell command execution surface,
- no debugger/session orchestration.
