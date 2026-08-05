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
- [x] Independently spot-checked PR #965's fix by reading its real diff (commit `cf7c6d9f`) --
      confirmed real, mirrors `/login`'s proven pattern exactly; not re-derived or re-fixed here
- [x] Real curl sweep of 16 live, unauthenticated `projexa-ai.com` paths -- status, redirect
      chain, `<title>` extraction for each (full table in the evidence doc below)
- [x] Real WebFetch content-extraction cross-check on `/pricing` (pre-fix) and `/login`
      (already-fixed control case) -- independently confirms the curl-derived finding
- [x] Root-cause read of every other public page found: `/contact`, `/terms`, `/privacy`,
      `/join-us`, `/data-policy` (real shared umbrella-company pages, correctly VERIDIAN-branded,
      NOT a bug) and `/forge`, `/office`, `/the-firm` (real distinct product lines, correctly
      self-branded, NOT a bug) -- confirmed via source reads, not assumed
- [x] Real, NEW root-cause gap found (not covered by PR #965): `/pricing` had zero per-route
      metadata (inherited the generic root-layout title `"VERIDIAN COGNITIVE AI OS..."`) and a
      hardcoded `"VERIDIAN AI"` nav wordmark, despite every CTA on the page linking straight into
      `/signup` -- same `GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH` class as `/login`/`/signup`
- [x] Fixed `/pricing`: split into async Server Component (`page.tsx`, `generateMetadata()` +
      `resolvePreAuthBrandByHost()`) + new `pricing-content.tsx` client component taking `brand`
      as a prop, mirroring the already-proven `/login`/`/signup` pattern exactly, zero new pattern
      invented. `null` brand renders byte-identical to before this change.
- [x] Independently verified the fix: `bunx tsc --noEmit` across the entire project -- **0
      errors** (ran clean post-`bun install`); `eslint` on both touched files -- **0
      errors/warnings**; `git grep -n "PricingPage"` -- confirms no stale reference remains. A
      full `bun run build` was attempted but hit this sandbox's own 300s timeout (disclosed
      honestly, not a defect in the change) -- not retried a second time, per this task's own
      circuit-breaker discipline (stop after one clean non-error timeout rather than repeat it).
- [x] Wrote `ai-os/VERIDIAN_OCID_020_CURL_WEBFETCH_SWEEP_2026-08-05.md` -- full real evidence
      (curl table, WebFetch extracts, root-cause reads, fix description, verification steps), and
      explicitly, non-silently records that real screenshot capture is outstanding in this session
      pending a screenshot-capable browser tool, per this task's own SPEC.
- [x] Added the required `ai-os/OS.yaml` `covers:` entry for the new evidence doc; validated both
      touched YAML files (`OS.yaml`, `ACTIVE-CLAIMS.yaml`) still parse clean.
- [x] Deliberately did NOT write to the live `ocid_canonical_registry` DB row for OCID-020 --
      the live sibling task's own remaining steps already include that deposit; a second
      concurrent writer to the same row would itself be the class of collision
      `ACTIVE-CLAIMS.yaml` exists to prevent. This document is this task's own durable evidence
      record instead.

## Remaining
- [ ] Commit + push, open PR
- [ ] Final honest completion report to the PM, citing this dispatch
