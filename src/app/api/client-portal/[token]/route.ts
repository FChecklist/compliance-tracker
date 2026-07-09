import { NextRequest, NextResponse } from "next/server"
import { getClientPortalData, ServiceError } from "@/lib/services/firm-client-portal-service"

// Public route (no auth) -- resolves a client portal token, same
// established pattern as /api/vendor-portal/[token] and /api/guest-chat/[token].
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const data = await getClientPortalData(token)
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Client portal data error:", error)
    return NextResponse.json({ error: "Failed to load client portal" }, { status: 500 })
  }
}
