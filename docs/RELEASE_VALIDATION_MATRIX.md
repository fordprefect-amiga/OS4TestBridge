# OS4 Test Bridge Release Validation Matrix — Phase 7J Final Closure

Date (UTC): 2026-11-13  
Scope: v1 packaged extension technical readiness (local/public distribution readiness)  
Out of scope for this closure: Marketplace administration/publisher operations

## Final manual clean-install acceptance matrix

### Section A

- A1=PASS
- A2=PASS
- A3=PASS
- A4=PASS

### Section B

- B1=PASS
- B2=PASS
- B3=PASS
- B4=PASS

### Section C

- C1=PASS
- C2=PASS
- C3=PASS
- C4=PASS
- C5=PASS

### Section D

- D1=PASS
- D2=PASS
- D3=PASS
- D4=PASS
- D5=PASS

Evidence highlights:

- AmigaOS 4 SDK discovery complete
- SDK root present (`Work:SDK`)
- GCC active version `11.5.0`
- GCC count `3`
- VBCC detected
- Assembler detected
- Linker detected
- Include paths `7`
- Library dirs `3`
- Libraries discovered `28`

### Section E

- E1=PASS
- E2=PASS
- E3=PASS

### Section F

- F1=PASS
- F2=PASS
- F3=PASS

### Section G

- G1=PASS
- G2=PASS
- G3=PASS
- G4=PASS

### Section H

- H1=PASS

### Section I

- I1=PASS
- I2=PASS
- I3=PASS

Evidence highlight:

- Missing configured target path is surfaced explicitly:  
  `Configured os4TestBridge.configPath was not found: /tmp/os4tb-does-not-exist.conf`

### Section J

- J1=PASS
- J2=PASS
- J3=PASS

Evidence highlights:

- `Open a workspace folder before initializing an OS4 Test Bridge project.`
- `Open a saved project file before selecting an OS4TB project toolchain.`
- `Open a saved project file before selecting an OS4TB project assembler.`

## Slice closure summary (5B–5G)

### Slice 5B — CLOSED

- Root cause: `configPath` write attempted folder-scope semantics incompatible with setting metadata
- Selected repair: corrected update path semantics
- Regression evidence: compile/test/security/cross-build PASS
- Manual outcome: Section B PASS

### Slice 5C — CLOSED

- Root cause: Inspect Toolchains required hidden payload-name bootstrap setting on clean install
- Selected repair: canonical payload default/fallback with bounded validation
- Regression evidence: compile/test/security/cross-build PASS
- Manual outcome: Section C PASS

### Slice 5D — CLOSED

- Root cause: host CLI resolution failed (`ENOENT`) in clean packaged profile
- Selected repair: explicit host executable authority + actionable missing-host messaging
- Regression evidence: compile/test/security/cross-build PASS
- Manual outcome: D progressed past host spawn failure

### Slice 5E — CLOSED

- Root cause: Inspect workflow exceeded previous host wait behavior while guest still completed
- Selected repair: explicit inspect-timeout contract path and guest-stage trace
- Regression evidence: compile/test/security/cross-build PASS
- Manual outcome: D flow stabilized for further propagation audit

### Slice 5F — CLOSED

- Root cause: `inspectToolchainsTimeoutSeconds` existed but was not propagated on Inspect runtime path
- Selected repair: propagate inspect timeout to host invocation on Inspect path; keep other operations unchanged
- Regression evidence: compile/test/security/cross-build PASS
- Manual outcome: Inspect timeout propagation fixed

### Slice 5G — CLOSED

- Root cause: workspace `configPath` override masked user-scope invalid value, presenting stale target authority
- Selected repair: enforce single authority behavior and clear workspace override when selecting target config
- Regression evidence: compile/test/security/cross-build PASS
- Manual outcome: Section I PASS

## Final setting authorities

- Target config authority: `os4TestBridge.configPath`
- Host executable authority: `os4TestBridge.executablePath`
- Inspect timeout authority: `os4TestBridge.inspectToolchainsTimeoutSeconds`
- Project toolchain authority: `.os4tb-project` explicit key, or Automatic via key absence
- Project assembler authority: `.os4tb-project` explicit key, or Automatic via key absence

## Distribution model boundaries (v1)

1. VS Code extension / VSIX
2. Linux host bridge package
3. AmigaOS 4 guest package
4. Protocol v1 contract

`DISTRIBUTION_COMPONENT_BOUNDARIES_CLEAR=YES`

Host CLI resolution contract:

- `os4tb` available on `PATH`, or
- `os4TestBridge.executablePath` set to installed host CLI path

Guest software is installed/distributed separately from the VSIX.

## Distribution channel plan

- Canonical project documentation and release hub: GitHub
- Additional distribution targets: OS4Depot, Aminet
- Future platform-native channel note: MorphOS Storage for MorphOS-specific build
- Platform-native package descriptions should point back to canonical GitHub docs

No channel upload completion is claimed by this document.

## Final package under acceptance

- VSIX path: `vsix/os4-test-bridge-20261113T192848Z.vsix`
- VSIX SHA256: `50b8777206093ebaf1ebebbba0cad016657066f8c9573c9ef2b14752f4288175`

Package audit summary:

- runtime present: PASS
- `package.json` present: PASS
- `README.md` present: PASS
- tests excluded: PASS
- `.artifacts` excluded: PASS
- local config excluded: PASS
- credentials excluded: PASS

## Packaged README URL impact note

Earlier packaging commands used:

- `--baseContentUrl https://example.invalid/os4tb`
- `--baseImagesUrl https://example.invalid/os4tb`

This can rewrite relative README links into placeholder-host links in packaged metadata.
To avoid user-visible broken links from placeholder rewrites, extension README references are now plain-text paths for local documentation pointers.

## Final closure classification

- Technical local VSIX readiness: PASS
- Manual clean-install matrix A-J: PASS
- Real Sam discovery proof: PASS
- Security validation: PASS
- Cross-build validation: PASS
- Release documentation readiness: PASS
- Package audit readiness: PASS

`PHASE7J_FINAL_CLASSIFICATION=PHASE-7J-PASS`
