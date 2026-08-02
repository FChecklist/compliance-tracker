// Priority 15, Wave 2: real PDF export for a quotation. PROJEXA has no PDF
// library of its own and shouldn't gain one (zero-duplication principle,
// same as every other /api/v1/projexa/* route) -- this generates and
// streams a real binary PDF from here, matching the thin-alias pattern used
// throughout this surface (read-only GET, so no requireRoleOrScope gate
// beyond auth, same posture as the GET on the parent quotations list).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getQuotationForPdf, ServiceError } from "@/lib/services/erp-selling-service"
import { generateQuotationPdf } from "@/lib/pdf/quotation-pdf"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const data = await getQuotationForPdf({ orgId: ctx.orgId }, id)
    const pdfBuffer = generateQuotationPdf(data)
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="quotation-${data.quotation.quotationNumber}.pdf"`,
        "Content-Length": String(pdfBuffer.byteLength),
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa quotation pdf error:", error)
    return NextResponse.json({ error: "Failed to generate quotation PDF" }, { status: 500 })
  }
}
