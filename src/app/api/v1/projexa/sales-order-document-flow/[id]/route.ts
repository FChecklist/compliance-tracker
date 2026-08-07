// SD-007 (SAP VBFA "Display Document Flow" equivalent, sap_mapping.sqlite
// gap analysis, BUILD_NEW/HIGH): thin route over erp-selling-service.ts's
// getSalesOrderDocumentFlow -- given one sales order id, the full real
// document chain already linked to it (quotation -> sales order -> sales
// invoice(s) -> payment entries / credit notes / sales returns), using only
// foreign keys that already exist on this table set (no new schema).
//
// Distinct from PR #629's /api/construction/progress-claims/[id]/timeline
// route, which traces the separate construction_progress_claims workflow --
// see erp-selling-service.ts's getSalesOrderDocumentFlow header comment and
// ai-os/boss/ACTIVE-CLAIMS.yaml for the full collision note.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getSalesOrderDocumentFlow } from "@/lib/services/erp-selling-service"
import { ServiceError } from "@/lib/services/compliance-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const flow = await getSalesOrderDocumentFlow({ orgId: ctx.orgId }, id)
    return NextResponse.json(flow)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-order-document-flow error:", error)
    return NextResponse.json({ error: "Failed to generate sales order document flow" }, { status: 500 })
  }
}
