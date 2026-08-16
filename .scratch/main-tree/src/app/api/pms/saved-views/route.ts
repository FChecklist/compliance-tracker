import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled, ServiceError } from "@/lib/services/pms-enablement-service"
import { listSavedViews, createSavedView } from "@/lib/services/pms-view-service"

export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ savedViews: [] })

  const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined

  try {
    await requirePmsEnabled(orgId)
    const savedViews = await listSavedViews({ orgId, userId: dbUser.id }, projectId)
    return NextResponse.json({ savedViews })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS saved-views list error:", error)
    return NextResponse.json({ error: "Failed to fetch saved views" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const body = await request.json()
    const result = await createSavedView({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS saved-view create error:", error)
    return NextResponse.json({ error: "Failed to create saved view" }, { status: 500 })
  }
}
