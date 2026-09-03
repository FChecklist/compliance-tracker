-- R68 Phase 2 follow-up to 0543. CREATE OR REPLACE FUNCTION does NOT
-- replace an existing function when a NEW parameter is added -- PostgreSQL
-- identifies a function by its full parameter TYPE list, so adding
-- p_max_rows in 0543 created a second, overloaded function alongside each
-- original 3-arg one (verified live immediately after applying 0543:
-- pg_proc showed two rows each for graph_descendants/graph_ancestors/
-- graph_impact).
--
-- Left in place, this is a real, live-breaking bug: any 2-3 positional-arg
-- call (e.g. src/lib/services/graph-impact-service.ts's
-- `platform.graph_impact(${qualifiedTable}, ${depth})`) becomes ambiguous
-- between the old and new overloads (both resolve via defaults), and
-- Postgres raises 42725 "function is not unique". Same class of fix this
-- codebase already has a precedent for
-- (priority6_drop_old_backfill_signature, applied 2026-07-12).
--
-- Drops only the OLD (pre-p_max_rows) signatures; the new 4/3-arg versions
-- 0543 created are untouched. Verified live after this migration:
-- `select * from platform.graph_impact('compliance.projects', 2)` resolves
-- unambiguously again and returns the same 78 real rows it did before 0543.
DROP FUNCTION IF EXISTS platform.graph_descendants(text, integer, boolean);
--> statement-breakpoint
DROP FUNCTION IF EXISTS platform.graph_ancestors(text, integer, boolean);
--> statement-breakpoint
DROP FUNCTION IF EXISTS platform.graph_impact(text, integer);
