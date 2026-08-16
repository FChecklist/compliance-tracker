import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createBoqRevision, ServiceError } from "@/lib/services/construction-boq-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await createBoqRevision({ orgId, userId: dbUser.id }, id, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction BOQ revision create error:", error)
    return NextResponse.json({ error: "Failed to create BOQ revision" }, { status: 500 })
  }
}
