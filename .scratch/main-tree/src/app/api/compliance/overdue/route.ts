import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { syncOverdue } from "@/lib/services/compliance-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ updated: 0, updatedAt: new Date().toISOString() })

  try {
    const result = await syncOverdue({ orgId: ctx.orgId })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Overdue sync error:", error)
    return NextResponse.json({ error: "Failed to sync overdue status" }, { status: 500 })
  }
}
