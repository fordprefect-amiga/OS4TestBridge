# OS4 Test Bridge Publication Checklist

## ENGINEERING COMPLETE

- [x] Engineering release closed (Phase 7K Slice 3)
- [x] Runtime/protocol/guest behavior unchanged during publication closure
- [x] Final validation baseline recorded:
  - FINAL_TEST_COUNT=354
  - FINAL_TEST_RESULT=PASS
  - FINAL_SECURITY_RESULT=PASS
  - FINAL_CROSSBUILD_RESULT=PASS

## DOCUMENTATION COMPLETE

- [x] README polished for public technical overview
- [x] Getting-started guide polished for fresh-user setup flow
- [x] GitHub release draft prepared
- [x] Aminet submission draft prepared
- [x] OS4Depot submission draft prepared
- [x] VS Code Marketplace draft prepared
- [x] Compatibility/limitations wording aligned with validated evidence
- [x] No active public doc dependency on local developer paths

## FINAL DISTRIBUTABLE ARTIFACTS

- `os4-test-bridge-20261113T192848Z.vsix`
  - SHA256: `50b8777206093ebaf1ebebbba0cad016657066f8c9573c9ef2b14752f4288175`
- `os4-test-bridge-host-0.1.0.tar.gz`
  - SHA256: `d5073fe23d859fd82fc950335bfa691837ef4540bc2e448496fde2f2ff39185c`
- `OS4TestBridge_OS4_0.1.0.lha`
  - SHA256: `f4fd45f00e2be9e38fe3d3c1f5d0c8f8993281baad23f0811161e2c2a96d6c0d`

## USER-SUPPLIED ACCOUNT FIELDS

- [ ] Canonical public repository URL
- [ ] GitHub release page URL
- [ ] Aminet uploader/account fields
- [ ] OS4Depot account/submission fields
- [ ] VS Code Marketplace publisher ID
- [ ] Marketplace listing/support URLs

## UPLOAD/PUBLISH ACTIONS

- [ ] Create GitHub release and upload VSIX/host/OS4 guest artifacts
- [ ] Submit AmigaOS 4 guest archive to Aminet
- [ ] Submit AmigaOS 4 guest archive to OS4Depot
- [ ] Publish extension through VS Code Marketplace account workflow

## POST-PUBLISH URL BACKFILL

- [ ] Replace repository URL placeholders in distribution drafts
- [ ] Replace artifact download URL placeholders in GitHub release text
- [ ] Record Marketplace listing URL in Marketplace draft metadata
- [ ] Record Aminet and OS4Depot public listing URLs
