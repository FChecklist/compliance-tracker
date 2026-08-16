import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createClientPortalLink, listClientPortalLinks, ServiceError } from "@/lib/services/firm-client-portal-service"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { clientId } = await ctx.params
    const links = await listClientPortalLinks({ orgId, userId: dbUser.id, dbUser }, clientId)
    return NextResponse.json({ links })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("List client portal links error:", error)
    return NextResponse.json({ error: "Failed to list portal links" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { clientId } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const link = await createClientPortalLink({ orgId, userId: dbUser.id, dbUser }, clientId, body.expiresInDays)
    return NextResponse.json({ link }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Create client portal link error:", error)
    return NextResponse.json({ error: "Failed to create portal link" }, { status: 500 })
  }
}
