import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { mergeDuplicates, ServiceError } from "@/lib/services/mdm-quality-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    if (!body.survivingEntityId) return NextResponse.json({ error: "survivingEntityId is required" }, { status: 400 })
    const log = await mergeDuplicates({ orgId, userId: dbUser.id, dbUser }, id, body.survivingEntityId)
    return NextResponse.json(log)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("MDM merge error:", error)
    return NextResponse.json({ error: "Failed to merge duplicate entities" }, { status: 500 })
  }
}
