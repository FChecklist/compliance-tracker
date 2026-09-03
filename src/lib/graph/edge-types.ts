// R68 (Institutional Memory Graph) Phase 2, items 2+3. Mirrors the SAME
// versioned vocabulary documented on platform.graph_edge.edge_type via
// COMMENT ON COLUMN in drizzle/0543_r68_phase2_graph_row_cap_and_semantic_edges.sql
// -- edge_type has no CHECK constraint (matching graph_node.node_type's
// own established free-text-with-documented-vocabulary convention, see
// that migration's header), so this file is documentation + a typed
// convenience for future callers, not enforcement. Keep both copies in
// sync by hand; there is no single source of truth mechanism for this
// column today (same posture the migration itself documents).
//
// SCHEMA/VOCABULARY ONLY (R68 Phase 2) -- no UI and no bulk-populate job
// reads or writes these values yet. That is real product work for a later
// phase once IMG has actual decision/document content to link.

/** v1 platform-tier, FK/catalog-derived edge types. Do not repurpose --
 * "references" already means "FK-derived structural edge" across 867
 * existing rows (platform.graph_build_fk_edges()). */
export const GRAPH_EDGE_TYPES_PLATFORM_V1 = ["references", "instance_of"] as const

/** v1 net-new, R68 Phase 2, instance-tier, semantic edge types. */
export const GRAPH_EDGE_TYPES_INSTANCE_V1 = [
  "person_holds_role",
  "role_made_decision",
  "decision_cites_document",
  "document_has_chunk",
  "supersedes",
  "amends",
  "contradicts",
] as const

export type GraphEdgeTypePlatformV1 = (typeof GRAPH_EDGE_TYPES_PLATFORM_V1)[number]
export type GraphEdgeTypeInstanceV1 = (typeof GRAPH_EDGE_TYPES_INSTANCE_V1)[number]

/**
 * person_holds_role's attrs shape (platform.graph_edge.attrs, jsonb).
 * held_to null means "current holder" -- same nullable-open-interval shape
 * as compliance.memory_records.effective_to.
 */
export type PersonHoldsRoleAttrs = {
  held_from: string // ISO 8601
  held_to: string | null // ISO 8601, null = current holder
}

/**
 * Same effective_from/effective_to-style window predicate R68 Phase 1
 * established for compliance.memory_records (getMemoryRecordAsOf(),
 * src/lib/services/memory-service.ts:
 *   effective_from <= asOf AND (effective_to IS NULL OR effective_to > asOf)
 * ) -- applied here to a person_holds_role edge's held_from/held_to so
 * "who held this role at time T" resolves with the identical half-open-
 * interval semantics (held_to is the instant the tenure ENDED, exclusive)
 * used everywhere else in this codebase for temporal-validity windows.
 * Pure function, no DB access -- the live equivalent is the SQL predicate
 * documented on platform.graph_edge.edge_type (see this file's header).
 */
export function isRoleHeldAt(attrs: PersonHoldsRoleAttrs, asOf: Date): boolean {
  const from = new Date(attrs.held_from)
  if (asOf < from) return false
  if (attrs.held_to === null) return true
  return asOf < new Date(attrs.held_to)
}

/**
 * Distinguishes repeat tenures of the SAME person in the SAME role under
 * graph_edge_uq's (org_id, source_key, target_key, edge_type,
 * constraint_name) unique key -- see the migration header for why
 * constraint_name (not FK-specific despite its name) is this table's only
 * per-edge-instance discriminator. Deterministic and collision-free across
 * distinct held_from instants for one (person, role) pair, which is all
 * graph_edge_uq needs it to be.
 */
export function personHoldsRoleConstraintName(heldFrom: string): string {
  return `held_from:${new Date(heldFrom).toISOString()}`
}
