// R67 E-05 (R-103): server-rendered PDF / XLSX / CSV for the Material Cost
// Report. PROJEXA must not gain a PDF or an XLSX library, so the bytes are
// made here and its route only relays them -- the same division the Work
// Progress Report PDF already ships (v1/projexa/work-progress/report/pdf ->
// projexa src/app/api/work-progress/report/pdf/route.ts).
//
// The rows come from getMaterialCostReport, the SAME call the screen itself
// makes with the SAME parameters, so an exported file can never disagree with
// the table it was exported from. XLSX goes through report-export-shared.ts's
// rowsToXLSXBuffer, which carries the OWASP formula-injection guard -- vendor
// and material names are user-typed free text and are exactly the fields that
// guard exists for.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { getMaterialCostReport, ServiceError } from "@/lib/services/construction-materials-service"
import { rowsToCSV, rowsToXLSXBuffer, type ExportRow } from "@/lib/report-export-shared"
import { generateMaterialCostReportPdf } from "@/lib/pdf/material-cost-report-pdf"
import { organisations, projects, erpCurrencies } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"

const FORMATS = ["pdf", "xlsx", "csv"] as const
type Format = (typeof FORMATS)[number]

/** The en dash, the same "no figure" token every screen in this product uses. */
const EMPTY = "–"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const orgId = ctx.orgId // narrow once -- TS cannot carry the check into the closure below

  const { searchParams } = request.nextUrl
  const projectId = searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  const requested = searchParams.get("format") ?? "pdf"
  if (!FORMATS.includes(requested as Format)) {
    return NextResponse.json({ error: `Unknown format. Valid formats: ${FORMATS.join(", ")}` }, { status: 400 })
  }
  const format = requested as Format

  const from = searchParams.get("from") ?? undefined
  const to = searchParams.get("to") ?? undefined
  const groupBy = searchParams.get("groupBy") === "vendor" ? "vendor" : "material"

  try {
    const report = await getMaterialCostReport({ orgId }, projectId, { from, to, groupBy })

    const filename = `material-cost-report-${projectId}${from ? `-${from}` : ""}${to ? `-to-${to}` : ""}`

    if (format === "pdf") {
      // Same withTenantContext-wrapped branded-header lookup the WPR PDF route
      // documents: compliance.projects/organisations carry an org-scoped RLS
      // policy, so a bare read outside a tenant context is silently filtered
      // to zero rows.
      const { project, org, currency } = await withTenantContext({ orgId }, async (tx) => {
        const project = await tx.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)) })
        const org = await tx.query.organisations.findFirst({ where: eq(organisations.id, orgId), columns: { name: true, address: true, gstin: true } })
        // Never guess a currency: with no base row the PDF prints bare
        // numbers rather than labelling them with a code nobody confirmed
        // (the same rule src/lib/format-money.ts states on the PROJEXA side).
        const currency = await tx.query.erpCurrencies.findFirst({ where: and(eq(erpCurrencies.orgId, orgId), eq(erpCurrencies.isBaseCurrency, true)), columns: { code: true } })
        return { project, org, currency }
      })
      if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

      const pdf = generateMaterialCostReportPdf({
        org: org ?? { name: "VERIDIAN AI", address: null, gstin: null },
        projectName: project.name,
        currency: currency?.code ?? null,
        report,
      })
      return new NextResponse(new Blob([pdf], { type: "application/pdf" }), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}.pdf"`,
        },
      })
    }

    // The tabular formats carry the raw rows a QS re-adds by hand, plus the
    // grand total as its own last row -- so the file and the screen show the
    // same arithmetic, not just the same numbers.
    const rows: ExportRow[] = [
      ...report.rows.map((r) => ({
        Material: r.name,
        Spec: r.spec ?? EMPTY,
        Vendor: r.vendorName ?? EMPTY,
        Unit: r.unit ?? EMPTY,
        "Qty Received": r.totalQuantityReceived,
        "Total Cost": r.totalCost,
        "Avg Unit Cost": r.averageUnitCost,
        "Master Unit Cost": r.masterUnitCost === null ? EMPTY : r.masterUnitCost,
        Variance: r.variance === null ? EMPTY : r.variance,
      })),
      {
        Material: "Grand Total", Spec: "", Vendor: "", Unit: "",
        "Qty Received": report.totals.quantity,
        "Total Cost": report.totals.cost,
        "Avg Unit Cost": "", "Master Unit Cost": "", Variance: "",
      },
    ]

    if (format === "csv") {
      return new NextResponse(rowsToCSV(rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}.csv"`,
        },
      })
    }

    // Uint8Array view, not the Buffer itself: a Node Buffer's own `buffer` is
    // typed ArrayBufferLike (it may be a SharedArrayBuffer), which is not a
    // BlobPart -- the same narrowing every other binary route in this repo
    // does before handing bytes to a Blob.
    const xlsx = new Uint8Array(rowsToXLSXBuffer(rows, "Material Cost"))
    return new NextResponse(new Blob([xlsx], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction materials cost-report export error:", error)
    return NextResponse.json({ error: "Failed to export material cost report" }, { status: 500 })
  }
}
