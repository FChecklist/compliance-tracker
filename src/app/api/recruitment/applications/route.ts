import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listApplications, createApplication, ServiceError } from "@/lib/services/recruitment-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ applications: [] })

  try {
    const { searchParams } = new URL(request.url)
    const jobOpeningId = searchParams.get("jobOpeningId") || undefined
    const candidateId = searchParams.get("candidateId") || undefined
    const applications = await listApplications({ orgId }, { jobOpeningId, candidateId })
    return NextResponse.json({ applications })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Applications list error:", error)
    return NextResponse.json({ error: "Failed to fetch applications" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const application = await createApplication({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(application, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Application create error:", error)
    return NextResponse.json({ error: "Failed to create application" }, { status: 500 })
  }
}
