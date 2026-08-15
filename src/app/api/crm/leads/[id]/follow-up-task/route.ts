import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createFollowUpTaskFromLead, ServiceError } from "@/lib/services/crm-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    // GP-20 (task-dependency-graph cycle detection): optional -- set when
    // this follow-up is being raised while working an existing task, so the
    // new escalation edge (and its cycle check) has a real ancestor to
    // attach to. Omitted entirely, this behaves exactly as before.
    const body = await request.json().catch(() => ({}))
    const fromTaskId = typeof body?.fromTaskId === "string" ? body.fromTaskId : undefined
    const result = await createFollowUpTaskFromLead({ orgId, userId: dbUser.id }, id, fromTaskId)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM lead follow-up task error:", error)
    return NextResponse.json({ error: "Failed to create follow-up task" }, { status: 500 })
  }
}
