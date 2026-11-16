# OS4 Test Bridge release distribution guide (Phase 7K)

## Component model (v1)

OS4 Test Bridge is distributed as four coordinated components:

1. VS Code extension (`.vsix`)
2. Linux host bridge package
3. AmigaOS 4 guest package
4. Protocol v1 contract/documentation

Each component can be obtained independently, but all four are required for end-to-end operation.

## Machine/package mapping

- Linux host machine:
  - install VS Code extension (`.vsix`)
  - install Linux host bridge package
  - configure shared directories (`incoming`, `results`, `logs`, `processed`)
- AmigaOS 4 machine/VM:
  - install AmigaOS guest package (agent + payloads)
  - configure startup to keep guest agent running

## Recommended installation order

1. Install Linux host package.
2. Install AmigaOS 4 guest package.
3. Configure share and host config file.
4. Install VSIX in VS Code.
5. In extension:
   - Select Target Configuration
   - Check Target
   - Inspect AmigaOS 4 SDK / Toolchains
   - Initialize Project
   - Optional: Select Project Toolchain / Select Project Assembler
   - Run project workflows

## Host executable authority

Supported models:

- `os4tb` available on `PATH`
- explicit `os4TestBridge.executablePath` setting pointing to installed host CLI

User-local install is supported (no root required).

## Timeout model

- `os4TestBridge.defaultTimeoutSeconds`: general command timeout
- `os4TestBridge.inspectToolchainsTimeoutSeconds`: dedicated bounded timeout for SDK/toolchain discovery

## Environment support wording

- Validated reference environment:
  - AmigaOS 4.1 under Kyvos/QEMU on Linux Mint
- Expected-compatible environments:
  - other AmigaOS 4.1 systems providing equivalent filesystem sharing, process execution, and toolchain access
- FlowerPot/WinUAE-derived environments:
  - not yet validated by this project

## Distribution channels (plan)

- GitHub: canonical documentation, releases, issue tracking
- OS4Depot: AmigaOS 4 guest archive
- Aminet: AmigaOS 4 guest archive
- VS Code Marketplace: future extension distribution
- MorphOS Storage: future MorphOS package only

No public uploads are performed by this document.

## Version relationships

- Extension version: VS Code extension release identity
- Host version: Linux bridge CLI release identity
- OS4 guest version: AmigaOS package release identity (if formalized)
- Protocol version: wire/request-response compatibility identity
- Discovery schema version: discovery artifact schema compatibility identity

These versions do not need to be numerically identical.

## Canonical project URL placeholder

If a public canonical repository URL is not yet established, use:

`<GITHUB_PROJECT_URL_PLACEHOLDER>`

in external package listings and point users to the same canonical documentation location once assigned.
