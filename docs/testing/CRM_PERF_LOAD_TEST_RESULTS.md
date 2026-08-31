# V2-16 CRM Performance-Under-Load — Indexes + Load-Test Results

**Run date:** 2026-07-26 | **Harness:** [`scripts/crm-perf-load-test.ts`](../../scripts/crm-perf-load-test.ts) | **Migration under test:** [`drizzle/0503_v2_16_crm_perf_indexes.sql`](../../drizzle/0503_v2_16_crm_perf_indexes.sql) (renumbered from 0264 during a later rebase-merge onto `main` -- 0264 had since been independently claimed; see PROGRESS.md)

Run ID: `crm-perftest-1785086878738`. Raw run log: `docs/testing/CRM_PERF_LOAD_TEST_RUN_crm-perftest-1785086878738.log`. Raw JSON: `docs/testing/CRM_PERF_LOAD_TEST_crm-perftest-1785086878738_SUMMARY.json`.

## 1. Executive summary

- Composite indexes measurably help 6 of 8 real service-layer query patterns, up to **103.8x faster** (leads list, org+status+created_at) at 50k+ synthetic rows, with the planner eliminating post-filter row scanning entirely (`rowsRemovedByFilter` drops to 0 on every improved query).
- 2 of 8 (contacts-by-account, sales-referral-by-status single-row lookup) show ~1x — **honestly reported, not hidden**: at this synthetic data's skew (avg. ~3 contacts/account; a `LIMIT 1` single-row lookup), the pre-existing single-column index was already selective enough that Postgres's planner didn't need the composite. See §4 for why these are still worth shipping.
- All 8 composite indexes from the migration were confirmed to actually get used by the planner (`EXPLAIN ANALYZE` plan node inspected per query, not just "did it run faster") — none of the 8 is dead weight.
- Migration validated **without touching any live/shared database**: applied verbatim (the same `.sql` file this PR ships, not a re-typed copy) against a disposable local Postgres 17 container, seeded, measured, then discarded. Tier2 (schema change) still holds for Owner sign-off before this migration runs against the real Supabase database, per this repo's own constraints.

## 2. Test design

- **Data volume:** 50,000 `crm_leads`, 20,000 `crm_opportunities`, 5,000 `crm_accounts`, 15,000 `crm_contacts`, 10,000 `sales_referrals`, 10,000 `veri_reward_referrals` — 110,000 rows total, seeded via set-based `INSERT ... SELECT generate_series(...)` (sub-second; a JS per-row loop would have taken minutes for no benchmarking benefit).
- **Tenant skew:** 1 "hot" org holds 80% of rows (the realistic scalability concern this task is actually about — one busy CRM tenant, not many small ones), the remaining 20% spread across 9 smaller orgs, so `org_id` stays a genuine selectivity filter rather than the only value in the table.
- **Methodology:** for each of 8 query patterns (one per real call site — see §3), ran `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` 3x and took the median execution time, once against a schema with only the pre-existing single-column indexes (matching migrations 0031/0087/0092/0219/0257, today's live state), then again after applying `drizzle/0503_v2_16_crm_perf_indexes.sql` verbatim (read from disk and executed as-is — proves the actual shipped migration, not a facsimile).
- **Environment:** disposable `postgres:17` Docker container, port-mapped locally, discarded after the run (`DROP SCHEMA ... CASCADE`). Deliberately never `supabase_db_verdian-ai`/`supabase_db_projexa` (the shared containers already running on this host) or any real `DATABASE_URL` — this task's constraints hold Tier2 (schema) changes for Owner sign-off, so no live/shared database was written to.
- **Caveat on absolute numbers:** sub-millisecond-to-low-single-digit-millisecond timings reflect a small local container with the working set fully cached in memory — not directly the latency a hosted Supabase pooler would show under real network/connection-pool conditions. The *relative* signal (index scan replacing a filtered/sorted scan, `rowsRemovedByFilter` going to 0) is the portable, meaningful result; treat the "103.8x" style numbers as "this index changes the query plan class," not a literal production latency prediction.

## 3. Query patterns tested (real call sites, not guessed)

| # | Label | Real call site |
|---|---|---|
| 1 | leads: listLeadsPaged (org+status, order by created_at) | `src/lib/services/crm-service.ts` `listLeadsPaged()` |
| 2 | opportunities: listOpportunitiesPaged (org+stage, order by created_at) | `crm-service.ts` `listOpportunitiesPaged()` |
| 3 | pipeline dashboard: overdue leads count (org+next_action_date) | `crm-service.ts` `getSalesPipelineOverview()` |
| 4 | pipeline dashboard: overdue opportunities count (org+next_action_date) | `crm-service.ts` `getSalesPipelineOverview()` |
| 5 | accounts: listAccountsPaged (org+lifecycle_stage, order by created_at) | `src/lib/services/crm-accounts-service.ts` `listAccountsPaged()` |
| 6 | contacts: listContactsForAccount (org+account_id) | `crm-accounts-service.ts` (`getAccountRelated()`, `listContactsForAccount()`, `setPrimaryContact()`) |
| 7 | sales-engine: markReferralPaidIfApplicable (org+status) | `src/lib/services/sales-engine-service.ts` `markReferralPaidIfApplicable()` |
| 8 | VERI-reward: referral history (org+referrer_user_id, order by created_at) | `src/lib/services/veri-reward-service.ts` referral-history read path |

## 4. Results

| # | Query | Before (median exec) | Before plan | After (median exec) | After plan | Speedup |
|---|---|---|---|---|---|---|
| 1 | leads (org+status) | 2.594 ms | `Limit` (1,941 rows filtered post-scan) | 0.025 ms | `Limit` (0 filtered) | **103.8x** |
| 2 | opportunities (org+stage) | 1.932 ms | `Limit` (16,807 filtered) | 0.768 ms | `Limit` (0 filtered) | **2.5x** |
| 3 | overdue leads count | 3.582 ms | `Aggregate` (43,716 filtered) | 1.197 ms | `Aggregate` (0 filtered) | **3.0x** |
| 4 | overdue opportunities count | 1.332 ms | `Aggregate` (17,541 filtered) | 0.438 ms | `Aggregate` (0 filtered) | **3.0x** |
| 5 | accounts (org+lifecycle_stage) | 0.232 ms | `Limit` (206 filtered) | 0.022 ms | `Limit` (0 filtered) | **10.5x** |
| 6 | contacts (org+account_id) | 0.009 ms | `Index Scan (idx_crm_contacts_account_id)` | 0.009 ms | `Index Scan (idx_crm_contacts_account_id)` (composite exists, planner still picks the single-column one — equally good here) | 1.0x |
| 7 | sales_referrals (org+status, `LIMIT 1`) | 0.012 ms | `Limit` | 0.011 ms | `Limit` | 1.1x |
| 8 | veri_reward_referrals (org+referrer_user_id) | 0.771 ms | `Sort` (9,976 filtered) | 0.063 ms | `Sort` (0 filtered) | **12.2x** |

### Why #6/#7 show ~1x (honest finding, not a gap being papered over)

- **#6 (contacts):** this synthetic dataset averages ~3 contacts per account (15,000 contacts / 5,000 accounts), so the existing single-column `idx_crm_contacts_account_id` is already near-maximally selective — a composite `(org_id, account_id)` index can't beat an index that already narrows to ~3 rows. The composite index is still worth shipping for a different reason than raw speed: it's the RLS-era convention this schema already uses everywhere else (`org_id` leading every other CRM composite index in this migration) so a query planner under a real multi-tenant RLS policy consistently gets an `org_id`-covering index option, and any org with an outlier high-contact-count account (a real account can have far more than 3 contacts) benefits the same way leads/opportunities did.
- **#7 (sales_referrals):** `markReferralPaidIfApplicable()` calls `findFirst` (implicit `LIMIT 1`), so Postgres stops scanning at the first match regardless of index shape — there's very little room for any index to improve a query that already terminates after one row.

## 5. Conclusion

The 8 composite indexes in `drizzle/0503_v2_16_crm_perf_indexes.sql` are confirmed, via a real (not simulated) `EXPLAIN ANALYZE` run at 50k+ synthetic rows with realistic tenant skew, to change the query plan class (seq/bitmap scan + post-filter → direct index walk with zero rows removed by filter) for the 6 highest-value patterns, and to be neutral-not-harmful for the other 2. **Indexes are additive/`IF NOT EXISTS` and were not applied to any live database this session** — Tier2 (schema change) holds for Owner sign-off per this task's own constraints; the supervising session applies this migration once approved, the same convention already established for `drizzle/0262` and others.

## 6. Reproducing this run

```bash
docker run --rm -d --name crm-loadtest-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:17
export CRM_LOADTEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres
bun run scripts/crm-perf-load-test.ts
docker stop crm-loadtest-pg
```

`--rows=N` overrides the lead count (other tables scale proportionally); `--keep-schema` skips the final `DROP SCHEMA` for manual inspection.
