import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listRecentDriveFiles, ServiceError } from "@/lib/services/connector-data-service"

// GET ?maxResults=10 -- real Google Drive file metadata (name/mimeType/
// webViewLink/owner/modifiedTime) pulled through the caller's own connected
// Drive account (D26.B2.S1 / GAP-CONNECTOR-DATA). Distinct from GET
// /api/connectors, which only ever reports connection STATUS -- this route
// makes a real Composio tool-execution call and returns real content.
export async function GET(request: NextRequest) {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || !orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const maxResultsParam = request.nextUrl.searchParams.get("maxResults")

  try {
    const files = await listRecentDriveFiles(
      { orgId, userId: dbUser.id },
      { maxResults: maxResultsParam ? Number(maxResultsParam) : undefined }
    )
    return NextResponse.json({ files })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Drive files fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch Drive files" }, { status: 500 })
  }
}
