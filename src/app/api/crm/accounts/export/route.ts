// Data Import/Export Template Fidelity gap-closure: CSV export of an org's
// full account book. Reuses report-export-shared.ts's rowsToCSV (same CSV
// generator src/app/api/v1/reports/definitions/[id]/run/route.ts already
// uses for report rows) rather than hand-rolling a second CSV writer.
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAllAccountsForExport, ServiceError } from "@/lib/services/crm-accounts-service"
import { rowsToCSV, type ExportRow } from "@/lib/report-export-shared"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const accounts = await listAllAccountsForExport({ orgId })
    const rows: ExportRow[] = accounts.map((a) => ({
      id: a.id,
      name: a.name,
      industry: a.industry ?? "",
      website: a.website ?? "",
      lifecycleStage: a.lifecycleStage,
      ownerId: a.ownerId ?? "",
      parentAccountId: a.parentAccountId ?? "",
      billingCity: a.billingCity ?? "",
      billingCountry: a.billingCountry ?? "",
      createdAt: a.createdAt.toISOString(),
    }))
    const csv = rows.length ? rowsToCSV(rows) : "id,name,industry,website,lifecycleStage,ownerId,parentAccountId,billingCity,billingCountry,createdAt"
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="crm-accounts-${orgId}.csv"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM accounts export error:", error)
    return NextResponse.json({ error: "Failed to export accounts" }, { status: 500 })
  }
}
