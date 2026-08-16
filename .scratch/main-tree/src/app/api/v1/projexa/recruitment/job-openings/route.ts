// Priority 15 (PROJEXA HR & Payroll, Wave 1): thin ALIASING route over
// recruitment-service.ts's real ATS (job openings -> candidates ->
// applications -> stage pipeline).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listJobOpenings, createJobOpening, ServiceError } from "@/lib/services/recruitment-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ jobOpenings: [] })

  try {
    const jobOpenings = await listJobOpenings({ orgId: ctx.orgId })
    return NextResponse.json({ jobOpenings })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa job openings list error:", error)
    return NextResponse.json({ error: "Failed to fetch job openings" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json()
    const opening = await createJobOpening({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(opening, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa job opening create error:", error)
    return NextResponse.json({ error: "Failed to create job opening" }, { status: 500 })
  }
}
