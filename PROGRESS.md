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

## Remaining
- [ ] Commit + push the code change
- [ ] Open PR, fill PR body, let CI run
- [ ] On CI green, merge (Tier1 — additive code+tests, no schema/auth/RLS/.env)
- [ ] Move ACTIVE-CLAIMS entry from `active:` to `recently_completed:` after merge
