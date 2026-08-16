import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listActivities, createActivity, ServiceError } from "@/lib/services/construction-progress-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ activities: [] })

  try {
    const activities = await listActivities({ orgId }, {
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      categoryId: request.nextUrl.searchParams.get("categoryId") ?? undefined,
    })
    return NextResponse.json({ activities })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction activities list error:", error)
    return NextResponse.json({ error: "Failed to fetch activities" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createActivity({ orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction activity create error:", error)
    return NextResponse.json({ error: "Failed to create activity" }, { status: 500 })
  }
}
