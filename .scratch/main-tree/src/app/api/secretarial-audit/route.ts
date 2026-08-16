import { secretarialAudits } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ audits: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.secretarialAudits.findMany({ orderBy: desc(secretarialAudits.createdAt) }))
  return NextResponse.json({ audits: rows.map((a) => ({ id: a.id, period: a.period, auditorName: a.auditorName, status: a.status, dueDate: a.dueDate?.toISOString() ?? null })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.period?.trim()) return NextResponse.json({ error: "period is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [audit] = await db.insert(secretarialAudits).values({ period: body.period.trim(), auditorName: body.auditorName || null, dueDate: body.dueDate ? new Date(body.dueDate) : null, orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "SecretarialAudit", entityId: audit.id, details: `Secretarial audit started: ${audit.period}`, orgId, dbUser, request })
    return audit
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
