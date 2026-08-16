import { directorsKmp } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ directors: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.directorsKmp.findMany({ orderBy: asc(directorsKmp.name) }))
  return NextResponse.json({
    directors: rows.map((d) => ({
      id: d.id, name: d.name, din: d.din, designation: d.designation, isIndependent: d.isIndependent,
      kycStatus: d.kycStatus, kycValidTill: d.kycValidTill?.toISOString() ?? null, appointedDate: d.appointedDate?.toISOString() ?? null,
    })),
  })
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
    const [director] = await db.insert(directorsKmp).values({
      name: body.name.trim(), din: body.din || null, designation: body.designation || null,
      isIndependent: !!body.isIndependent, appointedDate: body.appointedDate ? new Date(body.appointedDate) : null, orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "DirectorKmp", entityId: director.id, details: `Added director/KMP: ${director.name}`, orgId, dbUser, request })
    return director
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
