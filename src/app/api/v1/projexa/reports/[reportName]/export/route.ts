// R67 E-07 (R-114) and E-12 (R-136): server-rendered PDF / XLSX / CSV for the
// reports that have a document schema.
//
// The screen shipped with Export hard-coded to "(Not yet available)"; this is
// the half of the fix that makes it real. PROJEXA must not gain a PDF or an
// XLSX library, so the bytes are made here and its route only relays them --
// the same division the Work Progress Report PDF and the Material Cost Report
// export already ship.
//
// E-12 removed this route's own opinion about columns. The tabular formats are
// now built from the ReportExportSchema in src/lib/services/report-export.ts,
// which is the SAME description PROJEXA's ReportDocument renders the on-screen
// table from -- so an exported file cannot disagree with the table it came
// from, which is exactly what R-136 records happening. XLSX still goes through
// report-export-shared.ts's rowsToXLSXBuffer and its OWASP formula-injection
// guard: BOQ descriptions, categories and vendor names are user-typed free text
// and are exactly the fields that guard exists for.
//
// The rows come from boqBudgetVarianceReport with the SAME category/vendor
// parameters the screen used. project-status shares them deliberately: the
// Project Status card is scalars, and the TABLE under it (E-13's Subcontractor
// / Budget breakup) is the BOQ's budget line by line -- the same rows, a
// narrower schema.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { boqBudgetVarianceReport, designerTimesheetReport, ServiceError } from "@/lib/services/construction-reports-service"
import { designerTimesheetExportRows, reportCsv, reportExportSchema, reportXlsxBuffer } from "@/lib/services/report-export"
import { generateBudgetVarianceReportPdf, filterLabel } from "@/lib/pdf/budget-variance-report-pdf"
import { generateReportDocumentPdf } from "@/lib/pdf/report-document-pdf"
import { organisations, projects, erpCurrencies } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"

const FORMATS = ["pdf", "xlsx", "csv"] as const
type Format = (typeof FORMATS)[number]

const CONTENT_TYPE: Record<Format, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
}

/**
 * Which reports can be exported as a document today. A name that is not here is
 * refused in words, never with a silent empty file. Adding one is adding a
 * schema -- there is no second route shape to write.
 */
const EXPORTABLE = ["budget-variance", "project-status", "designer-timesheet"] as const

/**
 * R67 E-16 (R-150): the branded header every server-rendered document carries.
 * compliance.projects/organisations/erp_currencies all carry an org-scoped RLS
 * policy, so a bare read outside a tenant context is silently filtered to zero
 * rows -- one helper, so neither branch of this route can forget that.
 */
async function documentBranding(orgId: string, projectId: string) {
  return withTenantContext({ orgId }, async (tx) => {
    const project = await tx.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)) })
    const org = await tx.query.organisations.findFirst({ where: eq(organisations.id, orgId), columns: { name: true, address: true, gstin: true } })
    // Never guess a currency: with no base row the PDF prints bare numbers
    // rather than labelling them with a code nobody confirmed.
    const currency = await tx.query.erpCurrencies.findFirst({ where: and(eq(erpCurrencies.orgId, orgId), eq(erpCurrencies.isBaseCurrency, true)), columns: { code: true } })
    return { project, org, currency }
  })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportName: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const orgId = ctx.orgId // narrow once -- TS cannot carry the check into the closure below

  const { reportName } = await params
  const schema = (EXPORTABLE as readonly string[]).includes(reportName) ? reportExportSchema(reportName) : null
  if (!schema) {
    return NextResponse.json(
      { error: `The ${reportName} report has no document export yet. Exportable reports: ${EXPORTABLE.join(", ")}` },
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

  // R67 E-16 (R-150). The Design Studio document has a different SOURCE (the
  // designer timesheet report, over a period) but the same shape of answer, so
  // it branches once here and then goes through the identical schema-driven
  // renderers below. No grand total: see DESIGNER_TIMESHEET_SCHEMA's own note --
  // the four cuts are overlapping views of the same hours.
  if (reportName === "designer-timesheet") {
    const from = searchParams.get("from") ?? undefined
    const to = searchParams.get("to") ?? undefined
    try {
      const report = await designerTimesheetReport({ orgId }, projectId, { from, to })
      const rows = designerTimesheetExportRows(report)
      const window = report.period.from && report.period.to ? `${report.period.from} to ${report.period.to}` : "whole project to date"
      const filename = `designer-timesheet-${projectId}${report.period.from ? `-${report.period.from}` : ""}`

      if (format === "pdf") {
        const { project, org, currency } = await documentBranding(orgId, projectId)
        if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
        const pdf = generateReportDocumentPdf(schema, {
          org: org ?? { name: "VERIDIAN AI", address: null, gstin: null },
          projectName: project.name,
          subtitle: `Approved hours, ${window}`,
          currency: currency?.code ?? null,
          rows,
          totals: {},
          filterLine: null,
          emptyMessage: `No approved designer hours for ${window}.`,
        })
        return new NextResponse(new Blob([pdf], { type: CONTENT_TYPE.pdf }), {
          headers: { "Content-Type": CONTENT_TYPE.pdf, "Content-Disposition": `attachment; filename="${filename}.pdf"` },
        })
      }
      if (format === "csv") {
        return new NextResponse(reportCsv(schema, rows), {
          headers: { "Content-Type": CONTENT_TYPE.csv, "Content-Disposition": `attachment; filename="${filename}.csv"` },
        })
      }
      const bytes = new Uint8Array(reportXlsxBuffer(schema, rows))
      return new NextResponse(new Blob([bytes], { type: CONTENT_TYPE.xlsx }), {
        headers: { "Content-Type": CONTENT_TYPE.xlsx, "Content-Disposition": `attachment; filename="${filename}.xlsx"` },
      })
    } catch (error) {
      if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
      console.error("v1 projexa designer-timesheet export error:", error)
      return NextResponse.json({ error: "Failed to export the designer-timesheet report" }, { status: 500 })
    }
  }

  try {
    const report = await boqBudgetVarianceReport({ orgId }, projectId, { categories, vendorId })
    const vendorName = vendorId ? (report.availableVendors.find((v) => v.id === vendorId)?.name ?? vendorId) : null
    // Only the contract lines are exported, exactly as the screen and the PDF
    // show them -- a weighted sub-task's amount is derived from its parent, so
    // exporting both would hand a QS a file whose column does not add up to
    // its own total row.
    const rootLines = report.lines.filter((l) => l.isRootLine)
    // The service's own single-rounded totals, never re-summed from the rounded
    // per-line display figures (R48 gap-closure F088).
    const totals = {
      budget: report.totalBudget,
      vendorAmount: report.totalVendorAmount,
      variance: report.totalVariance,
    }

    const filename = `${schema.slug}-${projectId}${categories.length > 0 ? `-${categories.length}cat` : ""}${vendorId ? "-vendor" : ""}`

    if (format === "pdf") {
      // Same withTenantContext-wrapped branded-header lookup every document in
      // this route uses -- see documentBranding above for why it must be inside
      // a tenant context.
      const { project, org, currency } = await documentBranding(orgId, projectId)
      if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
      const branding = org ?? { name: "VERIDIAN AI", address: null, gstin: null }

      // budget-variance keeps its own generator: it prints the weighted
      // sub-task count and the "positive variance is over budget" note, which
      // are facts about THAT report rather than about documents in general.
      // Every other schema is rendered by the shared template.
      const pdf =
        schema.slug === "budget-variance"
          ? generateBudgetVarianceReportPdf({
              org: branding,
              projectName: project.name,
              boqTitle: report.boqTitle,
              currency: currency?.code ?? null,
              lines: report.lines,
              totals: { budget: totals.budget, vendorAmount: totals.vendorAmount, variance: totals.variance },
              filters: { categories, vendorName },
            })
          : generateReportDocumentPdf(schema, {
              org: branding,
              projectName: project.name,
              subtitle: report.boqTitle ? `BOQ ${report.boqTitle}` : null,
              currency: currency?.code ?? null,
              rows: rootLines,
              totals,
              filterLine: filterLabel({ categories, vendorName }),
              emptyMessage: report.boqId
                ? `No budget lines for ${filterLabel({ categories, vendorName })}.`
                : "No BOQ approved for this project yet.",
            })

      return new NextResponse(new Blob([pdf], { type: CONTENT_TYPE.pdf }), {
        headers: {
          "Content-Type": CONTENT_TYPE.pdf,
          "Content-Disposition": `attachment; filename="${filename}.pdf"`,
        },
      })
    }

    if (format === "csv") {
      return new NextResponse(reportCsv(schema, rootLines, totals), {
        headers: {
          "Content-Type": CONTENT_TYPE.csv,
          "Content-Disposition": `attachment; filename="${filename}.csv"`,
        },
      })
    }

    // Uint8Array view, not the Buffer itself: a Node Buffer's own `buffer` is
    // typed ArrayBufferLike (it may be a SharedArrayBuffer), which is not a
    // BlobPart -- the same narrowing every other binary route in this repo
    // does before handing bytes to a Blob.
    const xlsx = new Uint8Array(reportXlsxBuffer(schema, rootLines, totals))
    return new NextResponse(new Blob([xlsx], { type: CONTENT_TYPE.xlsx }), {
      headers: {
        "Content-Type": CONTENT_TYPE.xlsx,
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error(`v1 projexa ${reportName} export error:`, error)
    return NextResponse.json({ error: `Failed to export the ${reportName} report` }, { status: 500 })
  }
}
