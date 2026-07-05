import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getDocumentVersionHistory, ServiceError } from "@/lib/services/document-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ versions: [] })

  try {
    const { id } = await context.params
    const versions = await getDocumentVersionHistory({ orgId }, id)
    return NextResponse.json({ versions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Document version history error:", error)
    return NextResponse.json({ error: "Failed to fetch version history" }, { status: 500 })
  }
}
