# PROGRESS -- REVIEW-FRAMEWORK-WAVE4 Track 1b item 1: live exchange-rate feed

Task: build a live exchange-rate feed. Following the prior-session-validated plan
precisely (registered as a claim, never implemented). Hardcoded-currency UI bugs
(the other half of the finding) are already closed by merged PR #370 -- not touched.

## Completed
- [x] Read governance docs + registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml
- [x] Studied existing patterns: whisper-client.ts (mockable HTTP client),
      erp-accounting-service.ts exchange-rate area, exchange-rates API routes,
      internal /run cron routes (isAuthorized/CRON_SECRET), vercel.json crons,
      erp_exchange_rates schema
- [x] 1. src/lib/exchange-rate-feed-client.ts -- DB-free open.er-api.com client
- [x] 1b. src/lib/exchange-rate-feed-client.test.ts -- mocked-fetch unit tests
- [x] 2. erp-accounting-service.ts: refreshLiveExchangeRates(ctx) +
      refreshLiveExchangeRatesForAllOrgs() (shared refreshOrgLiveRates core,
      idempotent per org+rateDate on source='live' rows)
- [x] 3. erp_exchange_rates.source column: schema.ts + additive migration
      0224_erp_exchange_rates_source.sql (confirmed no collision -- it was
      already the latest migration number when checked)
- [x] 4. POST /api/erp/exchange-rates/refresh (requireAuth-gated)
- [x] 5. /api/internal/exchange-rate-refresh/run (CRON_SECRET-gated, same
      isAuthorized() pattern as metric-alerts/run etc.)
- [x] 6. vercel.json: one once-daily cron line (30 9 * * *)

- [x] Verify: `tsc --noEmit` -- 0 errors. `bun run lint` -- 0 errors, 3
      pre-existing warnings in unrelated files (litigation route, data-table,
      VeriComposer), none introduced by this change. `bun test` -- **1388
      pass, 0 fail**, 2720 expect() calls across 102 files (includes the new
      exchange-rate-feed-client.test.ts: 11 pass, 0 fail, 21 expect() calls).
      Console noise during the full run (APP_RUNTIME_DATABASE_URL warnings,
      "boom"/"db unreachable" errors) is expected fail-closed logging from
      pre-existing unrelated tests exercising their own error paths, not
      failures.

## Remaining
- [ ] None -- task complete. Not yet committed/pushed/PR'd (repo has no
      human reviewer bottleneck, but Rule 6 still requires a branch + PR +
      green CI before merge to main; this session has not opened that PR).
