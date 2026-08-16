import { NextRequest, NextResponse } from "next/server"
import { submitSignature, ServiceError } from "@/lib/services/esignature-service"

function extractIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]!.trim()
  return request.headers.get("x-real-ip") ?? undefined
}

// Public route (no auth) -- submitSignature() enforces token validity,
// sign-order sequencing, and recomputes the document hash at signing time.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const body = await request.json()
    const signer = await submitSignature(token, {
      signatureImageData: body.signatureImageData,
      signatureMethod: body.signatureMethod,
      ipAddress: extractIp(request),
      userAgent: request.headers.get("user-agent") ?? undefined,
    })
    return NextResponse.json(signer)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Signature submit error:", error)
    return NextResponse.json({ error: "Failed to submit signature" }, { status: 500 })
  }
}
