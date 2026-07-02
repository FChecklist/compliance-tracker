import { delegationOfAuthority } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ doa: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.delegationOfAuthority.findMany({ orderBy: asc(delegationOfAuthority.activity) }))
  return NextResponse.json({ doa: rows.map((d) => ({ id: d.id, activity: d.activity, thresholdDescription: d.thresholdDescription, approverRole: d.approverRole })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.activity?.trim()) return NextResponse.json({ error: "activity is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [entry] = await db.insert(delegationOfAuthority).values({
      activity: body.activity.trim(), thresholdDescription: body.thresholdDescription || null, approverRole: body.approverRole || null, orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "DelegationOfAuthority", entityId: entry.id, details: `DoA entry added: ${entry.activity}`, orgId, dbUser, request })
    return entry
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
