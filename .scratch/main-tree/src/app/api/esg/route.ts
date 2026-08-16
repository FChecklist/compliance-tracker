import { esgMetrics, poshComplaints, policies } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextResponse } from "next/server"
import { eq, like } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"

const SEED_METRICS = [
  { pillar: "environment", label: "Carbon Emissions vs Target", valuePercent: 68, note: "68% of FY26 reduction target achieved" },
  { pillar: "environment", label: "Water Recycling Rate", valuePercent: 54, note: "54% of wastewater recycled on-site" },
  { pillar: "social", label: "Workforce Diversity Ratio", valuePercent: 41, note: "41% — target 45% by FY27" },
  { pillar: "social", label: "CSR Spend (BRSR Principle 8)", valuePercent: 100, note: "Mandated CSR spend completed" },
  { pillar: "governance", label: "Independent Director Ratio", valuePercent: 50, note: "50% of board are independent directors" },
]

// Social pillar's POSH/policy metrics are computed live from real data at
// read time, not stored -- "graph, not islands," same principle as the
// mockup. Everything else is a seeded/user-editable baseline metric.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ pillars: {} })

  const { rows, poshResolvedPct, poshPolicyAttestation } = await withTenantContext({ orgId }, async (db) => {
    let metricRows = await db.query.esgMetrics.findMany()
    if (metricRows.length === 0) {
      await db.insert(esgMetrics).values(SEED_METRICS.map((m) => ({ ...m, orgId })))
      metricRows = await db.query.esgMetrics.findMany()
    }
    const complaints = await db.query.poshComplaints.findMany()
    const resolved = complaints.filter((c) => c.status.startsWith("closed") || c.status === "resolved").length
    const poshResolvedPct = complaints.length > 0 ? Math.round((resolved / complaints.length) * 100) : 100
    const poshPolicy = await db.query.policies.findFirst({ where: like(policies.title, "POSH%") })
    return { rows: metricRows, poshResolvedPct, poshPolicyAttestation: poshPolicy?.attestationRate ?? 0 }
  })

  const pillars: Record<string, { label: string; value: number; note: string }[]> = { environment: [], social: [], governance: [] }
  for (const r of rows) {
    if (pillars[r.pillar]) pillars[r.pillar].push({ label: r.label, value: r.valuePercent, note: r.note ?? "" })
  }
  pillars.social.push({ label: "POSH Complaints Resolved", value: poshResolvedPct, note: "Computed live from the POSH Compliance module" })
  pillars.social.push({ label: "POSH Policy Attestation", value: poshPolicyAttestation, note: "Computed live from Policy Management" })

  return NextResponse.json({ pillars })
}
