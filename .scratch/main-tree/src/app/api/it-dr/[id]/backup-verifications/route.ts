import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { recordBackupVerification, ServiceError } from "@/lib/services/it-dr-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const verification = await recordBackupVerification({ orgId, userId: dbUser.id }, id, body)
    return NextResponse.json(verification, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Backup verification create error:", error)
    return NextResponse.json({ error: "Failed to record backup verification" }, { status: 500 })
  }
}
