import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { revokeClientPortalLink, ServiceError } from "@/lib/services/firm-client-portal-service"

export async function POST(_req: NextRequest, ctx: { params: Promise<{ linkId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { linkId } = await ctx.params
    const link = await revokeClientPortalLink({ orgId, userId: dbUser.id, dbUser }, linkId)
    return NextResponse.json({ link })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Revoke client portal link error:", error)
    return NextResponse.json({ error: "Failed to revoke portal link" }, { status: 500 })
  }
}
