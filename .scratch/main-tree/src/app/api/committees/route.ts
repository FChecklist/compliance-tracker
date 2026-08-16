import { committees } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ committees: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.committees.findMany({ orderBy: asc(committees.name) }))
  return NextResponse.json({ committees: rows.map((c) => ({ id: c.id, name: c.name, charter: c.charter, cadence: c.cadence, lastMetDate: c.lastMetDate?.toISOString() ?? null })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [committee] = await db.insert(committees).values({ name: body.name.trim(), charter: body.charter || null, cadence: body.cadence || null, orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "Committee", entityId: committee.id, details: `Created committee: ${committee.name}`, orgId, dbUser, request })
    return committee
  })
  return NextResponse.json({ id: result.id, name: result.name }, { status: 201 })
}
