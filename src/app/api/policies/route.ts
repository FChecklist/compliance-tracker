import { policies } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ policies: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.policies.findMany({ orderBy: asc(policies.title) }))
  return NextResponse.json({
    policies: rows.map((p) => ({ id: p.id, title: p.title, category: p.category, version: p.version, status: p.status, attestationRate: p.attestationRate, history: p.history })),
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
    const [policy] = await db.insert(policies).values({
      title: body.title.trim(), category: body.category || "governance",
      history: [{ version: "v1.0", date: new Date().toLocaleDateString("en-IN"), editedBy: dbUser.name, note: "Initial draft" }],
      orgId, createdById: dbUser.id,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "Policy", entityId: policy.id, details: `New policy drafted: ${policy.title}`, orgId, dbUser, request })
    return policy
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
