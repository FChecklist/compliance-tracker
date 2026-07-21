import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createActivity, listActivitiesForEntity, ServiceError, type CrmActivityEntityType } from "@/lib/services/crm-activities-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json([])

  try {
    const { searchParams } = new URL(request.url)
    const entityType = searchParams.get("entityType") as CrmActivityEntityType | null
    const entityId = searchParams.get("entityId")
    if (!entityType || !entityId) return NextResponse.json({ error: "entityType and entityId query params are required" }, { status: 400 })
    const activities = await listActivitiesForEntity({ orgId }, entityType, entityId)
    return NextResponse.json(activities)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM activities list error:", error)
    return NextResponse.json({ error: "Failed to fetch activities" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const activity = await createActivity({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(activity, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM activity create error:", error)
    return NextResponse.json({ error: "Failed to create activity" }, { status: 500 })
  }
}
