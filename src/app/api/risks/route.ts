import { risks, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

// Scope filter (mockup's Own/Peer/Department/Region/Company-wide, adapted):
// manager rank and above see every risk in the org; below that, only risks
// owned by their own department -- approximates the mockup's Scope axis
// using this app's existing role ranks rather than a whole separate column.
const BROAD_SCOPE_ROLES = ["admin", "veridian_admin", "branch_manager", "senior_professional", "manager"]

export async function GET() {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ risks: [] })

  const rows = await withTenantContext({ orgId }, (db) => db.query.risks.findMany({ orderBy: desc(risks.updatedAt) }))
  const visible = BROAD_SCOPE_ROLES.includes(dbUser.role)
    ? rows
    : rows.filter((r) => r.ownerDept === dbUser.departmentId || r.ownerId === dbUser.id)

  return NextResponse.json({
    risks: visible.map((r) => ({ id: r.id, title: r.title, category: r.category, likelihood: r.likelihood, impact: r.impact, status: r.status, ownerDept: r.ownerDept, linkedControlIds: r.linkedControlIds })),
    totalCount: rows.length,
    hiddenByScope: rows.length - visible.length,
  })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [risk] = await db.insert(risks).values({
      title: body.title.trim(), category: body.category || "operational",
      likelihood: body.likelihood ? Number(body.likelihood) : 3, impact: body.impact ? Number(body.impact) : 3,
      ownerId: dbUser.id, ownerDept: dbUser.departmentId, orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "Risk", entityId: risk.id, details: `Risk logged: ${risk.title}`, orgId, dbUser, request })
    return risk
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
