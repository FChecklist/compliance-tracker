// Priority 16 Part 2 (PROJEXA-SCHEDULE-NO-CREATE-UI): thin alias over
// pms-taxonomy-service.ts's listIssueTypes() -- lets PROJEXA's "New Task"
// dialog populate a real type dropdown (Task/Bug/Story/...) instead of the
// create route silently guessing a default with no user-visible choice.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listIssueTypes } from "@/lib/services/pms-taxonomy-service"
import { ServiceError } from "@/lib/services/pms-issue-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ types: [] })

  try {
    const types = await listIssueTypes({ orgId: ctx.orgId })
    return NextResponse.json({ types })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa schedule types list error:", error)
    return NextResponse.json({ error: "Failed to fetch issue types" }, { status: 500 })
  }
}
