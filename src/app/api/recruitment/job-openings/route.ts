import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listJobOpenings, createJobOpening, ServiceError } from "@/lib/services/recruitment-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ jobOpenings: [] })

  try {
    const jobOpenings = await listJobOpenings({ orgId })
    return NextResponse.json({ jobOpenings })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Job openings list error:", error)
    return NextResponse.json({ error: "Failed to fetch job openings" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const opening = await createJobOpening({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(opening, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Job opening create error:", error)
    return NextResponse.json({ error: "Failed to create job opening" }, { status: 500 })
  }
}
