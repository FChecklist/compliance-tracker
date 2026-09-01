import { rbiComplianceItems, organisations } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

// R66 code-quality fix: neither handler wrapped its db/withTenantContext
// calls in try/catch, unlike the majority service-layer pattern (and
// unlike board/route.ts's POST in the same GRC domain family). Both now
// return a consistent JSON error response on failure instead of an
// unhandled exception producing a non-JSON 500.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ applicable: false, items: [] })

  try {
    const [org, items] = await withTenantContext({ orgId }, (db) =>
      Promise.all([db.query.organisations.findFirst({ where: eq(organisations.id, orgId) }), db.query.rbiComplianceItems.findMany({ orderBy: asc(rbiComplianceItems.circular) })])
    )
    const applicable = org?.regulatoryEntityType === "bank_nbfc"
    return NextResponse.json({ applicable, entityType: org?.regulatoryEntityType, items: applicable ? items.map((i) => ({ id: i.id, circular: i.circular, category: i.category, status: i.status })) : [] })
  } catch (error) {
    console.error("RBI compliance list error:", error)
    return NextResponse.json({ error: "Failed to fetch RBI compliance items" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    if (!body.circular?.trim()) return NextResponse.json({ error: "circular is required" }, { status: 400 })

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const [item] = await db.insert(rbiComplianceItems).values({ circular: body.circular.trim(), category: body.category || null, orgId }).returning()
      await logActivity({ tx: db, action: "create", entityType: "RbiComplianceItem", entityId: item.id, details: `RBI item added: ${item.circular}`, orgId, dbUser, request })
      return item
    })
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (error) {
    console.error("RBI compliance item create error:", error)
    return NextResponse.json({ error: "Failed to create RBI compliance item" }, { status: 500 })
  }
}
