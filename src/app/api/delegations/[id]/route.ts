import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { revokeDelegation } from "@/lib/services/delegation-service"

// Wave 173 (GAP-DELEGATION-AUTHORITY). DELETE revokes -- revokeDelegation()
// itself enforces that only the original delegator may revoke (see that
// function's own header), this route just surfaces its result as HTTP.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const { id } = await params
  try {
    const result = await revokeDelegation({ orgId, userId: dbUser.id }, id)
    if (!result.ok) {
      const status = result.reason === "Delegation not found" ? 404 : 403
      return NextResponse.json({ error: result.reason }, { status })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Delegation revoke error:", error)
    return NextResponse.json({ error: "Failed to revoke delegation" }, { status: 500 })
  }
}
