import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { reactToPost, ServiceError } from "@/lib/services/social-feed-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // R75 Part 2 Phase 5 (G8-misc): same gap and fix as POST /api/social/posts
  // (see its comment) -- "member".
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const result = await reactToPost({ orgId, userId: dbUser.id }, id, body.reactionType)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Post reaction error:", error)
    return NextResponse.json({ error: "Failed to react to post" }, { status: 500 })
  }
}
