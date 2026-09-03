// R67 D-31: the printed attendance summary. Same posture as
// v1/projexa/work-progress/report/pdf/route.ts -- thin GET, requireAuthOrApiKey,
// 400 on a falsy orgId, fetch through the EXISTING service function (no bespoke
// query), generate, stream the binary. All layout lives in
// src/lib/pdf/attendance-summary-pdf.ts and all arithmetic in
// construction-reports-service.ts, so the sheet and the screen cannot disagree.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { organisations, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { attendanceSummary, ServiceError } from "@/lib/services/construction-reports-service"
import { generateAttendanceSummaryPdf } from "@/lib/pdf/attendance-summary-pdf"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const orgId = ctx.orgId // narrow once -- TS cannot carry the null-check into the async closure below

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  const from = request.nextUrl.searchParams.get("from") ?? undefined
  const to = request.nextUrl.searchParams.get("to") ?? undefined

  try {
    // Inside withTenantContext, not the bare db export: compliance.projects and
    // organisations carry only an org-scoped RLS policy, so an unwrapped SELECT
    // is silently filtered to zero rows (the exact bug point 117 fixed on the
    // work-progress PDF route).
    const { project, org } = await withTenantContext({ orgId }, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)) })
      const org = await tx.query.organisations.findFirst({ where: eq(organisations.id, orgId), columns: { name: true, address: true, gstin: true } })
      return { project, org }
    })
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const summary = await attendanceSummary({ orgId }, projectId, from, to)
    const pdfBuffer = generateAttendanceSummaryPdf({
      org: org ?? { name: "VERIDIAN AI", address: null, gstin: null },
      projectName: project.name,
      from: summary.from,
      to: summary.to,
      rows: summary.rows,
      totals: summary.totals,
      headcount: summary.headcount,
      ties: summary.reconciliation.ties,
    })

    // Blob, not a raw ArrayBuffer -- same BodyInit-typing reason the payslip
    // and work-progress PDF routes document on their own returns.
    return new NextResponse(new Blob([pdfBuffer], { type: "application/pdf" }), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="attendance-summary-${projectId}${from ? `-${from}` : ""}${to && to !== from ? `-to-${to}` : ""}.pdf"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa attendance summary pdf error:", error)
    return NextResponse.json({ error: "Failed to generate the attendance summary PDF" }, { status: 500 })
  }
}
