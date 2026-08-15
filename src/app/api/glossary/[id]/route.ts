import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateGlossaryTerm, deleteGlossaryTerm, ServiceError } from "@/lib/services/glossary-service"
import { serviceErrorBody } from "@/lib/services/compliance-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const term = await updateGlossaryTerm({ orgId }, id, body)
    return NextResponse.json(term)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json(serviceErrorBody(error), { status: error.status })
    console.error("Glossary update API error:", error)
    return NextResponse.json({ error: "Failed to update glossary term" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const result = await deleteGlossaryTerm({ orgId }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json(serviceErrorBody(error), { status: error.status })
    console.error("Glossary delete API error:", error)
    return NextResponse.json({ error: "Failed to delete glossary term" }, { status: 500 })
  }
}
