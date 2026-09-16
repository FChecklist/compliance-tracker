// Public, token-in-URL, no session -- the same TOKEN_SCOPED shape as
// p/[token]/route.ts. Returns plain text (not JSON) because the whole
// point is that any AI chatbox can read it directly, no parsing.
import { NextRequest, NextResponse } from "next/server"
import { resolveAiLinkSnapshot } from "@/lib/services/dpdp-ai-link-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const snapshot = await resolveAiLinkSnapshot(token, request.headers.get("user-agent"), request.headers.get("x-forwarded-for"))
    if (!snapshot) return new NextResponse("This link is not valid or has expired.", { status: 404 })
    return new NextResponse(snapshot, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
  } catch {
    return new NextResponse("Could not open that link.", { status: 500 })
  }
}
