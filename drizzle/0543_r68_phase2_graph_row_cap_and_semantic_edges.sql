-- R68 (Institutional Memory Graph) Phase 2: graph layer. Owner decision
-- (2026-09-03, full authority granted except monetary spend): instance-
-- tier semantic edges live in platform.graph_edge with tier='instance',
-- reusing R67 Part B's already-proven graph_node/graph_edge/RLS/traversal
-- infrastructure rather than re-keying compliance.entity_relationships
-- (measured broken for this purpose: entity_relationships' unique index is
-- PAIR-keyed -- (org_id, source_type, source_id, target_type, target_id,
-- relationship_type), see src/lib/services/entity-graph-service.ts -- and
-- carries no platform-sentinel RLS branch) or building a parallel
-- union-view system.
--
-- Verified live against pcrjmlpuqsbocqfwoxod immediately before writing
-- this file: platform.graph_node has 607 rows / platform.graph_edge has
-- 944 (edge_type: references=867, instance_of=77), every row on BOTH
-- tables is tier='platform', org_id='__platform__' -- no instance-tier row
-- exists anywhere in either table yet, so every choice below is safe
-- against real data by construction (same posture drizzle/0541's own
-- header established for memory_records).
--
-- Four net-new items:
--   1. p_max_rows on all three traversal functions (this file, below)
--   2. Semantic edge_type vocabulary (COMMENT ON COLUMN, below -- schema/
--      vocabulary only, no UI, no bulk-populate job)
--   3. person_holds_role edge shape (attrs.held_from/held_to -- no SQL
--      change needed, graph_edge.attrs is already jsonb NOT NULL DEFAULT
--      '{}'::jsonb; documented in the same COMMENT as item 2)
--   4. Fresh per-hop tenant-isolation proof for tier='instance' rows --
--      run live via the Supabase MCP in a ROLLED-BACK transaction against
--      two real orgs (org_001, demo_org), NOT shipped as SQL in this
--      migration (there is nothing to migrate: RLS policies proven here
--      already exist unchanged since R67 Part B G4 -- this item re-proves
--      them for tier='instance', it does not alter them). See this PR's
--      description for the live proof output.
--
-- ============================================================
-- ITEM 1 -- p_max_rows on graph_descendants / graph_ancestors / graph_impact
-- ============================================================
--
-- R68's own study found this the one gap in an otherwise-proven traversal
-- layer: p_max_depth (already enforced, all three functions) bounds a very
-- DEEP graph but not a very WIDE (high-fanout) one -- a single node with
-- 50,000 children at depth 1 already exceeds any reasonable page size
-- before depth ever becomes the limiting factor. Default 500, matching
-- this codebase's own established row-cap convention (MAX_LIMIT in
-- src/lib/services/audit-search-service.ts, verified live in this repo
-- before choosing this number -- not invented for this migration).
--
-- CREATE OR REPLACE FUNCTION may add new trailing parameters as long as
-- they carry a DEFAULT (PostgreSQL docs, CREATE OR REPLACE FUNCTION) --
-- p_max_rows is added last, after the existing p_exclude_hubs/p_max_depth
-- parameters, so every existing positional call site (graph-impact-
-- service.ts's `platform.graph_impact(${qualifiedTable}, ${depth})`,
-- scripts/verify-graph-drift.mjs's graph_full_resync() -> the graph_build_*
-- functions, which do not call these three at all) keeps working
-- unchanged and simply inherits the new 500-row cap.
--
-- LIMIT is applied to the FINAL SELECT, after the recursive walk -- this
-- bounds every row this function can ever return to the caller, which is
-- the real, load-bearing guarantee (a wide-fanout node cannot hand back
-- more than p_max_rows rows regardless of how many edges actually exist).
-- platform.graph_impact() already had its own ORDER BY depth, node_key
-- (deterministic paging); descendants/ancestors do not reorder (same
-- output order as before this migration, only now bounded).
CREATE OR REPLACE FUNCTION platform.graph_descendants(p_start text, p_max_depth integer DEFAULT 3, p_exclude_hubs boolean DEFAULT true, p_max_rows integer DEFAULT 500)
 RETURNS TABLE(node_key text, depth integer, path text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'platform', 'compliance', 'pg_temp'
AS $function$
  WITH RECURSIVE walk AS (
    SELECT e.target_key AS node_key, 1 AS depth, ARRAY[e.source_key, e.target_key] AS path
    FROM platform.graph_edge e WHERE e.source_key = p_start
    UNION ALL
    SELECT e.target_key, w.depth + 1, w.path || e.target_key
    FROM walk w JOIN platform.graph_edge e ON e.source_key = w.node_key
    WHERE w.depth < p_max_depth
      AND NOT (e.target_key = ANY(w.path))
      AND (NOT p_exclude_hubs OR NOT EXISTS (SELECT 1 FROM platform.graph_hub_out h WHERE h.node_key = w.node_key))
  )
  SELECT node_key, depth, path FROM walk LIMIT p_max_rows;
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION platform.graph_ancestors(p_start text, p_max_depth integer DEFAULT 3, p_exclude_hubs boolean DEFAULT true, p_max_rows integer DEFAULT 500)
 RETURNS TABLE(node_key text, depth integer, path text[], via_role text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'platform', 'compliance', 'pg_temp'
AS $function$
  WITH RECURSIVE walk AS (
    SELECT e.source_key AS node_key, 1 AS depth,
           ARRAY[e.target_key, e.source_key] AS path, e.source_role AS via_role
    FROM platform.graph_edge e WHERE e.target_key = p_start
    UNION ALL
    SELECT e.source_key, w.depth + 1, w.path || e.source_key, e.source_role
    FROM walk w JOIN platform.graph_edge e ON e.target_key = w.node_key
    WHERE w.depth < p_max_depth
      AND NOT (e.source_key = ANY(w.path))
      AND (NOT p_exclude_hubs OR NOT EXISTS (SELECT 1 FROM platform.graph_hub_in h WHERE h.node_key = w.node_key))
  )
  SELECT node_key, depth, path, via_role FROM walk LIMIT p_max_rows;
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION platform.graph_impact(p_table text, p_max_depth integer DEFAULT 2, p_max_rows integer DEFAULT 500)
 RETURNS TABLE(dependent_table text, depth integer, via_column text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'platform', 'compliance', 'pg_temp'
AS $function$
  SELECT node_key, depth, via_role
  FROM platform.graph_ancestors('table:'||p_table, p_max_depth, true, p_max_rows)
  ORDER BY depth, node_key
  LIMIT p_max_rows;
$function$;
--> statement-breakpoint

-- ============================================================
-- ITEMS 2 + 3 -- semantic edge_type vocabulary (v1) + person_holds_role shape
-- ============================================================
--
-- graph_edge.edge_type carries NO CHECK constraint today (verified live:
-- pg_constraint has zero contype='c' rows against graph_edge; the one
-- enum-enforced column in this pair is graph_node.tier, via
-- graph_node_tier_ck) -- matching graph_node.node_type's own established
-- free-text-with-documented-vocabulary convention, not tier's closed-set
-- one. This migration follows the SAME precedent this schema already set
-- rather than introducing a new one: documented here (versioned) and in
-- src/lib/graph/edge-types.ts as TS constants, not DB-enforced.
COMMENT ON COLUMN platform.graph_edge.edge_type IS $vocab$Free-text edge-type vocabulary, versioned here (not DB-enforced -- see graph_node.node_type for the same convention; graph_node.tier is the one column in this pair that IS enum-enforced, via graph_node_tier_ck).

v1 -- existing, platform-tier, FK/catalog-derived (graph_build_fk_edges/graph_build_instance_of). Do not repurpose:
  references    FK-derived structural edge. constraint_name = the real FK constraint name.
  instance_of   asset_type node -> table node.

v1 -- net-new, R68 Phase 2 (IMG), instance-tier, semantic. SCHEMA/VOCABULARY ONLY: no UI, no bulk-populate job yet -- that is real product work for a later phase once IMG has actual decision/document content to link:
  person_holds_role        person node -> role node. attrs.held_from / attrs.held_to (ISO 8601 timestamps; held_to nullable = current holder) make "who held this role at time T" resolvable via the same effective_from/effective_to-style window predicate R68 Phase 1 established for compliance.memory_records (getMemoryRecordAsOf(), src/lib/services/memory-service.ts):
                              (attrs->>'held_from')::timestamptz <= T AND ((attrs->>'held_to') IS NULL OR (attrs->>'held_to')::timestamptz > T)
                            A person may hold the same role more than once (re-appointment/succession back to an earlier holder). graph_edge_uq is keyed on (org_id, source_key, target_key, edge_type, constraint_name) -- since source_key/target_key/edge_type are then IDENTICAL across those two tenures, constraint_name (not FK-specific despite the name -- this table's only per-edge-instance discriminator) MUST carry a distinguishing value for the second edge, e.g. the ISO held_from timestamp.
  role_made_decision        role node -> decision node.
  decision_cites_document   decision node -> document node.
  document_has_chunk        document node -> chunk node.
  supersedes                 X -> X (same node_type), full replacement-in-time.
  amends                     X -> X (same node_type), partial revision.
  contradicts                X -> X (same node_type), flagged conflict, NOT a replacement.

Deliberately NOT reusing "references": that string already means "FK-derived structural edge" across 867 existing platform-tier rows -- overloading it for semantic instance-tier edges would make every existing FK edge ambiguous with an unrelated new meaning.$vocab$;
