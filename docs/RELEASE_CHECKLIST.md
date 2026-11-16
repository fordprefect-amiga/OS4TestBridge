# OS4 Test Bridge Release Checklist

Status baseline: Phase 7J and Phase 7K Slice 3 are complete. This checklist tracks final engineering release-handoff state.

## Completed repository-side release work

- [x] Phase 7J validation complete (A–J PASS evidence in [RELEASE_VALIDATION_MATRIX.md](RELEASE_VALIDATION_MATRIX.md))
- [x] Clean-install acceptance completed and documented
- [x] Host packaging finalized and validated
- [x] OS4 guest staging finalized (directory ready for native `.lha`)
- [x] Core release docs refreshed ([README.md](../README.md), [GETTING_STARTED.md](GETTING_STARTED.md), [RELEASE_DISTRIBUTION.md](RELEASE_DISTRIBUTION.md))
- [x] Native AmigaOS archive created and incorporated (`archives/OS4TestBridge_OS4_0.1.0.lha`)
- [x] Final `.lha` checksum/manifest helper run successfully
- [x] Checksums + release manifest workflow established (including post-`.lha` helper)
- [x] Branding filenames reserved in canonical assets directory (`docs/assets/`)

## Remaining intentional manual/public steps

- [ ] Final site-specific submission formatting
- [ ] Public upload

## Non-blocking release admin placeholders

- [ ] Confirm final canonical public repository URL
- [ ] Confirm final VS Code Marketplace publisher identity
- [ ] Copy approved icon/hero artwork into `docs/assets/` (if not yet present)
