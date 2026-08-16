import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listCandidates, createCandidate, ServiceError } from "@/lib/services/recruitment-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ candidates: [] })

  try {
    const candidates = await listCandidates({ orgId })
    return NextResponse.json({ candidates })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Candidates list error:", error)
    return NextResponse.json({ error: "Failed to fetch candidates" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const candidate = await createCandidate({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(candidate, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Candidate create error:", error)
    return NextResponse.json({ error: "Failed to create candidate" }, { status: 500 })
  }
}
