import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { createPortalLink, listPortalLinks, ServiceError } from "@/lib/services/erp-vendor-master-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ portalLinks: [] })

  try {
    const { id } = await params
    const portalLinks = await listPortalLinks({ orgId }, id)
    return NextResponse.json({ portalLinks })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier portal links list error:", error)
    return NextResponse.json({ error: "Failed to fetch portal links" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const link = await createPortalLink({ orgId, userId: dbUser.id }, id, body.expiresInHours || undefined)
    return NextResponse.json(link, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier portal link create error:", error)
    return NextResponse.json({ error: "Failed to create portal link" }, { status: 500 })
  }
}
