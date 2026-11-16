# JEd handoff reference

This handoff describes how downstream projects should consume OS4 Test Bridge as an external toolchain bridge. JEd is an example consumer.

## Stable workflow contract

1. Select target config (`OS4 Test Bridge: Select Target Configuration`)
2. Validate host/target wiring (`OS4 Test Bridge: Check Target`)
3. Discover available SDK/toolchains (`OS4 Test Bridge: Inspect AmigaOS 4 SDK / Toolchains`)
4. Initialize project metadata (`OS4 Test Bridge: Initialize Project`)
5. Select compiler/assembler (or keep automatic resolution)
6. Execute build/run workflow from VS Code
7. Consume diagnostics via Problems integration and status/result fields

## Integration constraints

- Keep bridge invocation bounded through extension commands/settings.
- Do not introduce shell-command passthrough.
- Treat target config path as the single authority for target-dependent commands.
- Preserve protocol v1 request/result compatibility.
- GCC project manifests may include `TOOLCHAIN_SDK_ROOT`; when present, guest compile injects `${TOOLCHAIN_SDK_ROOT}/MUI/C/include` only if `libraries/mui.h` exists there, preserving strict parsing while handling SDK layout variance.
- GCC project manifests represent ordered internal GCC include directories with bounded typed fields (`TOOLCHAIN_INTERNAL_INCLUDE_COUNT`, `TOOLCHAIN_INTERNAL_INCLUDE_<n>`; max `8`) and preserve discovery order through adapter invocation.
- Manifest lines are parsed as `KEY=<remaining value>` at the generic layer; typed field validators remain responsible for per-field grammar (including define entry validation).

## Out of scope for this handoff

- No JEd implementation details
- No JEd-specific extension forks in this repository
