import { NextRequest, NextResponse } from "next/server"
import { getSigningSession, ServiceError } from "@/lib/services/esignature-service"

// Public route (no auth) -- resolves the signer's tokenized link, same
// RLS-bypass rationale as the guest-chat/vendor-portal public pages.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const session = await getSigningSession(token)
    return NextResponse.json(session)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Signing session error:", error)
    return NextResponse.json({ error: "Failed to load signing session" }, { status: 500 })
  }
}
