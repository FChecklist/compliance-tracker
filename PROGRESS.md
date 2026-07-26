# PROGRESS -- task-20260726-172004-search-performance-explain-analyze---gin
## Completed
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (no collision found — grepped for search-service/search-perf/V2-20/gin_trgm, none active).
- [x] Re-verified the gap is still real: `search-service.ts`'s `searchAll()` uses plain `ilike()` against `compliance_items.title/description`, `tasks.title/description`, `clients.name`, org-scoped. No GIN/trgm index existed for any of these in git, and (surprisingly) mostly not live either — see drift note below.
- [x] Ran real `EXPLAIN (ANALYZE, BUFFERS)` against the live `verdian-ai` Supabase DB (project `pcrjmlpuqsbocqfwoxod`) at realistic org-scale volume (30k `compliance_items` / 50k `tasks` / 5k `clients` under real org `org_001`, vs. this DB's actual live counts of 178/1899/16), both before and after adding `pg_trgm` GIN indexes. Full plans and methodology in `ai-os/EXPLAIN_ANALYZE_SEARCH_PERF_2026-07-26.md`.
  - All synthetic data and all 5 indexes were created and measured inside a single Postgres transaction, then explicitly `ROLLBACK`'d — verified afterwards via row counts, `pg_stat_activity`, and `pg_indexes` that the live DB was left completely unchanged.
  - Results: narrow/realistic search terms (a specific filing reference) went from **108-147ms Seq Scan** to **0.3-1.3ms Bitmap Heap Scan** (80-140x) across all three tables. A broad/unselective term ("GST", ~19% of rows) showed **no regression** — the planner correctly keeps using Seq Scan there.
- [x] Wrote `drizzle/0264_search_perf_gin_trgm_indexes.sql` — adds the 4 missing GIN trgm indexes (`compliance_items.description`, `tasks.title`, `tasks.description`, `clients.name`) plus captures one pre-existing but **undocumented** live index (`idx_ct2_ci_title_trgm` on `compliance_items.title`) under its existing name so a fresh environment matches production. **Not applied live** — Tier2 (migration + live DB) holds for Owner sign-off per this task's constraints.
- [x] No `search-service.ts` code change needed: `pg_trgm`'s opclass registers support for the `ILIKE` (`~~*`) operator directly, so the existing `ilike()` calls become index-eligible the moment the index exists — no query rewrite required.
## Live-DB drift found (flagged, not fixed — out of scope for V2-20)
While checking for existing indexes on `compliance_items`, found it already carries, live on the `verdian-ai` Supabase project, with **zero matching migration file in this repo**:
- `idx_ct2_ci_title_trgm` — a `gin(title gin_trgm_ops)` index (captured under its existing name in the new migration since it overlaps this task's scope)
- `search_vector` (tsvector column) + `idx_ct2_ci_search_vector` (GIN index) + `tsv_ct2_compliance_items` (trigger, function `tsv_update_ct2_compliance_items`)
- `embedding` (vector column) + `idx_ct2_ci_embedding_hnsw` (HNSW index)
- `idx_ct2_ci_dept`, `idx_ct2_ci_status`, `idx_ct2_ci_due` (plain btree indexes)
A repo-wide grep of `src/` found **no application code** referencing `search_vector`, `embedding`, or any `ct2_` symbol — this looks like a different, orphaned full-text/semantic-search experiment applied directly to the live DB outside of `drizzle/` and never committed or wired up. Not this task's objective to reconcile (V2-20 is specifically about `search-service.ts`'s plain-ilike path) — noting it here and in the EXPLAIN doc so it's visible for a future task rather than silently left as invisible drift.
## Remaining
- [ ] Owner sign-off + live `apply_migration` of `drizzle/0264_search_perf_gin_trgm_indexes.sql` (Tier2 hold — not done by this session).
- [ ] Open PR.
