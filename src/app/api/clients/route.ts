import { clients, organisations } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

// Lists every client this account serves. For a 'company' account this is
// always exactly the one auto-backfilled "Self" client; for a ca_firm/
// legal_firm/consultant account it's the actual client roster the whole
// hierarchy exists for.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ clients: [] })

  try {
    const rows = await withTenantContext({ orgId }, (db) =>
      db.query.clients.findMany({
        where: eq(clients.orgId, orgId),
        with: { entities: true },
        orderBy: asc(clients.name),
      })
    )
    return NextResponse.json({
      clients: rows.map((c) => ({
        id: c.id,
        name: c.name,
        isSelf: c.isSelf,
        isActive: c.isActive,
        entities: c.entities.map((e) => ({
          id: e.id,
          legalName: e.legalName,
          entityType: e.entityType,
          gstin: e.gstin,
          pan: e.pan,
          cin: e.cin,
        })),
        createdAt: c.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error("Clients list API error:", error)
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 })
  }
}

// Only meaningful for ca_firm/legal_firm/consultant accounts -- a 'company'
// account already has its one Self client from the Wave 7 backfill and has
// no reason to add another (the API doesn't hard-block it, since "a company
// later becomes a consultant too" isn't impossible, but the UI only shows
// this for non-company account types).
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "branch_manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const { name, legalName, entityType, gstin, pan, cin } = body
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Client name is required" }, { status: 400 })
    }

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
      if (!org) return null

      const [client] = await db.insert(clients).values({
        orgId,
        name: name.trim(),
        isSelf: false,
      }).returning()

      // A client is created with at least one client entity right away --
      // an empty client with no legal entity underneath it isn't useful,
      // and this matches the Self-client backfill pattern.
      const { clientEntities } = await import("@/lib/db")
      await db.insert(clientEntities).values({
        clientId: client.id,
        legalName: (legalName?.trim() || name.trim()),
        entityType: entityType?.trim() || null,
        gstin: gstin?.trim() || null,
        pan: pan?.trim() || null,
        cin: cin?.trim() || null,
      })

      await logActivity({
        tx: db,
        action: "create",
        entityType: "Client",
        entityId: client.id,
        details: `Added client: ${client.name}`,
        orgId,
        clientId: client.id,
        dbUser,
        request,
      })

      return client
    })

    if (!result) return NextResponse.json({ error: "Organisation not found" }, { status: 404 })
    return NextResponse.json({ id: result.id, name: result.name }, { status: 201 })
  } catch (error) {
    console.error("Client create API error:", error)
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 })
  }
}
