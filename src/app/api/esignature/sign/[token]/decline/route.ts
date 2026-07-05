import { NextRequest, NextResponse } from "next/server"
import { declineSignature, ServiceError } from "@/lib/services/esignature-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const body = await request.json().catch(() => ({}))
    const signer = await declineSignature(token, body.reason)
    return NextResponse.json(signer)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Signature decline error:", error)
    return NextResponse.json({ error: "Failed to decline signature" }, { status: 500 })
  }
}
