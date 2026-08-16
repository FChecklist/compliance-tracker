import { clients, clientEntities } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

type RouteContext = { params: Promise<{ id: string }> } // id = clientId

export async function GET(_request: NextRequest, context: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ entities: [] })

  try {
    const { id } = await context.params
    const entities = await withTenantContext({ orgId }, async (db) => {
      // RLS-scoped join -- returns null (not just empty) if this client
      // belongs to another org.
      const client = await db.query.clients.findFirst({ where: eq(clients.id, id) })
      if (!client) return null
      return db.query.clientEntities.findMany({ where: eq(clientEntities.clientId, id) })
    })

    if (entities === null) return NextResponse.json({ error: "Client not found" }, { status: 404 })
    return NextResponse.json({
      entities: entities.map((e) => ({
        id: e.id, legalName: e.legalName, entityType: e.entityType,
        gstin: e.gstin, pan: e.pan, cin: e.cin, isActive: e.isActive,
      })),
    })
  } catch (error) {
    console.error("Client entities GET error:", error)
    return NextResponse.json({ error: "Failed to fetch entities" }, { status: 500 })
  }
}

// Adds another legal entity under an existing client -- the case a single
// "client" (a business group) has multiple legal entities (manufacturing
// arm, trading arm, etc.), each with its own GSTIN/PAN/CIN.
export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "branch_manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { legalName, entityType, gstin, pan, cin } = body
    if (!legalName || typeof legalName !== "string" || !legalName.trim()) {
      return NextResponse.json({ error: "legalName is required" }, { status: 400 })
    }

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const client = await db.query.clients.findFirst({ where: eq(clients.id, id) })
      if (!client) return null

      const [entity] = await db.insert(clientEntities).values({
        clientId: id,
        legalName: legalName.trim(),
        entityType: entityType?.trim() || null,
        gstin: gstin?.trim() || null,
        pan: pan?.trim() || null,
        cin: cin?.trim() || null,
      }).returning()

      await logActivity({
        tx: db,
        action: "create",
        entityType: "ClientEntity",
        entityId: entity.id,
        details: `Added legal entity "${entity.legalName}" under client "${client.name}"`,
        orgId,
        clientId: id,
        dbUser,
        request,
      })

      return entity
    })

    if (!result) return NextResponse.json({ error: "Client not found" }, { status: 404 })
    return NextResponse.json({ id: result.id, legalName: result.legalName }, { status: 201 })
  } catch (error) {
    console.error("Client entity create error:", error)
    return NextResponse.json({ error: "Failed to add entity" }, { status: 500 })
  }
}
