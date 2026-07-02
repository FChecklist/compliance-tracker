import { sebiComplianceItems, organisations } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

// Gated by organisations.regulatoryEntityType, not shown as universally
// applicable -- a private unlisted company has zero SEBI LODR obligations.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ applicable: false, items: [] })

  const [org, items] = await withTenantContext({ orgId }, (db) =>
    Promise.all([db.query.organisations.findFirst({ where: eq(organisations.id, orgId) }), db.query.sebiComplianceItems.findMany({ orderBy: asc(sebiComplianceItems.dueDate) })])
  )
  const applicable = org?.regulatoryEntityType === "listed_company"
  return NextResponse.json({ applicable, entityType: org?.regulatoryEntityType, items: applicable ? items.map((i) => ({ id: i.id, requirement: i.requirement, dueDate: i.dueDate?.toISOString() ?? null, status: i.status, linkedModule: i.linkedModule })) : [] })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.requirement?.trim()) return NextResponse.json({ error: "requirement is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [item] = await db.insert(sebiComplianceItems).values({ requirement: body.requirement.trim(), dueDate: body.dueDate ? new Date(body.dueDate) : null, orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "SebiComplianceItem", entityId: item.id, details: `SEBI item added: ${item.requirement}`, orgId, dbUser, request })
    return item
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
