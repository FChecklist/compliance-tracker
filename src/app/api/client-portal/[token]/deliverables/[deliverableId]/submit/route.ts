import { NextRequest, NextResponse } from "next/server"
import { markDeliverableSubmittedViaPortal, ServiceError } from "@/lib/services/firm-client-portal-service"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string; deliverableId: string }> }) {
  try {
    const { token, deliverableId } = await params
    const deliverable = await markDeliverableSubmittedViaPortal(token, deliverableId)
    return NextResponse.json({ deliverable })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Client portal deliverable submit error:", error)
    return NextResponse.json({ error: "Failed to submit deliverable" }, { status: 500 })
  }
}
