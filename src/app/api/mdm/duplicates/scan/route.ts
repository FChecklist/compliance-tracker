import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { scanForDuplicates, ServiceError } from "@/lib/services/mdm-quality-service"

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    if (!body.entityType) return NextResponse.json({ error: "entityType is required" }, { status: 400 })
    const result = await scanForDuplicates({ orgId }, body.entityType)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("MDM duplicate scan error:", error)
    return NextResponse.json({ error: "Failed to scan for duplicates" }, { status: 500 })
  }
}
