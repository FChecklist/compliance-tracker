# PROGRESS -- task-20260802-172443-amendment--end-to-end-end-user-certifica

Amendment to `UMR-20260802-104058-25ba` (canonical artifact:
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`). Real end-to-end end-user
certification pass on PROJEXA-AI.COM — live browser testing, not code review.

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain, ACTIVE-CLAIMS.yaml, canonical
      matrix (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, item 11: 22 real
      Playwright specs exist targeting live projexa-ai.com, never run as a
      full suite, no CI job).
- [x] Checked for prior/in-flight adversarial or E2E-certification work on
      PROJEXA-AI.COM specifically: found the 2026-07-19 5-phase spec-authoring
      program (closed, wrote the specs, did not run them as a full suite) and
      `ai-os/audits/projexa_erp_e2e_reaudit_2026-07-27.md` (source-code/test
      re-audit of 5 PRs, not a live browser end-user run). Neither is a
      duplicate of this directive's real live-browser certification ask.
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`.

- [x] **CRITICAL FINDING, real, reproduced multiple ways**: `https://projexa-ai.com`
      does **not** serve the PROJEXA application. It serves compliance-tracker's
      own admin app (`VERIDIAN AI` / "Sign in to your compliance dashboard"
      login page). Evidence: `curl -I https://projexa-ai.com/materials` → 404
      (a real PROJEXA-only route); login attempt with a real seeded PROJEXA
      E2E test account → Supabase `400 invalid_credentials` against
      `pcrjmlpuqsbocqfwoxod.supabase.co` (confirmed = compliance-tracker's own
      project, via `.env.local`), because that account only exists in
      PROJEXA's own separate Supabase project (`evpckeuxgvahguwsaeul`). The
      real, live, functioning PROJEXA app is reachable today only at
      `https://projexa-smoky.vercel.app` (the `projexa` Vercel project's
      fallback domain, per matrix item 12's own note) — real login there
      succeeds in ~4-5s with the documented seeded credentials. This
      contradicts the SPEC's premise that PROJEXA-AI.COM itself is the real
      product surface to certify — it currently is not.
- [x] Fixed 2 stale Playwright selectors in `e2e/auth.setup.ts` (product's
      login page gained Google/passcode/SSO options since the spec was
      written, making the old `/log in|sign in/i` regex ambiguous — a real,
      independent test-drift finding) so the real suite could run at all;
      re-pointed `PLAYWRIGHT_BASE_URL` at the real live app
      (`projexa-smoky.vercel.app`) since `projexa-ai.com` is the wrong app.
- [x] Ran the real 25-spec/107-test Playwright suite against the real live
      PROJEXA app with real seeded data (not mocked) — see matrix amendment
      for full pass/fail table and named gaps (permits date-range control,
      documents read-only-by-design assertion, procurement requisition
      persistence — flaky/failing across repeated real runs).
- [x] Manually verified (real browser, screenshots): dashboard renders real,
      non-placeholder data (18 real projects, real revenue/budget figures,
      real per-project task/delay counts); global search (⌘K) is real and
      functional but slow (`/api/search` observed taking >6s and up to ~30s
      to resolve on a cold path — a real, reproducible latency/UX gap, not a
      dead end); signup form renders correctly (full completion not verified
      — requires email verification, an honest limitation, not fabricated).
- [x] VERI Copilot: existing spec suite already documents (and re-confirmed
      live) a real gap — the AI hallucinates a nonexistent "DeleteProject"
      action when asked to delete a project, and Finance/Sales/HR users have
      zero structured chat-command coverage (Construction-only
      capability-tree), consistent with prior PHASE2_BATCH_C_FINDINGS.md.
- [ ] Multi-tenant cross-org leak testing: not independently re-verified in
      this pass — only one seeded PROJEXA org (Meridian Construction Group)
      exists in the real test fixtures, so a genuine cross-org leak test
      would require provisioning a second org (out of this testing-only
      pass's scope per the SPEC's own "do not build/duplicate" instruction).
      Relying on matrix item 8's existing RLS evidence for this angle.
- [ ] Amend `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` in place (item 11 and
      item 12, the domain-routing finding is the more urgent one now) with
      real findings, go-live verdict.
- [ ] Move ACTIVE-CLAIMS entry to `recently_completed`, commit+push final.
