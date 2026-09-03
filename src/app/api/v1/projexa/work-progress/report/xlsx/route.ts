// R67 E-18 (R-178) / E-20 (R-208): the Work Progress Report as a spreadsheet.
//
// R-178's constraint is explicit -- "projexa must not gain a PDF or XLSX
// library" -- so the bytes are built here, beside the PDF that has existed
// since #1314, from the SAME computeRows() the PDF is drawn from and the SAME
// schema src/lib/services/report-export.ts describes the document with. One
// description, three files (screen, PDF, XLSX), so a QS who re-adds a column by
// hand gets the number the screen showed him.
//
// Deliberately the same shape as the sibling pdf/route.ts: thin GET,
// requireAuthOrApiKey, 400 on a falsy orgId, every read through the EXISTING
// construction-boq-service / construction-progress-service functions inside one
// withTenantContext (compliance.projects carries an org-scoped RLS policy, so a
// bare `db` select outside the tenant context silently returns zero rows -- the
// bug that route documents at length).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { listBoqs, getBoq } from "@/lib/services/construction-boq-service"
import { listActivities, listCategories, listProgressEntries, ServiceError } from "@/lib/services/construction-progress-service"
import { computeRows } from "@/lib/pdf/work-progress-report-pdf"
import { reportXlsxBuffer, workProgressExportRows, workProgressExportSchema } from "@/lib/services/report-export"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const orgId = ctx.orgId

  const { searchParams } = request.nextUrl
  const projectId = searchParams.get("projectId")
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  const mode = searchParams.get("mode") === "balance" ? "balance" : "total"

  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  if (!from || !to) return NextResponse.json({ error: "from and to (YYYY-MM-DD) query params are required" }, { status: 400 })

  try {
    const project = await withTenantContext({ orgId }, async (tx) =>
      tx.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)) })
    )
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const [boqs, activities, categories, entries] = await Promise.all([
      listBoqs({ orgId }, projectId),
      listActivities({ orgId }, { projectId }),
      listCategories({ orgId }, projectId),
      listProgressEntries({ orgId }, { projectId }),
    ])
    // The same "latest non-superseded revision" rule the PDF route and
    // projexa's own report route use, so the three never describe a different
    // revision of the same BOQ.
    const latestBoq = boqs.find((b) => b.status !== "superseded") ?? boqs[0]
    const lineItems = latestBoq ? (await getBoq({ orgId }, latestBoq.id)).lineItems : []

    const computed = computeRows(
      { org: { name: "", address: null, gstin: null }, projectName: project.name, boqTitle: latestBoq?.title ?? null, from, to, lineItems, activities, categories, entries },
      mode
    )
    const { rows, totals } = workProgressExportRows(computed, mode)
    const buffer = reportXlsxBuffer(workProgressExportSchema(mode), rows, totals)

    return new NextResponse(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="work-progress-report-${projectId}-${from}-to-${to}.xlsx"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa work-progress report xlsx error:", error)
    return NextResponse.json({ error: "Failed to generate work progress report XLSX" }, { status: 500 })
  }
}
