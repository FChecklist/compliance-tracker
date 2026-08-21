// Point 138: real PDF export for the Work Progress Report -- point 117
// (projexa) has been waiting on this; projexa cannot relay a PDF that
// nothing generates. Same posture as veri-meetings/[id]/pdf/route.ts and
// payroll/payslips/[id]/pdf/route.ts: thin GET, requireAuthOrApiKey, 400 on
// falsy orgId, fetch via the EXISTING construction-progress-service.ts /
// construction-boq-service.ts functions (no bespoke query), generate,
// stream the binary. All layout/computation lives in
// src/lib/pdf/work-progress-report-pdf.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { db, organisations, projects } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { listBoqs, getBoq } from "@/lib/services/construction-boq-service"
import { listActivities, listCategories, listProgressEntries, ServiceError } from "@/lib/services/construction-progress-service"
import { generateWorkProgressReportPdf } from "@/lib/pdf/work-progress-report-pdf"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { searchParams } = request.nextUrl
  const projectId = searchParams.get("projectId")
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  const mode = searchParams.get("mode") === "balance" ? "balance" : "total" // point 11's toggle, extended to the printed report

  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  if (!from || !to) return NextResponse.json({ error: "from and to (YYYY-MM-DD) query params are required" }, { status: 400 })

  try {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    // Same org-lookup shape erp-payroll-service.ts's getPayslipDetail() uses
    // for its own branded-header data, including the fallback default.
    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, ctx.orgId), columns: { name: true, address: true, gstin: true } })

    const [boqs, activities, categories, entries] = await Promise.all([
      listBoqs({ orgId: ctx.orgId }, projectId),
      listActivities({ orgId: ctx.orgId }, { projectId }),
      listCategories({ orgId: ctx.orgId }, projectId),
      listProgressEntries({ orgId: ctx.orgId }, { projectId }),
    ])
    // Same "latest non-superseded revision" convention projexa's own
    // work-progress/report/route.ts uses, so scope-wise figures here never
    // double-count line items across a BoQ's revision history.
    const latestBoq = boqs.find((b) => b.status !== "superseded") ?? boqs[0]
    const lineItems = latestBoq ? (await getBoq({ orgId: ctx.orgId }, latestBoq.id)).lineItems : []

    const pdfBuffer = generateWorkProgressReportPdf({
      org: org ?? { name: "VERIDIAN AI", address: null, gstin: null },
      projectName: project.name,
      boqTitle: latestBoq?.title ?? null,
      from, to, mode,
      lineItems, activities, categories, entries,
    })

    // Blob, not a raw ArrayBuffer/Uint8Array -- same BodyInit-typing reason
    // payroll/payslips/[id]/pdf/route.ts documents on its own return.
    return new NextResponse(new Blob([pdfBuffer], { type: "application/pdf" }), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="work-progress-report-${projectId}-${from}-to-${to}.pdf"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa work-progress report pdf error:", error)
    return NextResponse.json({ error: "Failed to generate work progress report PDF" }, { status: 500 })
  }
}
