import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { getSsoConfiguration, upsertSsoConfiguration, ServiceError } from "@/lib/services/sso-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ configuration: null })

  try {
    const configuration = await getSsoConfiguration({ orgId })
    return NextResponse.json({ configuration })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("SSO configuration fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch SSO configuration" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const roleError = requireRole(dbUser, "admin")
  if (roleError) return roleError

  try {
    const body = await request.json()
    const configuration = await upsertSsoConfiguration({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(configuration)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("SSO configuration save error:", error)
    return NextResponse.json({ error: "Failed to save SSO configuration" }, { status: 500 })
  }
}
