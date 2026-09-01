import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listOpportunities, listPipelineStages, ServiceError } from "@/lib/services/crm-service"

// VERIDIAN Review Framework gap-closure: Sales Pipeline (2026-08-07), "Data
// Import/Export Template Fidelity" + "Reporting & Export Accuracy"
// findings. Confirmed absent before this wave: no CSV import/export
// existed anywhere for crm_leads/crm_opportunities (grepped src/ clean).
// Export-only for this wave -- a round-trippable *import* needs real
// validation (unknown ownerId/stage handling, dedup) that's genuinely more
// work than one route; scoped down to export here and noted as a follow-on
// in PROGRESS.md, not silently dropped.
function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return ""
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const [opportunities, stages] = await Promise.all([
      listOpportunities({ orgId }),
      listPipelineStages({ orgId }, "opportunity"),
    ])
    const stageLabel = new Map(stages.map((s) => [s.stageKey, s.label]))

    const header = ["Name", "Stage", "Estimated Value", "Currency", "Exchange Rate", "Expected Close Date", "Owner ID", "AI Win Probability %", "Created At"]
    const rows = opportunities.map((o) => [
      csvEscape(o.name),
      csvEscape(stageLabel.get(o.stage) ?? o.stage),
      csvEscape(o.estimatedValue),
      csvEscape(o.currencyId ?? ""),
      csvEscape(o.exchangeRate),
      csvEscape(o.expectedCloseDate ?? ""),
      csvEscape(o.ownerId ?? ""),
      csvEscape(o.aiWinProbability ?? ""),
      csvEscape(o.createdAt.toISOString()),
    ].join(","))
    const csv = [header.join(","), ...rows].join("\n")

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sales-pipeline-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Pipeline export error:", error)
    return NextResponse.json({ error: "Failed to export pipeline" }, { status: 500 })
  }
}
