import { auditFindings, auditEngagements } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.auditEngagementId || !body.title?.trim()) return NextResponse.json({ error: "auditEngagementId and title are required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const engagement = await db.query.auditEngagements.findFirst({ where: eq(auditEngagements.id, body.auditEngagementId) })
    if (!engagement) return null
    const [finding] = await db.insert(auditFindings).values({
      auditEngagementId: body.auditEngagementId, title: body.title.trim(), severity: body.severity || "medium",
      dueDate: body.dueDate ? new Date(body.dueDate) : null, orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "AuditFinding", entityId: finding.id, details: `Finding recorded on "${engagement.name}": ${finding.title}`, orgId, dbUser, request })
    return finding
  })
  if (!result) return NextResponse.json({ error: "Audit engagement not found" }, { status: 404 })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
