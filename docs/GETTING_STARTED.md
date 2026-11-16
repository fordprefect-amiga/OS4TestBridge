# OS4 Test Bridge Getting Started

This guide is for first-time setup of OS4 Test Bridge across:

- Linux host
- VS Code
- AmigaOS 4 guest system/VM

It does not assume a repository checkout.

## 1) Install the VSIX (VS Code)

Install the OS4 Test Bridge extension from the release VSIX package.

## 2) Install the Linux host package (Linux host)

Install the host package so `os4tb` is available either:

- on `PATH`, or
- at a known absolute path you can place into `os4TestBridge.executablePath`

## 3) Install the AmigaOS 4 guest package (AmigaOS 4 guest)

Extract `OS4TestBridge_OS4_0.1.0.lha` on AmigaOS 4 to create the `OS4TestBridge` drawer.
Review:

- `Docs/INSTALL.txt`
- `Docs/TROUBLESHOOTING.txt`
- `S/startup-example`

## 4) Configure shared transport locations (Linux host + AmigaOS 4 guest)

Create and mount shared transport directories visible to both sides:

- `incoming/`
- `results/`
- `logs/`
- `processed/`

Example transport can use SMB (`smb2-handler`) or equivalent, as long as both sides see the same directories.

## 5) Start the guest agent (AmigaOS 4 guest)

Start the `OS4TestBridge` guest agent and configure startup according to `S/startup-example`.

## 6) Create host configuration (Linux host)

Use [os4tb.conf.example](../config/os4tb.conf.example) as template and fill paths for your machine.

Default user config lookup path:

- `~/.config/os4testbridge/config`

## 7) Verify host-side configuration (Linux host)

```bash
os4tb --config /path/to/your/os4tb.conf check
```

Expect:

- `HOST_CONFIGURATION=PASS`
- `REAL_GUEST_STATUS=UNKNOWN`

## 8) Configure target settings (VS Code)

In VS Code:

1. Run `OS4 Test Bridge: Select Target Configuration` and select your host config file (`os4TestBridge.configPath`).
2. If `os4tb` is not on `PATH`, set `os4TestBridge.executablePath` to the installed host CLI path.

## 9) Validate target and discover toolchains (VS Code)

Run:

1. `OS4 Test Bridge: Check Target`
2. `OS4 Test Bridge: Inspect AmigaOS 4 SDK / Toolchains`

## 10) Initialize and use project workflow (VS Code)

Run:

1. `OS4 Test Bridge: Initialize Project`
2. Optional: `OS4 Test Bridge: Select Project Toolchain`
3. Optional: `OS4 Test Bridge: Select Project Assembler`
4. `OS4 Test Bridge: Build and Run Project on AmigaOS 4`

Diagnostics appear in Problems (`os4TestBridge.gcc` collection).

## Optional direct host CLI run test (Linux host)

```bash
os4tb --config /path/to/your/os4tb.conf run /path/to/request.req
```

The command handles request validation, safe submit, wait, and result/artifact validation.

Timeout guidance:

- `os4TestBridge.defaultTimeoutSeconds` is the general command timeout.
- `os4TestBridge.inspectToolchainsTimeoutSeconds` is a separate, bounded timeout for SDK/toolchain discovery and is expected to be larger.
