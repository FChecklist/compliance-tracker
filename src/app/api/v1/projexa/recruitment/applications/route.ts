// Priority 15 (PROJEXA HR & Payroll, Wave 1): application (candidate x job
// opening) list + create. Interview scheduling/feedback and the hired->
// employee link are deliberately deferred to a follow-up wave -- see PR
// description.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listApplications, createApplication, ServiceError } from "@/lib/services/recruitment-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ applications: [] })

  try {
    const jobOpeningId = request.nextUrl.searchParams.get("jobOpeningId") || undefined
    const candidateId = request.nextUrl.searchParams.get("candidateId") || undefined
    const applications = await listApplications({ orgId: ctx.orgId }, { jobOpeningId, candidateId })
    return NextResponse.json({ applications })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa applications list error:", error)
    return NextResponse.json({ error: "Failed to fetch applications" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json()
    const application = await createApplication({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(application, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa application create error:", error)
    return NextResponse.json({ error: "Failed to create application" }, { status: 500 })
  }
}
