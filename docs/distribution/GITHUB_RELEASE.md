# OS4 Test Bridge 0.1.0

## Release title

OS4 Test Bridge 0.1.0 — VS Code + Linux host + AmigaOS 4 guest distribution set

## Overview

OS4 Test Bridge provides a typed, bounded workflow that connects VS Code on Linux to AmigaOS 4 build/run execution through a Linux host bridge and shared transport contract.

## Main features

- VS Code target validation and project workflow commands
- Toolchain discovery for GCC/VBCC/assembler families
- Structured request/result execution model
- Problems-integrated diagnostics from target-side compilation

## Security and execution model

- Typed, bounded operations
- No arbitrary shell passthrough
- No arbitrary compiler-flag passthrough
- Safe relative project path handling
- Structured request/result correlation and validation

This is an engineering safety model, not a formal security certification.

## Artifacts

- `os4-test-bridge-20261113T192848Z.vsix` (VS Code extension package)
- `os4-test-bridge-host-0.1.0.tar.gz` (Linux host package)
- `OS4TestBridge_OS4_0.1.0.lha` (AmigaOS 4 guest package)

## SHA256

- `os4-test-bridge-20261113T192848Z.vsix`  
  `50b8777206093ebaf1ebebbba0cad016657066f8c9573c9ef2b14752f4288175`
- `os4-test-bridge-host-0.1.0.tar.gz`  
  `d5073fe23d859fd82fc950335bfa691837ef4540bc2e448496fde2f2ff39185c`
- `OS4TestBridge_OS4_0.1.0.lha`  
  `f4fd45f00e2be9e38fe3d3c1f5d0c8f8993281baad23f0811161e2c2a96d6c0d`

## Validated environment

- Linux Mint host
- Kyvos/QEMU Sam460EX
- AmigaOS 4.1
- Real AmigaOS 4 GCC 11.5 toolchain

Expected-compatible: other AmigaOS 4 setups with equivalent shared transport, process execution, and supported SDK/toolchain behavior.
Not yet validated: FlowerPot and other emulator arrangements.

## Quick-start pointer

See:

- [README.md](../../README.md)
- [GETTING_STARTED.md](../GETTING_STARTED.md)

## Known limitations

- No debugger integration in this release
- MorphOS bridge is not part of this release
- Advanced compiler/toolchain combinations may require future updates

## License

License: MIT. See the repository LICENSE file for details.

## Project links

- Repository URL: https://github.com/fordprefect-amiga/OS4TestBridge
- Release URL: https://github.com/fordprefect-amiga/OS4TestBridge/releases/tag/v0.1.0
