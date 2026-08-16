import { rbiComplianceItems, organisations } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ applicable: false, items: [] })

  const [org, items] = await withTenantContext({ orgId }, (db) =>
    Promise.all([db.query.organisations.findFirst({ where: eq(organisations.id, orgId) }), db.query.rbiComplianceItems.findMany({ orderBy: asc(rbiComplianceItems.circular) })])
  )
  const applicable = org?.regulatoryEntityType === "bank_nbfc"
  return NextResponse.json({ applicable, entityType: org?.regulatoryEntityType, items: applicable ? items.map((i) => ({ id: i.id, circular: i.circular, category: i.category, status: i.status })) : [] })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.circular?.trim()) return NextResponse.json({ error: "circular is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [item] = await db.insert(rbiComplianceItems).values({ circular: body.circular.trim(), category: body.category || null, orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "RbiComplianceItem", entityId: item.id, details: `RBI item added: ${item.circular}`, orgId, dbUser, request })
    return item
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
