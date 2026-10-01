# DPDP use-case test pass -- report (2026-10-02)

Branch `test/dpdp-usecases`, from origin/main `5bdbe269` (Razorpay + reminder lifecycle, #2026). The catalogue is `dpdp-app/USE-CASES.md` (about 130 rows, A to L). Nothing was written to the live database that persists: every live rehearsal ran in one transaction that ended in a deliberate error, and a follow-up query confirmed zero leftover rows. No real e-mail, no Razorpay call, no DNS, no Vercel, no DDL, no Edge-function deploy.

## Counts

| Suite | Result |
|---|---|
| `dpdp-app` `bun test` | 392 tests, 23 files: 392 pass, 0 fail (first run: 383 tests, 1 fail, see B-1) |
| Root `bun test --isolate` on all 58 dpdp files (`src/lib/services/dpdp-*.test.ts` + 3 under `src/app/api/dpdp/`) | 1760 tests: 1649 pass, 111 skip, 0 fail (first run: 1561 tests, 2 fail, see "flaky") |
| New tests written (all falsified by a temporary break, then reverted) | 56 pglite (sales lifecycle) + 14 pglite (payment claim) + 64 unit (billing-mail adversarial) + 6 scan (access never locks) + 5 (db-time) + 4 (csv) = 149 |
| `tsc --noEmit` (dpdp-app), eslint on touched files, `generate-public-facts --check` | clean / clean / OK (11 surfaces) |
| Build checkers on a fresh `vite build` | public-surface 1769 checks OK, claims 0 banned words in 1685 sentences OK, two-doors 441 checks OK, crawler 63 probes no 403 |
| `live-smoke` | apex 70/70; dpdp. host 69/70 then 70/70 on rerun |
| Live rolled-back rehearsals | partner lifecycle 103 PASS, 0 FAIL, 0 SKIP; reminder windows at 11 instants, claim/mark, unsubscribe, state, limits: all as designed; sign-up with hostile names, codes, limits: all as designed |

The 111 skips are the live-database integration tests (`dpdp-editions-roles`, `dpdp-cross-tenant-rpc`, `dpdp-obligation-rls` and similar). They need `DATABASE_URL` and they write rows, so they were deliberately not run. Playwright e2e (126 checks) was not run: 416 MB of free RAM, the repo's own README says more than 2 GB.

**Flaky vs real.** The two first-run root failures (`dpdp-mail-outbound` 30 s, `dpdp-operator-digest-migration` 5 s) are slow-disk timeouts: both read the 510-file `drizzle/` folder, and both pass alone in 15 s and in the full rerun. Not defects.

## Bugs found

| # | Severity | What | Root cause | Status |
|---|---|---|---|---|
| B-1 | Low | `brand-line.test.ts` "no variant spelling anywhere" timed out (91 s) once `node_modules` exists | `scripts/check-two-doors.mjs` `walk()` descended into `node_modules` and filtered afterwards | Fixed (skip heavy dirs while walking) and the test got a 60 s timeout |
| B-2 | Medium (cosmetic, no lock) | The trial countdown and "Confirmed on / Declared at" dates were shifted by the viewer's UTC offset: 5.5 h early for IST users, hours late elsewhere | `dpdp_my_billing` and `dpdp_owner_pending_claims` return `timestamp` columns with no zone (`2026-10-29T08:38:15.97`, confirmed against the live payload) and the screens used `new Date()`, which reads that as local time | Fixed client-side with `parseDbTimestamp` (`dpdp-app/src/lib/db-time.ts`), tested under 4 time zones. Better still, server side: return `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` like every other RPC (needs a migration, not done) |
| B-3 | Low | An organisation name containing a line break flowed into the e-mail Subject | Names are stored verbatim (the sign-up RPC only trims) | Fixed (`oneLine` in `supabase/functions/_shared/billing-mail.ts`). Needs the Edge functions `dpdp-pay` and `dpdp-lifecycle-email` redeployed to take effect; I did not deploy |
| O-1 | Low | Unknown URLs (`/nope-xyz/`, `/legal/`) return 200 with the home page | Cloudflare Pages SPA fallback, no `404.html` | Open. Fix: add a branded `public/404.html` (tokens live in the URL fragment, so no deep link depends on the fallback); needs the public-surface checker to learn the page |
| O-2 | Low | A reminder can be sent twice if Resend accepts it but the "mark sent" RPC then fails: the claim goes stale after 30 minutes and the next daily run resends | `dpdp-lifecycle-email/index.ts` ignores the error returned by `dpdp_sales_reminder_mark` | Open. Fix: check `error`, retry the mark 3 times, and send Resend's `Idempotency-Key: orgId:reminderKey` |
| O-3 | Medium, intermittent | Latency tail on the live Edge functions: a plain 401 took 21 s (`dpdp-partner-email`, `dpdp-lifecycle-email`), one `/ai/` probe timed out 3 x 20 s, one `dpdp-partner-mail` cron run failed "job startup timeout" at 19:30 UTC | Consistent with the known DB overload; repeats were 0.5 to 1 s. No code cause found | Open, monitor. The reminder design (3-day windows) absorbs a missed run |
| O-4 | Low | Rejecting a claim from an org that was already active sends it back to `trial` with an old trial date ("Payment pending") and stops its renewal reminders | `dpdp_owner_reject_payment` always writes `trial` | Open. Fix: restore the prior state (`active` if a confirmed payment exists) |
| O-5 | Cosmetic | Approving a claim for an org with no edition shows a raw `null value in column plan` error | `NULL not in (...)` is not true, so the friendly check never fires; nothing is booked | Open |

## Observations (not defects)

- Online payment is not switched on live (503 `not_enabled` on both endpoints, as designed). `dpdp-sales-lifecycle` has not run live yet (first slot 04:00 UTC 2026-10-02); `dpdp.sales_reminder_sent` is empty.
- No reminder is sent after the renewal date passes unpaid (by the owner's "never lock" rule); the in-app panel is the only nudge.
- Sign-in is a magic link only, so there is no password-reset case.

## Untested, and why

Real e-mail delivery, Resend limits, Supabase auth SMTP switch-over, Search Console, real Razorpay payment, refunds (no refund code exists), true parallel-transaction races (PGlite is single-connection; protection is the row lock plus unique indexes, each tested sequentially), the 111 live-DB tests, Playwright e2e, the worker `workers/dpdp-inbound-mail` own tests (needs its own install).
