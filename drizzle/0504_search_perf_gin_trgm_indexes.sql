-- V2-20 (Search performance EXPLAIN ANALYZE + GIN index, CSV row #67).
-- search-service.ts's searchAll() (the "Standard" search tab behind
-- /api/search) runs plain ilike() OR-across-columns queries against
-- compliance_items.title/description, tasks.title/description, and
-- clients.name, scoped by org_id. EXPLAIN ANALYZE at a realistic org-scale
-- volume (30k compliance_items / 50k tasks / 5k clients, vs. this DB's
-- current live counts of 178/1899/16) showed a plain Seq Scan for narrow,
-- realistic search terms (e.g. a specific filing reference number) taking
-- 108-147ms per table -- see
-- ai-os/EXPLAIN_ANALYZE_SEARCH_PERF_2026-07-26.md for the full before/after
-- plans. A pg_trgm GIN index drops the same query to ~0.3-1.3ms (Bitmap
-- Heap Scan via BitmapOr across the title/description trgm indexes) --
-- 80-140x. pg_trgm's opclass registers support for the ILIKE (~~*) operator
-- directly, so no query rewrite in search-service.ts is needed -- the
-- existing ilike() calls become index-eligible as soon as the index exists.
-- For broad/unselective terms (e.g. "GST", matching ~19% of rows) the
-- planner correctly keeps using a Seq Scan (cheaper than a huge bitmap for
-- a LIMIT query) -- confirmed no regression for that case either.
--
-- Live-DB drift note (found while writing this migration, out of scope to
-- fix here): compliance.compliance_items already has an UNDOCUMENTED
-- gin(title gin_trgm_ops) index live in the verdian-ai Supabase project
-- (idx_ct2_ci_title_trgm), plus an unrelated search_vector tsvector column,
-- an embedding vector column with an HNSW index, and several other
-- ct2_-prefixed indexes -- none of it has a matching migration file in this
-- repo, and no application code (grepped src/) references search_vector,
-- embedding, or any ct2_ symbol. This looks like a different, orphaned
-- full-text/semantic-search experiment applied directly to the live DB and
-- never committed. This migration captures the one piece that overlaps our
-- scope (the title trgm index) under its existing live name so a fresh
-- environment matches production, and does not touch the rest -- that
-- reconciliation is a separate task.
--
-- NOT applied live -- Tier2 (migration + live DB), supervisor/Owner holds
-- per this task's constraints. EXPLAIN ANALYZE above was run and rolled
-- back in a single transaction directly against the live DB via the
-- Supabase MCP (data + indexes inserted, measured, then ROLLBACK) -- zero
-- persisted footprint; verified via row counts and pg_stat_activity
-- immediately after.
--
-- Renumbered during the real rebase-merge of PR #582 onto current main
-- (2026-09-01), twice: originally 0264 -> 0503 (0264 had been taken by
-- 0264_helpdesk_tiered_sla_team_routing.sql); then 0503 -> 0504 after a
-- concurrent rebase-merge session (PR #576 -> #1514, "V2-16 CRM perf
-- indexes") independently claimed 0503 first and merged to main moments
-- before this PR's own merge attempt -- a real, documented race condition
-- this repo's own check-migration-collision.mjs header already calls out
-- as a known limitation of concurrent agents. Verified 0504 free via
-- `git ls-tree -r origin/main -- drizzle/` against the fresh post-#1514
-- main. No content change from the original migration otherwise.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- compliance_items.title: reconciles the undocumented live index above under
-- its existing name -- not a new index on a fresh apply of this file to
-- this DB, but ensures other environments (dev/staging/DR) get it too.
CREATE INDEX IF NOT EXISTS idx_ct2_ci_title_trgm ON compliance.compliance_items USING gin (title gin_trgm_ops);
-- compliance_items.description: the other half of searchAll()'s OR clause
-- for this table -- was entirely missing, on this DB and in git alike.
CREATE INDEX IF NOT EXISTS idx_compliance_items_description_trgm ON compliance.compliance_items USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm ON compliance.tasks USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tasks_description_trgm ON compliance.tasks USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clients_name_trgm ON compliance.clients USING gin (name gin_trgm_ops);
