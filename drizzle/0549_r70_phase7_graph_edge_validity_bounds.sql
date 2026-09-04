-- R70 Phase 7 (P7-02): validity bounds on platform.graph_edge.
-- P1-05 proved platform.graph_edge has no temporal columns at all, so
-- person->role succession (e.g. held_from/held_to in an edge's own attrs
-- jsonb) cannot be expressed as a queryable interval -- only as opaque JSON.
--
-- Column names deliberately match compliance.memory_records' convention
-- (effective_from / effective_to / superseded_by_id), not a second
-- "valid_*" naming scheme (R70 P7-02 NOT clause). All four nullable, no
-- backfill of the existing 945 edges.

ALTER TABLE platform.graph_edge
  ADD COLUMN IF NOT EXISTS effective_from timestamptz,
  ADD COLUMN IF NOT EXISTS effective_to timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_id bigint REFERENCES platform.graph_edge(id),
  ADD COLUMN IF NOT EXISTS recorded_at timestamptz NOT NULL DEFAULT now();
