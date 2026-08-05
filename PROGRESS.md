# PROGRESS -- task-20260805-175253-pm-decision--proceed-with-curl-and-webfe

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS, CONSTITUTION pointers, AGENTS.md, CLAUDE.md)
- [x] Traced SPEC's two UMRs: `UMR-20260805-130213-d627` (real OCID-020 browser-testing
      dispatch) ran as task `task-20260805-173250-real-comprehensive-end-to-end-browser-te`,
      real open PR #965 (root-caused + fixed `/signup` and `/mfa-challenge` per-host
      brand/metadata mismatch via curl + source read). `UMR-20260802-165606-4413` is OCID-020
      itself.
- [x] Registered ACTIVE-CLAIMS.yaml entry, explicitly noting overlap with the live sibling
      task/PR #965 to avoid duplicating its fix

## Remaining
- [ ] Independently spot-check PR #965's fix by reading its diff
- [ ] Real curl sweep of other public, unauthenticated projexa-ai.com pages not covered by PR #965
- [ ] Real WebFetch evidence (extracted content) for key pages
- [ ] Search for the same brand-mismatch pattern class on any other public pre-auth route
- [ ] Write OCID-020 curl/WebFetch evidence doc, explicitly recording the screenshot-capture gap
- [ ] Fix any newly-found real root-cause gaps (independently retest)
- [ ] Commit + push, open PR
- [ ] Final honest completion report
