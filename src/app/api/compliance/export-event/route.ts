import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { logActivity } from "@/lib/audit"
import { evaluateBulkExportAnomaly } from "@/lib/risk-anomaly-detection"
import { recordAndEscalateAnomaly } from "@/lib/services/risk-escalation-service"

// VERIDIAN Review Framework gap-closure: Anomaly Detection, "bulk data
// export". Before this, the compliance/reports CSV export buttons
// (compliance/page.tsx, reports/page.tsx) were 100% client-side and logged
// nothing -- the underlying GET /api/compliance list call is a normal read,
// never audited. The client calls this route right after building the CSV
// (fire-and-forget, does not block the download), so a real export event
// is now observable and rule-checked, without touching the read endpoint's
// own semantics.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  let body: { count?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }
  const count = typeof body.count === "number" && Number.isFinite(body.count) ? Math.max(0, Math.floor(body.count)) : 0

  await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    await logActivity({ tx: db, action: "export", entityType: "ComplianceItem", entityId: "bulk", details: JSON.stringify({ count }), orgId, dbUser, request })

    const verdict = evaluateBulkExportAnomaly(count)
    if (verdict.anomaly) {
      await recordAndEscalateAnomaly(db, {
        orgId, eventType: verdict.eventType, severity: verdict.severity,
        sourceEntityType: "compliance_item", actorUserId: dbUser.id,
        reason: verdict.reason, detail: { count },
      })
    }
  })

  return NextResponse.json({ ok: true })
}
