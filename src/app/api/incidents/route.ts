import { incidents, risks } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { canAccess } from "@/lib/classification"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ incidents: [] })

  const rows = await withTenantContext({ orgId }, (db) => db.query.incidents.findMany({ orderBy: desc(incidents.createdAt) }))
  // Per-record classification gating, not whole-module -- a power outage is
  // Company-wide visible, a data-breach investigation is Confidential.
  return NextResponse.json({
    incidents: rows.map((i) => {
      const cleared = canAccess(dbUser.role, i.classification as never)
      return {
        id: i.id, category: i.category, severity: i.severity, classification: i.classification, stage: i.stage,
        regulatoryNotifyRequired: i.regulatoryNotifyRequired, notified: i.notified, notifyDeadline: i.notifyDeadline,
        linkedRiskId: i.linkedRiskId,
        ...(cleared ? { title: i.title, capaDueDate: i.capaDueDate?.toISOString() ?? null } : { restricted: true, title: null }),
      }
    }),
  })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.title?.trim() || !body.category?.trim()) return NextResponse.json({ error: "title and category are required" }, { status: 400 })

  const isSecurityOrBreach = /security|breach/i.test(body.category)
  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [incident] = await db.insert(incidents).values({
      title: body.title.trim(), category: body.category.trim(), severity: body.severity || "medium",
      classification: isSecurityOrBreach ? "confidential" : "department",
      regulatoryNotifyRequired: !!body.regulatoryNotifyRequired,
      notifyDeadline: body.regulatoryNotifyRequired ? "TBD — set during triage" : null,
      orgId, reportedById: dbUser.id,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "Incident", entityId: incident.id, details: `New incident logged: "${incident.title}" (${incident.category}, ${incident.severity})`, orgId, dbUser, request })
    return incident
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
