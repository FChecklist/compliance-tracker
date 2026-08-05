# PROGRESS -- task-20260805-173250-real-comprehensive-end-to-end-browser-te

Real comprehensive end-to-end browser testing of live projexa-ai.com
(OCID-020 / UMR-20260802-165606-4413), starting from the PM's real
`/signup` title-redirect finding.

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS, CONSTITUTION pointers, AGENTS.md, CLAUDE.md)
- [x] Registered ACTIVE-CLAIMS.yaml entry for this task
- [x] Root-caused the PM's `/signup` finding via curl + source read: NOT a redirect --
      the real signup form renders correctly, but `<title>`/OG metadata is the root
      layout's generic "VERIDIAN COGNITIVE AI OS" (no per-page override), and the
      wordmark is hardcoded "VERIDIAN AI" -- the exact OCID-038
      GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH class already fixed on `/login`
      (UMR-20260804-090421-c647) but never applied to `/signup`.

## Remaining
- [ ] Fix `/signup`: split into async server `page.tsx` (generateMetadata + host-brand
      resolution) + client `signup-form.tsx` (brand prop), mirroring `/login`'s fixed pattern
- [ ] Real Playwright browser sweep (no sudo chromium fix, LD_LIBRARY_PATH):
      root `/`, `/login`, `/signup` (before+after fix), other reachable public/marketing pages
      -- screenshot + URL evidence for each
- [ ] Independently retest `/signup` post-fix (title + wordmark reflect live host brand)
- [ ] Deposit real evidence into `ocid_canonical_registry` evidence_json for OCID-020 via
      `upsert_ocid_canonical_registry()` (standardized schema, PR #63/#64)
- [ ] Commit + push fix, open PR
- [ ] Document precisely which authenticated-flow testing still requires the Owner to
      personally log in (never typing a password ourselves)
- [ ] Final honest completion report
