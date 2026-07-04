import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listJournalEntries, createJournalEntry, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ entries: [] })

  try {
    const status = request.nextUrl.searchParams.get("status") || undefined
    const entries = await listJournalEntries({ orgId }, { status })
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Journal entries list error:", error)
    return NextResponse.json({ error: "Failed to fetch journal entries" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const entry = await createJournalEntry({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Journal entry create error:", error)
    return NextResponse.json({ error: "Failed to create journal entry" }, { status: 500 })
  }
}
