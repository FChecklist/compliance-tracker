import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled, ServiceError } from "@/lib/services/pms-enablement-service"
import { listIssueTypes, createIssueType } from "@/lib/services/pms-taxonomy-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ issueTypes: [] })

  try {
    await requirePmsEnabled(orgId)
    const issueTypes = await listIssueTypes({ orgId })
    return NextResponse.json({ issueTypes })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS issue-types list error:", error)
    return NextResponse.json({ error: "Failed to fetch issue types" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const body = await request.json()
    const result = await createIssueType({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS issue-type create error:", error)
    return NextResponse.json({ error: "Failed to create issue type" }, { status: 500 })
  }
}
