// R67 D-10 (audit R-028). The drawings landing's header becomes the standard
// Filter | Export | + New bar, and Export has to produce a real file. PROJEXA
// must not gain an XLSX library (it has no PDF or XLSX dependency and the
// programme keeps it that way -- see the Work Progress Report PDF relay,
// src/app/api/work-progress/report/pdf/route.ts and its projexa relay), so the
// bytes are built HERE with rowsToXLSXBuffer() -- the same helper the reporting
// API already uses, which carries the OWASP formula-injection guard that
// matters most on exactly this data (drawing names and disciplines are free
// text typed by site staff).
//
// The register it exports is the one the user is looking at: same project, same
// Kind filter, same Discipline filter, same column set and order as
// src/lib/drawings-register.ts defines for the screen.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { listDocuments, ServiceError } from "@/lib/services/document-service"
import {
  DRAWING_CATEGORIES,
  categoryFilterForKind,
  matchesDiscipline,
  toDrawingDto,
  toDrawingExportRows,
} from "@/lib/drawings-register"
import { rowsToXLSXBuffer } from "@/lib/report-export-shared"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  const category = categoryFilterForKind(request.nextUrl.searchParams.get("kind"))
  const discipline = request.nextUrl.searchParams.get("discipline")

  try {
    const lists = await Promise.all(
      (category ? [category] : [...DRAWING_CATEGORIES]).map((c) =>
        listDocuments({ orgId: ctx.orgId! }, { category: c, linkedEntityType: "project", linkedEntityId: projectId })
      )
    )
    const docs = lists.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    // No signed URLs are minted here: the export's Link column is deliberately
    // the drawing's own PROJEXA path for stored files (a signed URL lives 300
    // seconds and would be dead before the sheet was opened) and the external
    // URL for link rows, which the row already carries in fileUrl.
    const dtos = docs
      .map((doc) => toDrawingDto(doc, ((doc.metadata ?? {}) as { isExternalLink?: boolean }).isExternalLink === true ? doc.fileUrl : null))
      .filter((d) => matchesDiscipline(d, discipline))

    const buffer = rowsToXLSXBuffer(toDrawingExportRows(dtos), "Drawings")
    // Blob, not a raw Buffer/Uint8Array -- same BodyInit-typing reason
    // work-progress/report/pdf/route.ts documents on its own return.
    return new NextResponse(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="drawings-${projectId}.xlsx"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa drawings export error:", error)
    return NextResponse.json({ error: "Failed to export the drawings register" }, { status: 500 })
  }
}
