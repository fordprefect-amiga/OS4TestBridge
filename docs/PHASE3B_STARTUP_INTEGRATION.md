# Phase 3B Startup Integration

## Goal

Workbench-native startup polish: keep proven Phase 3B behavior but eliminate the unwanted Shell/console window when the agent is launched from WBStartup.

## PROVEN Phase 3B startup architecture

1. Late Startup-Sequence mount:
   - `Mount SAMDROP: FROM SYS/DOSDrivers/SAMDROP`
2. Workbench starts (`LoadWB`).
3. WBStartup launches locally installed `os4tb_guest_agent`.
4. WBStartup icon includes `DONOTWAIT`.
5. Agent processes requests automatically from SAMDROP transport.

Real request evidence already PASS:

- `phase3b_001` validator PASS
- `phase3b_002` validator PASS
- post-reboot autostart observed PASS
- `phase3b_wb_001` validator PASS
- `phase3b_wb_002` validator PASS

## Local install location (unchanged)

- `SYS:OS4TestBridge/os4tb_guest_agent`

Rationale: executable availability is decoupled from SMB share content.

## Startup dependencies

- networking initialized enough for SAMDROP mount path;
- SAMDROP mounted by the proven startup mount command;
- Workbench running so WBStartup can launch the agent.

## Exact expected WBStartup icon configuration

- `DONOTWAIT` required.
- No additional ToolType required for this patch.
- `CONSOLE=NIL:` not required.

## Proven revised Workbench-aware agent

- bytes: `69956`
- SHA256: `855c13d68101d3cd48607ad7d63e4c056e3e402c510ccc517730a41752bda821`
- no wait requester;
- no unwanted Shell/console window;
- no manual guest launch required between boot and request execution.

## Authoritative Phase 3B Workbench PASS tokens

- `OS4TB_PHASE3B_WB_MODE_IMPLEMENTED=PASS`
- `OS4TB_PHASE3B_WB_NO_CONSOLE=PASS`
- `OS4TB_PHASE3B_WB_NO_REQUESTER=PASS`
- `OS4TB_PHASE3B_WB_AUTOSTART=PASS`
- `OS4TB_PHASE3B_WB_FIRST_REQUEST=PASS`
- `OS4TB_PHASE3B_WB_SECOND_REQUEST=PASS`
- `OS4TB_PHASE3B_WB_HOST_VALIDATOR=PASS`
- `OS4TB_PHASE3B_WB_TOTAL=PASS`
