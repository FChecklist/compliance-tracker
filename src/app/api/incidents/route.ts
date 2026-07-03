import { incidents, risks } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { canAccess } from "@/lib/classification"
import { logActivity } from "@/lib/audit"
import { resolveModuleRule } from "@/lib/module-rules-resolver"

// Wave 21: the auto-trigger condition that decides whether a new incident
// is classified 'confidential' (vs. 'department') -- the actual gate this
// module has today, confirmed by reading this route directly, distinct
// from `regulatoryNotifyRequired` which is plain client-supplied input with
// no derived logic -- is now rule-driven (moduleKey='incidents',
// ruleKey='regulatory_notify_triggers') instead of hardcoded. An org can
// broaden its own trigger set (e.g. a SEBI-governed client also
// auto-flagging "critical" severity incidents as confidential) without a
// code change. The seeded platform default's categoryRegex is the exact
// same pattern this replaces, so behavior is byte-for-byte unchanged until
// an org/client sets its own override.
type NotifyTriggers = { categoryRegex?: string; category?: string[]; severity?: string[] }

async function resolveAutoNotify(orgId: string, category: string, severity: string): Promise<boolean> {
  const resolved = await resolveModuleRule("incidents", "regulatory_notify_triggers", { orgId })
  const triggers = resolved?.value as NotifyTriggers | undefined
  if (!triggers) return /security|breach/i.test(category) // no rule resolved at all (shouldn't happen once seeded) -- same fallback as pre-Wave-21
  const regexMatch = triggers.categoryRegex ? new RegExp(triggers.categoryRegex, "i").test(category) : false
  const categoryMatch = triggers.category?.some((c) => c.toLowerCase() === category.toLowerCase()) ?? false
  const severityMatch = triggers.severity?.some((s) => s.toLowerCase() === severity.toLowerCase()) ?? false
  return regexMatch || categoryMatch || severityMatch
}

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

  const isSecurityOrBreach = await resolveAutoNotify(orgId, body.category, body.severity || "medium")
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
