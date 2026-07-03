import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listMyInstructionMismatches } from "@/lib/services/chat-service"

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ mismatches: [] })

  try {
    const result = await listMyInstructionMismatches({ orgId, userId: dbUser.id })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Instruction mismatches list error:", error)
    return NextResponse.json({ error: "Failed to fetch instruction mismatches" }, { status: 500 })
  }
}
