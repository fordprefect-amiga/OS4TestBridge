# SAM460EX Environment Audit (Host Read-Only)

Date: 2026-10-31
Host: Linux Mint
Project: OS4 Test Bridge (standalone)

## VERIFIED

- Standalone workspace exists at `/home/ford/dev/OS4TestBridge`.
- Kyvos system profile record exists in `/home/ford/.kyvos/systems.json` with:
  - `system: "AmigaOS 4 - Sam 460ex"`
  - `name: "AmiWest2026"`
- Sam460 config evidence exists at `/home/ford/AmigaVM/Disks/Sam460/sam460ex/config.json`.
- QEMU machine type in that config is `sam460ex`.
- Networking mode in that config is user-mode (`"netdev": "user"`).
- Emulated network device in that config is `rtl8139`.
- `hostfwd` list in that config is empty (`"hostfwd": []`).
- Samba package is installed (`samba 2:4.19.5+dfsg-4ubuntu9.8`).
- Samba services observed:
  - `smbd`: active
  - `nmbd`: active
- Samba usershare exists:
  - Name: `sam460exdrop`
  - Path: `/home/ford/dev/Jeeves/vm_drop/sam460ex`
- Existing transfer tree exists:
  - `/home/ford/dev/Jeeves/vm_drop/sam460ex/incoming`
  - `/home/ford/dev/Jeeves/vm_drop/sam460ex/results`
  - `/home/ford/dev/Jeeves/vm_drop/sam460ex/logs`
- Permissions observed for the above directories: `drwxrwxr-x` owned by `ford:ford`.
- High-level contents observed:
  - `incoming`: 1 file (`jeeves_m36_slice4_2_app_integration_candidate`)
  - `results`: 0 files
  - `logs`: 0 files

## KNOWN FROM PRIOR WORK BUT NOT CURRENTLY VERIFIED

- Expected SLIRP guest-to-host alias for QEMU user-mode networking: `10.0.2.2`.
- Prior guest-side conceptual SMB mount approach:
  - `smb://10.0.2.2/sam460exdrop`
- Prior note that usershare setup did not require editing `/etc/samba/smb.conf`.

## PLANNED

- Keep OS4 Test Bridge decoupled from JEd/Jeeves.
- Build separate layers:
  - host controller
  - transport
  - guest runner
  - protocol
  - result verifier
- Start with manual-trigger proof of round trip before any remote activation.

## UNKNOWN

- Whether the guest can currently reach `10.0.2.2` from its present runtime state.
- Whether the guest currently has SMB tooling configured and working right now.
- Whether the existing usershare path can be reused by a non-JEd workflow without naming/policy changes.
- Whether there are hidden/metadata files in transfer directories not surfaced by this high-level pass.
- Which exact executable format/placement constraints are needed for the first bounded runner action.

## Notes

- This audit did not modify Samba, Kyvos/QEMU config, VM state, guest state, or JEd sources.
