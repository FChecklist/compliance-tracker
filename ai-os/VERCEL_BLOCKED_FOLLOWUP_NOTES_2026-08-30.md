# Vercel-blocked follow-up notes — 2026-08-30

Per owner directive: "vercel is blocked, use local, github, supabase... make notes so that once
vercel is up, whatever changes to be done there are done." This file is that list — re-check each
item once Vercel deployments resume, then delete the corresponding row (or the whole file once
empty).

## Why this file exists

As of 2026-08-30, Vercel deployment previews are failing/blocked platform-wide across both
compliance-tracker and projexa (`Deployment was blocked` / `Deployment has failed` on every open
PR's Vercel check, including PRs whose own code changes have nothing to do with deployment config).
Confirmed ambient, not code-caused: a PR from 2026-08-28 (#1442) shows a clean `Deployment has
completed` — something changed platform-side between then and now. All work this session verified
via local `tsc`/`eslint`/`bun test --isolate` + live Supabase queries instead of a live preview URL.

## Items needing a real Vercel-preview (or production) re-check once unblocked

1. **`e2e/demo-gate-smoke.spec.ts` real-production failure** (compliance-tracker CI, `E2E Tests`
   job) — `the minted session must resolve to a real org` / `GET /api/organization` not `.ok()`.
   This test hits real `projexa-ai.com`/production directly, not a preview URL, so its failure is
   independent of any single PR. Re-run once Vercel deployments resume and production is
   confirmed serving a fresh deploy again — if it still fails, that's a real, separate incident
   worth its own investigation (demo account state, RLS, or a genuine regression), not something
   to keep attributing to the Vercel block.

2. **R65 report-engine work — live UI verification not yet done.** Everything closed this pass
   (`GAP-MIGRATION-APPLY-NOT-AUTOMATED`'s new CI check, the Materials Running Low report wiring,
   and any further R65 report-gap closures landed after this note was written) was verified via
   `tsc`/`bun test`/live Supabase queries only. Specifically still needing a real click-through
   once Vercel is up:
   - Confirm `/reports` page's Excel/PDF/Word/PowerPoint/HTML export buttons (`reports/page.tsx`
     `exportExcel`/`exportPDF`/`exportPPTX`/`exportDocx`/`exportHTML`) actually produce a correct,
     openable file for a report with real data — this session confirmed the functions *exist* and
     are wired to buttons, not that each format's output is visually correct end-to-end.
   - Confirm the newly-wired **Materials Running Low** report renders sensibly in the reports UI
     once at least one org has a real `erp_reorder_levels` row (currently 0 rows for every org --
     see this report's own `data_gap_note`, still correctly `data_gap` not `built`).
   - Any other report_definitions row flipped from `data_gap`/`planned` to `built` in a later R65
     pass should get one real live-UI click-through here before being trusted as done, not just a
     passing `tsc`/local-query check.

3. **Migration Schema Drift Check (`migration-schema-drift-check` CI job, new this pass)** — has
   never actually run in a real GitHub Actions execution yet (only verified locally against
   production via direct SQL). First real CI run should be watched once a PR triggers it, to
   confirm the `DATABASE_URL` secret resolves correctly in that environment the same way
   `migration-integrity-check`'s sibling job already does.

## How to close this file out

When Vercel is confirmed unblocked (a real PR shows `Vercel: Deployment has completed` again),
work through the numbered items above one at a time, strike through or delete each as verified,
and delete this file entirely once nothing remains.
