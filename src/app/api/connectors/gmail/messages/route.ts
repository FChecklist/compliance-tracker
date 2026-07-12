import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listRecentGmailMessages, ServiceError } from "@/lib/services/connector-data-service"

// GET ?maxResults=10&query=... -- real Gmail message data (subject/snippet/
// timestamp) pulled through the caller's own connected Gmail account
// (D26.B2.S1 / GAP-CONNECTOR-DATA). Distinct from GET /api/connectors, which
// only ever reports connection STATUS -- this route makes a real Composio
// tool-execution call and returns real content.
export async function GET(request: NextRequest) {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || !orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const maxResultsParam = request.nextUrl.searchParams.get("maxResults")
  const query = request.nextUrl.searchParams.get("query") ?? undefined

  try {
    const messages = await listRecentGmailMessages(
      { orgId, userId: dbUser.id },
      { maxResults: maxResultsParam ? Number(maxResultsParam) : undefined, query }
    )
    return NextResponse.json({ messages })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Gmail messages fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch Gmail messages" }, { status: 500 })
  }
}
