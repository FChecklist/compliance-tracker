import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listProblemRecords, createProblemRecord, ServiceError } from "@/lib/services/ticket-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ problems: [] })

  try {
    const problems = await listProblemRecords({ orgId })
    return NextResponse.json({ problems })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Problem records list error:", error)
    return NextResponse.json({ error: "Failed to fetch problem records" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const problem = await createProblemRecord({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(problem, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Problem record create error:", error)
    return NextResponse.json({ error: "Failed to create problem record" }, { status: 500 })
  }
}
