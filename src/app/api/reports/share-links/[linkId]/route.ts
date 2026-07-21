// audit198 RULE-053 gap closure -- mirrors
// /api/veri-meetings/share-links/[linkId]/route.ts exactly.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { revokeReportShareLink, ServiceError } from "@/lib/services/report-share-service"

type RouteContext = { params: Promise<{ linkId: string }> }

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { linkId } = await params
    const result = await revokeReportShareLink({ orgId, userId: dbUser.id, dbUser }, linkId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report revoke share link error:", error)
    return NextResponse.json({ error: "Failed to revoke share link" }, { status: 500 })
  }
}
