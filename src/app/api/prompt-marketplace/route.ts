import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listMarketplaceListings, publishToMarketplace, ServiceError } from "@/lib/services/prompt-marketplace-service"

// VERIDIAN_Architecture_v2.0 phase_8: engine-prompt-marketplace.
export async function GET() {
  const { response } = await requireAuth()
  if (response) return response

  try {
    const listings = await listMarketplaceListings()
    return NextResponse.json({ listings })
  } catch (error) {
    console.error("Prompt marketplace list error:", error)
    return NextResponse.json({ error: "Failed to fetch marketplace listings" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "No user found" }, { status: 400 })

  const roleCheck = requireRole(dbUser, "admin")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const result = await publishToMarketplace({ userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Prompt marketplace publish error:", error)
    return NextResponse.json({ error: "Failed to publish marketplace listing" }, { status: 500 })
  }
}
