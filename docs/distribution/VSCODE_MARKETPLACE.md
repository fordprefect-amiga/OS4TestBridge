# VS Code Marketplace metadata draft (non-admin)

Display name:
OS4 Test Bridge

Short description:
Bounded VS Code bridge for Linux-host ↔ AmigaOS 4 build/run workflows.

Long description:
OS4 Test Bridge connects VS Code to AmigaOS 4 build/run workflows through a Linux host bridge and bounded file-transport contract. It supports target configuration checks, toolchain discovery, project initialization, compiler/assembler selection, and structured build/run execution with diagnostics surfaced in VS Code Problems.

Categories:
- Other

Keywords:
- AmigaOS4
- GCC
- VBCC
- cross-development
- build
- diagnostics

Requirements:
- Linux host with installed OS4 Test Bridge host package
- AmigaOS 4 guest with OS4TestBridge runtime installed
- configured shared transport directories
- target config path set in extension

Quick start:
1) Install VSIX.
2) Install Linux host package and AmigaOS 4 guest package.
3) Configure shared transport directories.
4) Select Target Configuration.
5) Run Check Target.
6) Run Inspect AmigaOS 4 SDK / Toolchains.
7) Initialize project and run build/workflow commands.

Setup reference:
- `GETTING_STARTED.md` in the release documentation bundle.

Validated environment:
- Linux Mint host + Kyvos/QEMU Sam460EX + AmigaOS 4.1
- Expected-compatible: other AmigaOS 4 setups with equivalent shared transport/process/toolchain behavior

Known limitations:
- no debugger integration in this release
- MorphOS bridge is not part of this release
- FlowerPot and other emulator arrangements are not yet validated
- some advanced compiler/toolchain combinations remain future work

Repository/Homepage:
- Publisher ID: USER-SUPPLIED BEFORE PUBLISH
- Repository URL: USER-SUPPLIED BEFORE PUBLISH
- Homepage URL: USER-SUPPLIED BEFORE PUBLISH
- Marketplace listing URL: USER-SUPPLIED AFTER PUBLISH

Icon expectation:
- Extension icon file should be package-local and referenced in `vscode-extension/package.json`.
- Canonical icon filename reserved: `docs/assets/os4-test-bridge-icon.png`.
