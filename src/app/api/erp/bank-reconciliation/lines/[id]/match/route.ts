import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { matchLine, ServiceError } from "@/lib/services/erp-bank-reconciliation-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const { journalEntryId } = await request.json()
    if (!journalEntryId) return NextResponse.json({ error: "journalEntryId is required" }, { status: 400 })
    const line = await matchLine({ orgId, userId: dbUser.id, dbUser }, id, journalEntryId)
    return NextResponse.json(line)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Match line error:", error)
    return NextResponse.json({ error: "Failed to match line" }, { status: 500 })
  }
}
