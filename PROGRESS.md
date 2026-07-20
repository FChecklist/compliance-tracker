# PROGRESS -- task-20260720-035005-superboss-v2-plan--sentry-dsn-startup-ch

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS, CONSTITUTION context, plan V2-10) + sentry config files
- [x] Checked ACTIVE-CLAIMS for collisions on sentry*/instrumentation* scope — none found
- [x] Registered V2-10 claim in ai-os/boss/ACTIVE-CLAIMS.yaml, committed + pushed on its own
- [x] Built startup check module `src/lib/sentry-dsn-check.ts` (pure, env+logger injected; `checkSentryDsnEnv` + `warnIfSentryDsnMissing`)
- [x] Wired check into `src/instrumentation.ts` `register()` hook (nodejs + edge runtimes; Sentry configs left read-only)
- [x] Wrote `src/lib/sentry-dsn-check.test.ts` — 8 bun:test assertions: warning fires when unset, silent when set, names only missing var, whitespace = missing, caller-supplied env honored
- [x] `bun test src/lib/sentry-dsn-check.test.ts` — 8 pass / 0 fail
- [x] `bun test` (full suite, after `bun install`) — 1822 pass / 0 fail
- [x] `bun run lint` — 0 errors (3 pre-existing warnings, unrelated files)
- [x] `bunx tsc --noEmit` — clean
- [x] Re-scored CSV row #10 / C1 in ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md (table row + V2-10 task heading)
- [x] Pushed code commit (5fb10ed9) to origin
- [x] Opened PR #497 with full body (Tier1, audit-protocol note)
- [x] Posted structured `AUDIT: PASS` verdict comment (8 fields) on PR #497; validated locally against `validateAuditProtocolFields` -> `{valid:true}`
- [x] Re-ran stale audit-check job (comment doesn't re-trigger the `pull_request`-triggered workflow)
- [x] Investigated E2E Tests `fail` on PR #497 — confirmed pre-existing: `Cannot find module 'playwright/test'` (playwright.config.ts env issue, same as V2-6 PR #491 precedent). Non-required check, unrelated to the server-side instrumentation.ts wiring (not exercised by the E2E runner). All 16 required checks green.
- [x] Merged PR #497 (squash, merge commit 16fab761) — Tier1, all required checks green
- [x] Moved ACTIVE-CLAIMS V2-10 entry from `active:` to `recently_completed:` (with merged_as + completed_at)

## Remaining
- [ ] Commit + push the ACTIVE-CLAIMS cleanup + PROGRESS.md update (this is a docs-only Tier1 follow-up to record the merge; will open as its own small PR per Rule 6)
