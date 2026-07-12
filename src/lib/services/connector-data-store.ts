// GAP-CONNECTOR-DATA / GAP-CONNECTOR-DIGITAL-TWIN (D26.B2.S1 / D26.B4.S1).
// Every DB-touching operation connector-data-service.ts needs, isolated in
// its own module for the same reason asset-routing-engine.ts splits out
// asset-query-service.ts: connector-data-service.ts's real logic (talking to
// Composio, normalizing responses) can then be tested with this whole file
// mock.module()'d out, matching this codebase's established discipline of
// never touching withTenantContext/a live DB from a .test.ts file (see
// approval-workflow-service.test.ts's own note on this).
import { and, eq } from "drizzle-orm"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { connectorAccounts, connectorDocuments } from "@/lib/db"
import { ServiceError } from "./compliance-service"
import { classifyBusinessObjectType, type BusinessObjectType } from "@/lib/business-object-classifier"
import { createRelationship } from "./entity-graph-service"
import type { ConnectorToolkit } from "@/lib/composio-connectors"

export type ConnectorContext = { orgId: string; userId: string }

/**
 * Looks up the caller's own connector_accounts row for this toolkit and
 * confirms it's actually ACTIVE (not just attempted). Throws a real
 * ServiceError -- not a crash -- when the org/user hasn't connected this
 * toolkit at all, or the connection exists but never completed OAuth
 * successfully (INITIALIZING/FAILED/EXPIRED). Callers (API routes) turn this
 * into a 400 with a clear, actionable message.
 */
export async function getActiveConnectorAccount(ctx: ConnectorContext, toolkit: ConnectorToolkit) {
  const row = await withTenantContext(ctx, (db) =>
    db.query.connectorAccounts.findFirst({
      where: and(eq(connectorAccounts.userId, ctx.userId), eq(connectorAccounts.toolkitSlug, toolkit)),
    })
  )

  if (!row) {
    throw new ServiceError(
      `No ${toolkit} connection found for this user -- connect it first via POST /api/connectors { toolkit: "${toolkit}" }.`,
      400
    )
  }
  if (row.status !== "ACTIVE") {
    throw new ServiceError(
      `${toolkit} connection exists but is not ACTIVE (status: ${row.status}). Finish the OAuth flow, or POST /api/connectors/${toolkit}/sync to refresh status.`,
      400
    )
  }
  return row
}

export type ConnectorDocumentInput = {
  toolkitSlug: ConnectorToolkit
  externalId: string
  title: string | null
  sourceUrl: string | null
  ownerId: string | null
  lastModifiedAt: Date | null
  metadata: Record<string, unknown>
}

/**
 * Upserts the canonical Business Digital Twin row for one source item
 * (D26.B4.S1), then writes the 2 entity_relationships edges this row
 * participates in -- the first real production consumer of entity-graph-
 * service.ts's createRelationship() (see that file's own header: previously
 * "deliberately NOT wired into any production call site yet"). Edge writing
 * is best-effort: a graph-write failure must never fail the underlying data
 * pull the caller actually asked for, so it's caught and logged, not
 * propagated -- same posture as automation-rule-service.ts's fire-and-forget
 * enrichment calls elsewhere in this codebase.
 */
export async function upsertConnectorDocument(ctx: ConnectorContext, connectorAccountId: string, input: ConnectorDocumentInput) {
  const businessObjectType: BusinessObjectType = classifyBusinessObjectType({ toolkit: input.toolkitSlug })

  const [saved] = await withTenantContext(ctx, (db) =>
    db
      .insert(connectorDocuments)
      .values({
        orgId: ctx.orgId,
        userId: ctx.userId,
        toolkitSlug: input.toolkitSlug,
        businessObjectType,
        externalId: input.externalId,
        title: input.title,
        sourceUrl: input.sourceUrl,
        ownerId: input.ownerId,
        lastModifiedAt: input.lastModifiedAt,
        metadata: input.metadata,
      })
      .onConflictDoUpdate({
        target: [connectorDocuments.orgId, connectorDocuments.toolkitSlug, connectorDocuments.externalId],
        set: {
          title: input.title,
          sourceUrl: input.sourceUrl,
          ownerId: input.ownerId,
          lastModifiedAt: input.lastModifiedAt,
          metadata: input.metadata,
          updatedAt: new Date(),
        },
      })
      .returning()
  )

  if (!saved) return null

  try {
    await createRelationship(ctx, {
      sourceType: "connector_document",
      sourceId: saved.id,
      targetType: "organization",
      targetId: ctx.orgId,
      relationshipType: "owned_by",
    })
    await createRelationship(ctx, {
      sourceType: "connector_document",
      sourceId: saved.id,
      targetType: "connector_account",
      targetId: connectorAccountId,
      relationshipType: "sourced_from",
    })
  } catch (err) {
    console.error(`connector-data-store: failed to write entity_relationships edges for connector_document ${saved.id}:`, err)
  }

  return saved
}
