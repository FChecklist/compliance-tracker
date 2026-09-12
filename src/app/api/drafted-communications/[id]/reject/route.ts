import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { rejectCommunication, ServiceError } from "@/lib/services/communication-drafting-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  // R75 Part 2 Phase 5 (G5 misc gap-closure, 2026-09-05): this had NO role
  // gate at all -- while its own sibling decision, ./approve/route.ts,
  // already requires "senior_professional". Reject is the symmetric
  // decision endpoint on the exact same pending_approval resource (both
  // are terminal decisions on a communication about to go out to a real
  // customer/recipient) -- matches approve's own bar rather than inventing
  // a lower one for the opposite decision.
  const roleCheck = requireRole(dbUser, "senior_professional")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const result = await rejectCommunication({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Drafted communication reject error:", error)
    return NextResponse.json({ error: "Failed to reject communication" }, { status: 500 })
  }
}
