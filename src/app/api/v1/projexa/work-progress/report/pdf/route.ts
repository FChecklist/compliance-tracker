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
import { organisations, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { listBoqs, getBoq } from "@/lib/services/construction-boq-service"
import { listActivities, listCategories, listProgressEntries, ServiceError } from "@/lib/services/construction-progress-service"
import { generateWorkProgressReportPdf } from "@/lib/pdf/work-progress-report-pdf"

/**
 * R67 E-36 (R-268). The downloaded file is named after the PROJECT, not its id.
 *
 * This route already sent a Content-Disposition, and Content-Disposition WINS
 * over an <a download> attribute -- so whatever the browser saved was decided
 * here, and what it decided was `work-progress-report-g555imnoq4wihavpwc7t64um
 * -2026-08-01-to-2026-09-03.pdf`. A raw cuid in a filename is the same defect
 * this audit keeps closing on screen (E-22: "does not contain
 * 'g555imnoq4wihavpwc7t64um'"), and a QS who downloads three projects' reports
 * cannot tell them apart in a Downloads folder.
 *
 * ASCII only, because a Content-Disposition `filename=` parameter is a
 * quoted-string in an HTTP header: a non-Latin-1 byte there is not merely
 * ugly, it makes the header invalid and some runtimes throw on it.
 * Decomposing first and DELETING the combining marks matters: without that
 * line the squeeze below turns each accent into its own separator, so
 * "Villa Aguas" (with an acute on the A) would save as "villa-a-guas".
 * Names that reduce to nothing (a project named only in Arabic, say) fall
 * back to the word "project" rather than to an empty segment.
 */
export function pdfFileName(projectName: string, from: string, to: string): string {
  const slug = projectName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return `${slug || "project"}-work-progress-${from}-${to}.pdf`
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const orgId = ctx.orgId // narrow once -- TS can't carry the above null-check through the async closure below

  const { searchParams } = request.nextUrl
  const projectId = searchParams.get("projectId")
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  const mode = searchParams.get("mode") === "balance" ? "balance" : "total" // point 11's toggle, extended to the printed report

  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  if (!from || !to) return NextResponse.json({ error: "from and to (YYYY-MM-DD) query params are required" }, { status: 400 })

  try {
    // Point 117 fix: compliance.projects/organisations carry ONLY an
    // app_runtime_org_scoped RLS policy (org_id = compliance.current_org_id()).
    // The bare `db` import is the plain app_runtime connection -- outside
    // withTenantContext, current_org_id() is unset, so this SELECT was
    // silently RLS-filtered to zero rows for EVERY caller (session or API
    // key alike), and the route always 404'd "Project not found" even for a
    // real, correctly org-scoped project. Same RLS-gap class already fixed
    // 3x elsewhere this run (api_keys/users/report_share_links) -- here the
    // fix is the existing withTenantContext wrapper, same as every other
    // lookup in this same file (listBoqs/listActivities/etc. below).
    const { project, org } = await withTenantContext({ orgId }, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)) })
      // Same org-lookup shape erp-payroll-service.ts's getPayslipDetail() uses
      // for its own branded-header data, including the fallback default.
      const org = await tx.query.organisations.findFirst({ where: eq(organisations.id, orgId), columns: { name: true, address: true, gstin: true } })
      return { project, org }
    })
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const [boqs, activities, categories, entries] = await Promise.all([
      listBoqs({ orgId }, projectId),
      listActivities({ orgId }, { projectId }),
      listCategories({ orgId }, projectId),
      listProgressEntries({ orgId }, { projectId }),
    ])
    // Same "latest non-superseded revision" convention projexa's own
    // work-progress/report/route.ts uses, so scope-wise figures here never
    // double-count line items across a BoQ's revision history.
    const latestBoq = boqs.find((b) => b.status !== "superseded") ?? boqs[0]
    const lineItems = latestBoq ? (await getBoq({ orgId }, latestBoq.id)).lineItems : []

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
        // R67 E-36: named after the project, not its id -- see pdfFileName above.
        "Content-Disposition": `attachment; filename="${pdfFileName(project.name, from, to)}"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa work-progress report pdf error:", error)
    return NextResponse.json({ error: "Failed to generate work progress report PDF" }, { status: 500 })
  }
}
