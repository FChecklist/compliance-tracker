// R39/R-C14: Architect/Site Instruction (SI) record -- SCHEMA-ASSUMED-
// INDUSTRY-STANDARD, see construction-site-instruction-service.ts. Same
// auth pattern as the sibling v1/construction routes.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { createSiteInstruction, listSiteInstructions, ServiceError } from "@/lib/services/construction-site-instruction-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const siteInstructions = await listSiteInstructions({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ siteInstructions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction site-instructions list error:", error)
    return NextResponse.json({ error: "Failed to fetch site instructions" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!actorId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const row = await createSiteInstruction({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction site-instructions create error:", error)
    return NextResponse.json({ error: "Failed to create site instruction" }, { status: 500 })
  }
}
