import { whistleblowerCases } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { canAccess } from "@/lib/classification"
import { logActivity } from "@/lib/audit"
import { resolveModuleRule } from "@/lib/module-rules-resolver"
import { computeSlaStatus } from "@/lib/engines/grc-workflow-engine"

// Investigation SLA -- unlike POSH's statutory 90-day deadline, whistleblower
// investigation timelines are a matter of company policy, not law, so this
// follows the incidents module's module-rule-configurable pattern rather
// than hardcoding a number. Platform default: 90 days (see the seed row in
// drizzle -- an org can shorten/lengthen it without a code change).
async function resolveInvestigationSlaDays(orgId: string): Promise<number> {
  const resolved = await resolveModuleRule("whistleblower_cases", "investigation_sla_days", { orgId })
  const days = (resolved?.value as { days?: number } | undefined)?.days
  return typeof days === "number" && days > 0 ? days : 90
}

export async function GET() {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ restricted: false, cases: [] })
  if (!canAccess(dbUser.role, "confidential")) return NextResponse.json({ restricted: true, cases: [] })

  const [rows, slaDays] = await Promise.all([
    withTenantContext({ orgId }, (db) => db.query.whistleblowerCases.findMany({ orderBy: desc(whistleblowerCases.receivedDate) })),
    resolveInvestigationSlaDays(orgId),
  ])
  return NextResponse.json({
    restricted: false,
    cases: rows.map((c) => {
      const deadline = new Date(c.receivedDate.getTime() + slaDays * 24 * 60 * 60 * 1000)
      return {
        id: c.id, caseRef: c.caseRef, category: c.category, receivedDate: c.receivedDate.toISOString(), status: c.status,
        // Real investigation SLA -- was never computed, only receivedDate/status stored.
        investigationSla: c.status === "closed" ? { dueDate: null, daysRemaining: null, isOverdue: false, urgency: "none" as const } : computeSlaStatus(deadline),
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
