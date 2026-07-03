import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getNoticeStats } from "@/lib/services/notice-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) {
    return NextResponse.json({ total: 0, pendingReplies: 0, overdue: 0, replied: 0, closed: 0, appealed: 0, received: 0, inProgress: 0 })
  }
  try {
    const result = await getNoticeStats({ orgId: ctx.orgId })
    return NextResponse.json(result)
  } catch (error) {
    console.error("v1 notice stats error:", error)
    return NextResponse.json({ error: "Failed to fetch notice stats" }, { status: 500 })
  }
}
