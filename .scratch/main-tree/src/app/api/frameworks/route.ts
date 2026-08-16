import { complianceFrameworks } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

const SEED_FRAMEWORKS = [
  { frameworkKey: "iso27001", name: "ISO 27001:2022", relevanceNote: null },
  { frameworkKey: "soc2", name: "SOC 2 Type II", relevanceNote: null },
  { frameworkKey: "india_statutory", name: "India Statutory (GST / TDS / MCA / Labour)", relevanceNote: null },
  { frameworkKey: "dpdp", name: "DPDP Act 2023", relevanceNote: null },
  { frameworkKey: "coso", name: "COSO Internal Control – Integrated Framework", relevanceNote: null },
  { frameworkKey: "nist", name: "NIST Cybersecurity Framework 2.0", relevanceNote: null },
  { frameworkKey: "pcidss", name: "PCI DSS v4.0", relevanceNote: "Applicable only if the org stores, processes, or transmits cardholder data" },
  { frameworkKey: "hipaa", name: "HIPAA", relevanceNote: "Applicable only if the org handles US-regulated protected health information (PHI)" },
]

// Auto-seeds the standard framework list on first visit (once per org) --
// same idea as auto-provisioning a new tenant's departments. Frameworks
// with a relevanceNote (PCI DSS/HIPAA) are opt-in, not force-populated with
// fake progress for standards the org has no obligation toward.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ frameworks: [] })

  const frameworks = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    let rows = await db.query.complianceFrameworks.findMany({ with: { controls: true } })
    if (rows.length === 0) {
      await db.insert(complianceFrameworks).values(SEED_FRAMEWORKS.map((f) => ({ ...f, orgId })))
      rows = await db.query.complianceFrameworks.findMany({ with: { controls: true } })
    }
    return rows
  })

  return NextResponse.json({
    frameworks: frameworks.map((f) => {
      const done = f.controls.filter((c) => c.status === "implemented" || c.status === "verified").length
      const pct = f.controls.length > 0 ? Math.round((done / f.controls.length) * 100) : 0
      return { id: f.id, frameworkKey: f.frameworkKey, name: f.name, relevanceNote: f.relevanceNote, pct, controls: f.controls.map((c) => ({ id: c.id, controlRef: c.controlRef, title: c.title, status: c.status })) }
    }),
  })
}
