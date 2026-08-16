import { clients, userClientAccess, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

const VALID_ACCESS_LEVELS = ["full", "aggregate_only"] as const

type RouteContext = { params: Promise<{ id: string }> } // id = clientId

// Who on the team can see this client, and how much (full detail vs.
// aggregate-only, e.g. a junior team member who can see totals/counts for
// reporting but not open individual records for a client they're not
// staffed on).
export async function GET(_request: NextRequest, context: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ access: [] })

  try {
    const { id } = await context.params
    const rows = await withTenantContext({ orgId }, async (db) => {
      const client = await db.query.clients.findFirst({ where: eq(clients.id, id) })
      if (!client) return null
      return db.query.userClientAccess.findMany({
        where: eq(userClientAccess.clientId, id),
        with: { user: { columns: { name: true, email: true, role: true } } },
      })
    })

    if (rows === null) return NextResponse.json({ error: "Client not found" }, { status: 404 })
    return NextResponse.json({
      access: rows.map((a) => ({
        id: a.id, userId: a.userId, accessLevel: a.accessLevel,
        user: { name: a.user.name, email: a.user.email, role: a.user.role },
      })),
    })
  } catch (error) {
    console.error("Client access GET error:", error)
    return NextResponse.json({ error: "Failed to fetch access list" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "branch_manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { userId, accessLevel } = body
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }
    const level = (VALID_ACCESS_LEVELS as readonly string[]).includes(accessLevel) ? accessLevel : "full"

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const client = await db.query.clients.findFirst({ where: eq(clients.id, id) })
      if (!client) return { error: "Client not found", status: 404 as const }

      // RLS-scoped -- the target user must belong to this same org.
      const targetUser = await db.query.users.findFirst({ where: eq(users.id, userId) })
      if (!targetUser || targetUser.orgId !== orgId) return { error: "User not found in this organisation", status: 404 as const }

      const [access] = await db.insert(userClientAccess).values({
        userId,
        clientId: id,
        accessLevel: level,
      }).returning()

      await logActivity({
        tx: db,
        action: "create",
        entityType: "ClientAccess",
        entityId: access.id,
        details: `Granted ${targetUser.name} ${level} access to client "${client.name}"`,
        orgId,
        clientId: id,
        dbUser,
        request,
      })

      return { access }
    })

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ id: result.access.id }, { status: 201 })
  } catch (error) {
    console.error("Client access grant error:", error)
    return NextResponse.json({ error: "Failed to grant access" }, { status: 500 })
  }
}
