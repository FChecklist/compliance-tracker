import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getLead, updateLead, deleteLead, ServiceError } from "@/lib/services/crm-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const lead = await getLead({ orgId }, id)
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 })
    return NextResponse.json(lead)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM lead get error:", error)
    return NextResponse.json({ error: "Failed to fetch lead" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const { stageChangeNote, ...patch } = body ?? {}
    const lead = await updateLead({ orgId, userId: dbUser.id, role: dbUser.role }, id, patch, stageChangeNote)
    return NextResponse.json(lead)
  } catch (error) {
    // VERIDIAN Review Framework gap-closure, "Error Handling & Data
    // Validation Messaging": ServiceError.fields (Zod issues / invalid
    // transition) is surfaced as `fields` alongside the existing `error`
    // string -- additive, existing callers that only read `error` see no
    // change.
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message, fields: error.fields }, { status: error.status })
    console.error("CRM lead update error:", error)
    return NextResponse.json({ error: "Failed to update lead" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await deleteLead({ orgId, userId: dbUser.id, role: dbUser.role }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM lead delete error:", error)
    return NextResponse.json({ error: "Failed to delete lead" }, { status: 500 })
  }
}
