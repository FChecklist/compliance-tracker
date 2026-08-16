// Phase 3 (Phase3_Design_by_Claude.md, graph store decision). Generic,
// typed, directional edges between any two entities in the system --
// substrate for every "Enterprise * Graph" proposal in both VERIDIAN.docx
// studies (Enterprise Cognitive Graph, Capability Graph, Compliance
// Dependency Graph, etc.), none of which had a shared table to build on
// before this. Deliberately NOT wired into any production call site yet --
// see the design doc for why forcing a contrived consumer now would be
// worse than shipping a real, tested, unused foundation.
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { entityRelationships } from "@/lib/db"
import { and, eq, or } from "drizzle-orm"

export type EntityRef = { entityType: string; entityId: string }

export type CreateRelationshipInput = {
  sourceType: string
  sourceId: string
  targetType: string
  targetId: string
  relationshipType: string
  metadata?: Record<string, unknown> | null
}

export async function createRelationship(ctx: { orgId: string; userId: string }, input: CreateRelationshipInput) {
  return withTenantContext(ctx, (db) =>
    db.insert(entityRelationships).values({
      orgId: ctx.orgId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      targetType: input.targetType,
      targetId: input.targetId,
      relationshipType: input.relationshipType,
      metadata: input.metadata ?? null,
    }).returning()
  )
}

export async function deleteRelationship(ctx: { orgId: string; userId: string }, id: string) {
  return withTenantContext(ctx, (db) =>
    db.delete(entityRelationships).where(eq(entityRelationships.id, id)).returning()
  )
}

export async function getOutgoing(ctx: { orgId: string; userId: string }, source: EntityRef) {
  return withTenantContext(ctx, (db) =>
    db.query.entityRelationships.findMany({
      where: and(eq(entityRelationships.sourceType, source.entityType), eq(entityRelationships.sourceId, source.entityId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

export async function getIncoming(ctx: { orgId: string; userId: string }, target: EntityRef) {
  return withTenantContext(ctx, (db) =>
    db.query.entityRelationships.findMany({
      where: and(eq(entityRelationships.targetType, target.entityType), eq(entityRelationships.targetId, target.entityId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

// Merges both directions for one entity -- e.g. "everything connected to
// this worker agent, regardless of which side of the edge it's on".
export async function getNeighbors(ctx: { orgId: string; userId: string }, entity: EntityRef) {
  return withTenantContext(ctx, (db) =>
    db.query.entityRelationships.findMany({
      where: or(
        and(eq(entityRelationships.sourceType, entity.entityType), eq(entityRelationships.sourceId, entity.entityId)),
        and(eq(entityRelationships.targetType, entity.entityType), eq(entityRelationships.targetId, entity.entityId))
      ),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}
