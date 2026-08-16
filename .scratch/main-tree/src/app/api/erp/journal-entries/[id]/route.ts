import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getJournalEntry, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const entry = await getJournalEntry({ orgId }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Journal entry get error:", error)
    return NextResponse.json({ error: "Failed to fetch journal entry" }, { status: 500 })
  }
}
