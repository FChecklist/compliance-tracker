import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listLeaveRequests, requestLeave, ServiceError } from "@/lib/services/hr-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ requests: [] })

  try {
    const userId = request.nextUrl.searchParams.get("userId") || undefined
    const requests = await listLeaveRequests({ orgId }, { userId })
    return NextResponse.json({ requests })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Leave requests list error:", error)
    return NextResponse.json({ error: "Failed to fetch leave requests" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await requestLeave({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Leave request create error:", error)
    return NextResponse.json({ error: "Failed to create leave request" }, { status: 500 })
  }
}
