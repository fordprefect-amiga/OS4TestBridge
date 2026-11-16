# OS4 Test Bridge

OS4 Test Bridge — the Bridge of Light between VS Code and AmigaOS 4.

OS4 Test Bridge is a typed, bounded bridge for Linux-host ↔ AmigaOS 4 build/run workflows.

## What it is

OS4 Test Bridge connects VS Code project workflows to a Linux host bridge CLI and an AmigaOS 4 guest agent.  
It provides structured request/response execution, toolchain-aware project commands, and diagnostics surfaced back into VS Code.

## Architecture

VS Code extension → Linux host bridge CLI → shared transport → AmigaOS 4 guest agent

## Why it exists

Cross-development loops for AmigaOS 4 are often split across machines and toolchains.  
OS4 Test Bridge standardizes that workflow so developers can run consistent, bounded operations from VS Code and receive real target-side compiler/runtime feedback.

## Execution model

- Typed operations instead of free-form shell execution
- Bounded project and manifest parsing
- Bounded source-set/toolchain selection flows
- Structured result reporting with request/result correlation

## Requirements

- Linux host with OS4 Test Bridge host package installed
- AmigaOS 4 system/VM with OS4 Test Bridge guest package installed
- Shared transport directories (`incoming`, `results`, `logs`, `processed`) visible to host and guest
- Target configuration selected in VS Code (`os4TestBridge.configPath`)

## Quick start

Detailed setup: [GETTING_STARTED.md](docs/GETTING_STARTED.md)

## VS Code workflow

1. Select Target Configuration
2. Check Target
3. Inspect AmigaOS 4 SDK / Toolchains
4. Initialize Project
5. Build/run project workflows and inspect diagnostics in Problems

## Target configuration

Use `OS4 Test Bridge: Select Target Configuration` to set `os4TestBridge.configPath`, then run `OS4 Test Bridge: Check Target`.

## Toolchain discovery

Run `OS4 Test Bridge: Inspect AmigaOS 4 SDK / Toolchains` to detect GCC/VBCC/assemblers and publish discovered families.

## Project initialization

Run `OS4 Test Bridge: Initialize Project` in the workspace to create bounded bridge project metadata.

## Compiler/assembler selection

Use:

- `OS4 Test Bridge: Select Project Toolchain`
- `OS4 Test Bridge: Select Project Assembler`

Selections can remain automatic when multiple compatible tools are present.

## Build/run workflow

Use `OS4 Test Bridge: Build and Run Project on AmigaOS 4` (or the single-file commands) and review diagnostics in the VS Code Problems view.

## Package components

- VSIX: VS Code integration
- Linux host package: bridge CLI/orchestration/runtime
- AmigaOS 4 `.lha`: guest agent, payloads, guest docs, startup example
- Protocol/docs: interoperability and developer reference

## Troubleshooting

- [RELEASE_VALIDATION_MATRIX.md](docs/RELEASE_VALIDATION_MATRIX.md)
- [SAM460EX_ENVIRONMENT_AUDIT.md](docs/SAM460EX_ENVIRONMENT_AUDIT.md)
- [ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Security philosophy

- typed operations
- bounded manifests and source sets
- bounded toolchain and assembler selection
- safe relative path handling
- no arbitrary shell passthrough
- no arbitrary compiler-flag passthrough
- structured correlated request/result artifacts

This is an engineering security model, not a formal certification.

## Validated environment

Validated reference environment:

- Linux Mint host + Kyvos/QEMU Sam460EX + AmigaOS 4.1

## Compatibility notes

- Expected-compatible: other AmigaOS 4 setups providing equivalent shared transport, process execution, and supported SDK/toolchain behavior
- Not yet validated: FlowerPot and other emulator arrangements

## Current limitations

- No debugger integration in this release
- MorphOS bridge is not part of this release
- Some advanced compiler/toolchain combinations remain future work
- Final GUI/runtime behavior always requires target-side validation

## Release and publication docs

- [RELEASE_DISTRIBUTION.md](docs/RELEASE_DISTRIBUTION.md)
- [docs/distribution/](docs/distribution)
- [RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- Canonical project URL placeholder: `<GITHUB_PROJECT_URL_PLACEHOLDER>`

Component versions:

- Extension version: `0.0.1`
- Host tool version: `0.1.0`
- OS4 guest version: `0.1.0`
- Protocol version: `1`
- Discovery schema version: `1`

## License

OS4 Test Bridge original project code is licensed under the MIT License.  
See [LICENSE](LICENSE) for details.
