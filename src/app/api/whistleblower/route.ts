import { whistleblowerCases } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { canAccess } from "@/lib/classification"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ restricted: false, cases: [] })
  if (!canAccess(dbUser.role, "confidential")) return NextResponse.json({ restricted: true, cases: [] })

  const rows = await withTenantContext({ orgId }, (db) => db.query.whistleblowerCases.findMany({ orderBy: desc(whistleblowerCases.receivedDate) }))
  return NextResponse.json({ restricted: false, cases: rows.map((c) => ({ id: c.id, caseRef: c.caseRef, category: c.category, receivedDate: c.receivedDate.toISOString(), status: c.status })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!canAccess(dbUser.role, "confidential")) return NextResponse.json({ error: "Insufficient clearance" }, { status: 403 })

  const body = await request.json()
  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const existing = await db.query.whistleblowerCases.findMany()
    const caseRef = `WB-${String(existing.length + 1).padStart(3, "0")}`
    const [wCase] = await db.insert(whistleblowerCases).values({ caseRef, category: body.category || "Other", receivedDate: new Date(), orgId, recordedById: dbUser.id }).returning()
    await logActivity({ tx: db, action: "create", entityType: "WhistleblowerCase", entityId: wCase.id, details: "New whistleblower case logged (Confidential — case detail withheld from activity log)", orgId, dbUser, request })
    return wCase
  })
  return NextResponse.json({ id: result.id, caseRef: result.caseRef }, { status: 201 })
}
