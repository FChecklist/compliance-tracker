import { auditEngagements } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

// Risk-based audit planning -- every engagement optionally states which
// risks it covers (coversRiskIds), so audit planning ties back to what the
// Risk Register says actually matters.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ engagements: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.auditEngagements.findMany({ orderBy: desc(auditEngagements.createdAt), with: { findings: true } }))
  return NextResponse.json({
    engagements: rows.map((e) => ({
      id: e.id, name: e.name, auditType: e.auditType, status: e.status, coversRiskIds: e.coversRiskIds,
      findings: e.findings.map((f) => ({ id: f.id, title: f.title, severity: f.severity, capaStatus: f.capaStatus, dueDate: f.dueDate?.toISOString() ?? null, retestResult: f.retestResult })),
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
    const [engagement] = await db.insert(auditEngagements).values({ name: body.name.trim(), auditType: body.auditType || "internal", orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "AuditEngagement", entityId: engagement.id, details: `Audit planned: ${engagement.name}`, orgId, dbUser, request })
    return engagement
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
