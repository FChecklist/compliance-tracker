import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { generateOpinionDraft, ServiceError } from "@/lib/services/legal-opinion-service"

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await ctx.params
    const body = await req.json()
    if (!body.templateId) return NextResponse.json({ error: "templateId is required" }, { status: 400 })
    const opinion = await generateOpinionDraft({ orgId, userId: dbUser.id, dbUser }, id, body.templateId, body.tokens ?? {}, body.includeOptionalClauseIds)
    return NextResponse.json({ opinion })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Generate legal opinion draft error:", error)
    return NextResponse.json({ error: "Failed to generate opinion draft" }, { status: 500 })
  }
}
