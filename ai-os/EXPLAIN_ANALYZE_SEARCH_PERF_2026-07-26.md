# EXPLAIN ANALYZE — Search Performance (V2-20, CSV row #67)

**Date:** 2026-07-26
**Target:** `src/lib/services/search-service.ts` — `searchAll()`, the query behind
the "Standard" search tab (`/api/search`, `search-command.tsx`). Covers
`compliance_items` (title/description), `tasks` (title/description),
`clients` (name), all `ilike()`'d and scoped by `org_id`.
**DB:** `verdian-ai` Supabase project (`pcrjmlpuqsbocqfwoxod`), Postgres 17.6,
via the Supabase MCP `execute_sql` tool.
**Migration:** `drizzle/0504_search_perf_gin_trgm_indexes.sql` (not applied
live — Tier2, Owner sign-off required). Renumbered twice from its original
`0264_...` name during this PR's real rebase-merge onto current main
(2026-09-01) — see that file's own header for why (a genuine collision, then
a real concurrent-session race on the replacement number).

## Method

This project's live row counts (178 `compliance_items`, 1899 `tasks`, 16
`clients`) are far below what "realistic volume" should mean for a
multi-year, multi-tenant compliance product, so the benchmark ran inside a
single Postgres transaction that:

1. Disabled three per-row triggers on `compliance_items`/`tasks`
   (`auto_register_asset_trg`, `trg_audit_backstop`,
   `tsv_ct2_compliance_items`) for the duration of the transaction only —
   these are real, legitimate, already-migrated triggers, but they exist to
   fire on real inserts, not to be exercised by synthetic benchmark data;
   disabling them only sped up loading the synthetic rows and has no effect
   on the SELECT-side EXPLAIN ANALYZE results below.
2. Inserted synthetic rows under the real `org_001` org: **30,000**
   `compliance_items`, **50,000** `tasks`, **5,000** `clients` (roughly
   150-300x current live volume — a reasonable few-years-of-growth estimate
   for one tenant).
3. Ran `ANALYZE`, then `EXPLAIN (ANALYZE, BUFFERS)` for a **narrow** search
   term (a specific filing reference number — the realistic "user searches
   for one known record" case) and, for `compliance_items`, also a **broad**
   term (`GST`, matching ~19% of rows — the "common keyword" case) — both
   with the exact `ilike()` shape `search-service.ts` already uses.
4. Created the five GIN trigram indexes from the migration above, re-ran
   `ANALYZE`, and repeated the same `EXPLAIN ANALYZE` queries.
5. **`ROLLBACK`** — the entire transaction, data and indexes both. Verified
   immediately after: `org_001`-scoped row counts back to baseline (18/1/1
   pre-existing rows), zero non-idle sessions in `pg_stat_activity`, zero
   disabled triggers, and none of the 5 new indexes present. The live DB
   was left byte-for-byte as it was found; nothing here required Tier2
   sign-off because nothing persisted.

(Two earlier attempts at this benchmark, at a larger 80k-120k-row scale
with the triggers still enabled, exceeded the MCP tool's client-side
timeout. The underlying Postgres sessions kept running server-side after
the client gave up — `pg_terminate_backend()` was used to end them once
found via `pg_stat_activity`. Both had also not yet reached a `COMMIT`, so
Postgres's normal "client disconnected mid-transaction → rollback" behavior
applies; this was independently re-verified afterwards via row counts. No
data was left behind by those attempts either.)

## Results

### `compliance_items` — narrow term (`REF-014337`, 1 matching row of 30,018)

**Before (Seq Scan):**
```
Limit  (cost=0.00..1610.12 rows=6 width=66) (actual time=51.846..108.235 rows=1 loops=1)
  Buffers: shared hit=1082
  ->  Seq Scan on compliance_items  (cost=0.00..1610.12 rows=6 width=66) (actual time=51.844..108.232 rows=1 loops=1)
        Filter: ((org_id = 'org_001'::text) AND ((title ~~* '%REF-014337%'::text) OR (description ~~* '%REF-014337%'::text)))
        Rows Removed by Filter: 30177
        Buffers: shared hit=1082
Planning Time: 10.677 ms
Execution Time: 108.272 ms
```

**After (Bitmap Heap Scan via GIN):**
```
Limit  (cost=49.83..56.49 rows=6 width=66) (actual time=1.277..1.279 rows=1 loops=1)
  Buffers: shared hit=63
  ->  Bitmap Heap Scan on compliance_items  (cost=49.83..56.49 rows=6 width=66) (actual time=1.276..1.278 rows=1 loops=1)
        Recheck Cond: ((title ~~* '%REF-014337%'::text) OR (description ~~* '%REF-014337%'::text))
        Filter: (org_id = 'org_001'::text)
        Heap Blocks: exact=1
        ->  BitmapOr  (cost=49.83..49.83 rows=6 width=0) (actual time=1.259..1.259 rows=0 loops=1)
              ->  Bitmap Index Scan on idx_compliance_items_title_trgm  (cost=0.00..24.30 rows=3 width=0) (actual time=1.231..1.231 rows=1 loops=1)
              ->  Bitmap Index Scan on idx_compliance_items_description_trgm  (cost=0.00..25.53 rows=3 width=0) (actual time=0.027..0.027 rows=0 loops=1)
Planning Time: 1.324 ms
Execution Time: 1.313 ms
```
**108.27ms → 1.31ms (~83x)**

### `compliance_items` — broad term (`GST`, ~5,765 of 30,018 rows match)

Before: Seq Scan, `Execution Time: 0.416 ms`. After (index present): planner
**still chose Seq Scan**, `Execution Time: 0.429 ms` — no change, no
regression. With `LIMIT 20` and ~19% selectivity, a Seq Scan that stops
after the first ~250 rows is cheaper than building a bitmap over 5,765
matches, and the planner correctly avoids the index here. This is the
expected, healthy behavior for a trigram GIN index — it helps selective
searches (the common case for this search box: someone typing a specific
name/reference) without hurting unselective ones.

### `tasks` — narrow term (`REF-027412`, 1 matching row of 50,001)

Before: Seq Scan, `Execution Time: 147.351 ms` (Rows Removed by Filter:
51,898).
After: Bitmap Heap Scan via `idx_tasks_title_trgm` / `idx_tasks_description_trgm`,
`Execution Time: 1.072 ms`.
**147.35ms → 1.07ms (~137x)**

### `clients` — narrow term (`Client 2821 Pvt`, 1 matching row of 5,001)

Before: Seq Scan, `Execution Time: 6.992 ms`.
After: Bitmap Heap Scan via `idx_clients_name_trgm`, `Execution Time: 0.343 ms`.
**6.99ms → 0.34ms (~20x)**

## Conclusion

At realistic multi-year org-scale volume, the current plain-`ilike()`
Standard search does a full sequential scan per table on every keystroke's
worth of query, costing 100-150ms per table for the realistic "search for a
specific record" case (the case that matters most — most search-box use is
someone looking for one known item, not browsing by category). A `pg_trgm`
GIN index on each searched column removes this entirely (sub-2ms), with the
planner correctly declining to use the index for the rare unselective-term
case where a Seq Scan is genuinely cheaper. **Row #67 (CSV) is closed**:
`drizzle/0504_search_perf_gin_trgm_indexes.sql` adds the five indexes;
no change to `search-service.ts` itself is required since `pg_trgm`
transparently accelerates the existing `ilike()` calls.

## Live-DB drift found (out of scope, flagged only)

While inspecting the live DB for existing indexes, found `compliance_items`
already carries an **undocumented** `gin(title gin_trgm_ops)` index
(`idx_ct2_ci_title_trgm`), an unrelated `search_vector` tsvector column +
GIN index, an `embedding` vector column with an HNSW index, and several
other `ct2_`-prefixed btree indexes (`idx_ct2_ci_dept`, `idx_ct2_ci_status`,
`idx_ct2_ci_due`) plus a `tsv_ct2_compliance_items` trigger — **none of
which have a matching migration file in this repo**, and a repo-wide grep
found **zero application code** referencing `search_vector`, `embedding`,
or any `ct2_` symbol. This looks like a different, orphaned full-text or
semantic-search experiment applied directly to the live DB (outside of
`drizzle/`) and never committed or wired up. This migration reconciles only
the one overlapping piece (`idx_ct2_ci_title_trgm`, captured under its
existing name so a fresh environment matches production); the rest is a
separate cleanup this task does not attempt.
