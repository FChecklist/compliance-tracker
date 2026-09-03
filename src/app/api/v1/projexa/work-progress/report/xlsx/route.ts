// R67 E-28 (R-244 / R-254): the Work Progress Report as a real .xlsx.
//
// WHY IT IS HERE AND NOT IN PROJEXA. PROJEXA is a thin client of this API and
// must not gain an XLSX library (C06-13 / D-09); this repo already has one
// (src/lib/report-export-shared.ts#rowsToXLSXBuffer, with its formula-injection
// guard), so the sheet is rendered here and streamed back through a projexa
// relay. Until now the WPR's "Export XLSX" was a CSV built in the browser
// wearing the wrong label.
//
// DELIBERATELY THE SAME SHAPE AS THE SIBLING pdf/route.ts: thin GET,
// requireAuthOrApiKey, 400 on a falsy orgId, the SAME existing service reads
// (no bespoke query), the SAME computeRows arithmetic via
// work-progress-report-export.ts, then stream the binary. Two exports of one
// report that disagree would be worse than one export.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { organisations, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { listBoqs, getBoq } from "@/lib/services/construction-boq-service"
import { listActivities, listCategories, listProgressEntries, ServiceError } from "@/lib/services/construction-progress-service"
import { listCurrencies } from "@/lib/services/erp-accounting-service"
import { rowsToXLSXBuffer } from "@/lib/report-export-shared"
import { workProgressExportFilename, workProgressExportRows } from "@/lib/work-progress-report-export"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // Same floor as every other project-scoped construction read on this
  // namespace: an export is a read of the same rows the screen already shows.
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const orgId = ctx.orgId // narrow once -- TS can't carry the null-check through the async closure below

  const { searchParams } = request.nextUrl
  const projectId = searchParams.get("projectId")
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  const mode = searchParams.get("mode") === "balance" ? "balance" : "total" // point 11's toggle, same normalisation as the PDF route

  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  if (!from || !to) return NextResponse.json({ error: "from and to (YYYY-MM-DD) query params are required" }, { status: 400 })

  try {
    // Same RLS-safe lookup the PDF route documents: compliance.projects and
    // compliance.organisations carry an org-scoped policy, so this SELECT must
    // run inside withTenantContext or it is silently filtered to zero rows.
    const { project, org } = await withTenantContext({ orgId }, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)) })
      const org = await tx.query.organisations.findFirst({ where: eq(organisations.id, orgId), columns: { name: true, address: true, gstin: true } })
      return { project, org }
    })
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const [boqs, activities, categories, entries, currencies] = await Promise.all([
      listBoqs({ orgId }, projectId),
      listActivities({ orgId }, { projectId }),
      listCategories({ orgId }, projectId),
      listProgressEntries({ orgId }, { projectId }),
      // NEVER GUESS A CURRENCY: an org with no base row gets bare numbers and
      // headers with no code, exactly as the screens do.
      listCurrencies({ orgId }).catch(() => []),
    ])
    const latestBoq = boqs.find((b) => b.status !== "superseded") ?? boqs[0]
    const lineItems = latestBoq ? (await getBoq({ orgId }, latestBoq.id)).lineItems : []
    const currency = currencies.find((c) => c.isBaseCurrency)?.code ?? null

    const rows = workProgressExportRows(
      {
        org: org ?? { name: "VERIDIAN AI", address: null, gstin: null },
        projectName: project.name,
        boqTitle: latestBoq?.title ?? null,
        from, to, mode,
        lineItems, activities, categories, entries,
      },
      { mode, currency }
    )

    // An empty BOQ is a legitimate answer, not an error -- but an empty
    // workbook is a file that tells the reader nothing, so the sheet carries
    // one row saying what happened, in the words the screen uses.
    const sheet = rows.length > 0 ? rows : [{ "Work Progress Report": `No BOQ line items for ${project.name} between ${from} and ${to}` }]
    const buffer = rowsToXLSXBuffer(sheet, "Work Progress")

    return new NextResponse(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${workProgressExportFilename(project.name, from, to, "xlsx")}"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa work-progress report xlsx error:", error)
    return NextResponse.json({ error: "Failed to generate work progress report spreadsheet" }, { status: 500 })
  }
}
