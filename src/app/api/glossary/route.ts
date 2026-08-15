import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listGlossaryTerms, createGlossaryTerm, ServiceError } from "@/lib/services/glossary-service"
import { serviceErrorBody } from "@/lib/services/compliance-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ terms: [] })

  try {
    const terms = await listGlossaryTerms({ orgId })
    return NextResponse.json({ terms })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json(serviceErrorBody(error), { status: error.status })
    console.error("Glossary list API error:", error)
    return NextResponse.json({ error: "Failed to fetch glossary terms" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const term = await createGlossaryTerm({ orgId }, body)
    return NextResponse.json(term, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json(serviceErrorBody(error), { status: error.status })
    console.error("Glossary create API error:", error)
    return NextResponse.json({ error: "Failed to create glossary term" }, { status: 500 })
  }
}
