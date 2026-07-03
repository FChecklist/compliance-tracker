import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getPmsEnablement, enablePmsForOrg, disablePmsForOrg, ServiceError } from "@/lib/services/pms-enablement-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ isEnabled: false, enabledAt: null, disabledAt: null })

  const result = await getPmsEnablement({ orgId })
  return NextResponse.json(result)
}

export async function POST() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const result = await enablePmsForOrg({ orgId, userId: dbUser.id, dbUser })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS enable error:", error)
    return NextResponse.json({ error: "Failed to enable VERIDIAN AI PMS" }, { status: 500 })
  }
}

export async function DELETE() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const result = await disablePmsForOrg({ orgId, userId: dbUser.id, dbUser })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS disable error:", error)
    return NextResponse.json({ error: "Failed to disable VERIDIAN AI PMS" }, { status: 500 })
  }
}
