// Priority 3 UMR dispatch (agent 3, relationship-graph wiring). Pure helper
// extracted out of asset-relationship-service.ts specifically so it can be
// unit-tested with zero dependency on platform_assets/entity_relationships
// (both live in @/lib/db, which this file deliberately does not import) --
// see asset-relationship-service.ts's own header for why that decoupling
// mattered during this build (subagent/umr-core, the schema owner, was
// still in flight while this file was written).
//
// Used by linkAssetDependency() to maintain platformAssets.dependencies (a
// denormalized jsonb string[] of assetIds) as a fast-path cache alongside
// the real entity_relationships graph edge -- see that function's own
// comment for the full "why both representations" rationale.

/**
 * Appends `newDependency` to `existing` unless it's already present.
 * Idempotent: calling linkAssetDependency() twice for the same pair must
 * not grow the array or create a visible duplicate, even though the
 * underlying graph edge (entity_relationships) has no uniqueness
 * constraint of its own and a second createRelationship() call there will
 * still insert a second row -- see that function's own comment for why
 * that asymmetry is acceptable (the array is a read-fast cache, not the
 * source of truth; the edge count is not what callers of dependencies read
 * for).
 */
export function mergeDependency(existing: string[], newDependency: string): string[] {
  if (existing.includes(newDependency)) return existing
  return [...existing, newDependency]
}
