import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { linkMatterEntity, ServiceError } from "@/lib/services/legal-matter-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    if (!["litigation", "ip", "opinion"].includes(body.entityType)) return NextResponse.json({ error: "entityType must be litigation, ip, or opinion" }, { status: 400 })
    if (!body.entityId) return NextResponse.json({ error: "entityId is required" }, { status: 400 })
    const result = await linkMatterEntity({ orgId }, id, body.entityType, body.entityId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Legal matter link error:", error)
    return NextResponse.json({ error: "Failed to link entity to matter" }, { status: 500 })
  }
}
