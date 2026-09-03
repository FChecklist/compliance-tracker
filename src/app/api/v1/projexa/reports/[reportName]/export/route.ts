// R67 E-07 (R-114): server-rendered PDF / XLSX / CSV for the Budget Summary /
// Cost Variance report. The screen shipped with Export hard-coded to
// "(Not yet available)"; this is the half of the fix that makes it real.
//
// PROJEXA must not gain a PDF or an XLSX library, so the bytes are made here
// and its route only relays them -- the same division the Work Progress Report
// PDF and the Material Cost Report export already ship.
//
// The rows come from boqBudgetVarianceReport with the SAME category/vendor
// parameters the screen used, so an exported file can never disagree with the
// table it was exported from. XLSX goes through report-export-shared.ts's
// rowsToXLSXBuffer, which carries the OWASP formula-injection guard -- BOQ
// descriptions, categories and vendor names are user-typed free text and are
// exactly the fields that guard exists for.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { boqBudgetVarianceReport, ServiceError } from "@/lib/services/construction-reports-service"
import { rowsToCSV, rowsToXLSXBuffer, type ExportRow } from "@/lib/report-export-shared"
import { generateBudgetVarianceReportPdf } from "@/lib/pdf/budget-variance-report-pdf"
import { organisations, projects, erpCurrencies } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"

const FORMATS = ["pdf", "xlsx", "csv"] as const
type Format = (typeof FORMATS)[number]

/** The en dash, the same "no figure" token every screen in this product uses. */
const EMPTY = "–"

/**
 * Which reports can be exported as a document today. It sits under
 * [reportName] rather than beside it so there is ONE export path per report
 * name -- the generic schema-driven renderer (C04-12 / item E-12) extends this
 * map rather than adding a second route shape. A name that is not in it is
 * refused in words, never with a silent empty file.
 */
const EXPORTABLE = new Set(["budget-variance"])

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportName: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const orgId = ctx.orgId // narrow once -- TS cannot carry the check into the closure below

  const { reportName } = await params
  if (!EXPORTABLE.has(reportName)) {
    return NextResponse.json(
      { error: `The ${reportName} report has no document export yet. Exportable reports: ${[...EXPORTABLE].join(", ")}` },
      { status: 400 }
    )
  }

  const { searchParams } = request.nextUrl
  const projectId = searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  const requested = searchParams.get("format") ?? "pdf"
  if (!FORMATS.includes(requested as Format)) {
    return NextResponse.json({ error: `Unknown format. Valid formats: ${FORMATS.join(", ")}` }, { status: 400 })
  }
  const format = requested as Format

  // Repeatable `category`, for the same reason the report route itself uses
  // it: a real category name may contain a comma.
  const categories = searchParams.getAll("category").filter((c) => c.trim() !== "")
  const vendorId = searchParams.get("vendorId") ?? undefined

  try {
    const report = await boqBudgetVarianceReport({ orgId }, projectId, { categories, vendorId })
    const vendorName = vendorId ? (report.availableVendors.find((v) => v.id === vendorId)?.name ?? vendorId) : null
    // Only the contract lines are exported, exactly as the screen and the PDF
    // show them -- a weighted sub-task's amount is derived from its parent, so
    // exporting both would hand a QS a file whose column does not add up to
    // its own total row.
    const rootLines = report.lines.filter((l) => l.isRootLine)

    const filename = `budget-variance-${projectId}${categories.length > 0 ? `-${categories.length}cat` : ""}${vendorId ? "-vendor" : ""}`

    if (format === "pdf") {
      // Same withTenantContext-wrapped branded-header lookup the sibling
      // exports document: compliance.projects/organisations carry an
      // org-scoped RLS policy, so a bare read outside a tenant context is
      // silently filtered to zero rows.
      const { project, org, currency } = await withTenantContext({ orgId }, async (tx) => {
        const project = await tx.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)) })
        const org = await tx.query.organisations.findFirst({ where: eq(organisations.id, orgId), columns: { name: true, address: true, gstin: true } })
        // Never guess a currency: with no base row the PDF prints bare numbers
        // rather than labelling them with a code nobody confirmed.
        const currency = await tx.query.erpCurrencies.findFirst({ where: and(eq(erpCurrencies.orgId, orgId), eq(erpCurrencies.isBaseCurrency, true)), columns: { code: true } })
        return { project, org, currency }
      })
      if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

      const pdf = generateBudgetVarianceReportPdf({
        org: org ?? { name: "VERIDIAN AI", address: null, gstin: null },
        projectName: project.name,
        boqTitle: report.boqTitle,
        currency: currency?.code ?? null,
        lines: report.lines,
        totals: { budget: report.totalBudget, vendorAmount: report.totalVendorAmount, variance: report.totalVariance },
        filters: { categories, vendorName },
      })
      return new NextResponse(new Blob([pdf], { type: "application/pdf" }), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}.pdf"`,
        },
      })
    }

    // The tabular formats carry the same rows a QS re-adds by hand, plus the
    // grand total as its own last row -- so the file and the screen show the
    // same arithmetic, not just the same numbers.
    const rows: ExportRow[] = [
      ...rootLines.map((l) => ({
        "S.No": l.sNo === null ? EMPTY : l.sNo,
        Category: l.category ?? EMPTY,
        Code: l.code ?? EMPTY,
        Description: l.description,
        Qty: l.quantity,
        Rate: l.rate,
        Amt: l.amount,
        Budget: l.budget,
        Vendor: l.vendorName ?? EMPTY,
        "Vendor Amt": l.vendorAmount === null ? EMPTY : l.vendorAmount,
        Variance: l.variance === null ? EMPTY : l.variance,
      })),
      {
        "S.No": "Grand Total", Category: "", Code: "", Description: "", Qty: "", Rate: "", Amt: "",
        Budget: report.totalBudget === null ? EMPTY : report.totalBudget,
        Vendor: "", "Vendor Amt": report.totalVendorAmount, Variance: report.totalVariance,
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
    const xlsx = new Uint8Array(rowsToXLSXBuffer(rows, "Budget Variance"))
    return new NextResponse(new Blob([xlsx], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa budget-variance export error:", error)
    return NextResponse.json({ error: "Failed to export the budget variance report" }, { status: 500 })
  }
}
