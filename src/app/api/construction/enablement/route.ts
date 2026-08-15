import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getConstructionEnablement, enableConstructionForOrg, disableConstructionForOrg, ServiceError } from "@/lib/services/construction-enablement-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ isEnabled: false, enabledAt: null, disabledAt: null })

  const result = await getConstructionEnablement({ orgId })
  return NextResponse.json(result)
}

export async function POST() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const result = await enableConstructionForOrg({ orgId, userId: dbUser.id, dbUser })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction enable error:", error)
    return NextResponse.json({ error: "Failed to enable Construction" }, { status: 500 })
  }
}

export async function DELETE() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const result = await disableConstructionForOrg({ orgId, userId: dbUser.id, dbUser })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction disable error:", error)
    return NextResponse.json({ error: "Failed to disable Construction" }, { status: 500 })
  }
}
