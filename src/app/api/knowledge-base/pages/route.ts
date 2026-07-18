import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listKbPages, createKbPage, ServiceError } from "@/lib/services/knowledge-base-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ pages: [] })

  try {
    const pages = await listKbPages({ orgId })
    return NextResponse.json({ pages })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Knowledge base list error:", error)
    return NextResponse.json({ error: "Failed to fetch knowledge base pages" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createKbPage({ orgId, userId: dbUser.id, isRealUser: true }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Knowledge base create error:", error)
    return NextResponse.json({ error: "Failed to create knowledge base page" }, { status: 500 })
  }
}
