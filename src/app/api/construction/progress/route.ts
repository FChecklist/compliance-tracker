import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listProgressEntries, createProgressEntry, ServiceError } from "@/lib/services/construction-progress-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ entries: [] })

  try {
    const entries = await listProgressEntries({ orgId }, {
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      activityId: request.nextUrl.searchParams.get("activityId") ?? undefined,
    })
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction progress list error:", error)
    return NextResponse.json({ error: "Failed to fetch progress entries" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createProgressEntry({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction progress entry create error:", error)
    return NextResponse.json({ error: "Failed to create progress entry" }, { status: 500 })
  }
}
