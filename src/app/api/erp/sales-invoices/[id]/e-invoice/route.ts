import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listEInvoiceLogs, generateEInvoicePayload, ServiceError } from "@/lib/services/erp-einvoice-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ logs: [] })

  try {
    const { id } = await params
    const logs = await listEInvoiceLogs({ orgId }, id)
    return NextResponse.json({ logs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("E-invoice logs list error:", error)
    return NextResponse.json({ error: "Failed to fetch e-invoice logs" }, { status: 500 })
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const log = await generateEInvoicePayload({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(log, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("E-invoice payload generate error:", error)
    return NextResponse.json({ error: "Failed to generate e-invoice payload" }, { status: 500 })
  }
}
