import { hrComplianceItems } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

// State-wise, not centralized -- Indian labour compliance (PT/LWF
// especially) is largely state-administered, same principle carried over
// from the mockup.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ items: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.hrComplianceItems.findMany({ orderBy: asc(hrComplianceItems.item) }))
  return NextResponse.json({ items: rows.map((i) => ({ id: i.id, item: i.item, governingLaw: i.governingLaw, state: i.state, dueDate: i.dueDate?.toISOString() ?? null, status: i.status })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.item?.trim()) return NextResponse.json({ error: "item is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [item] = await db.insert(hrComplianceItems).values({
      item: body.item.trim(), governingLaw: body.governingLaw || null, state: body.state || "All India",
      dueDate: body.dueDate ? new Date(body.dueDate) : null, orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "HrComplianceItem", entityId: item.id, details: `HR compliance item added: ${item.item} (${item.state})`, orgId, dbUser, request })
    return item
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
