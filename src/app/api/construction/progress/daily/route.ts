import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getDailyProgressReport, dailyProgressReportLinkId, ServiceError } from "@/lib/services/construction-progress-service"
import { createDocumentRecord } from "@/lib/services/document-service"

// R48 gap-closure (2026-08-29, F039: "Daily progress report with photos").
// GET returns the day's progress entries + any photos already attached;
// POST attaches a new photo to that (projectId, date) key. See
// construction-progress-service.ts's getDailyProgressReport()/
// dailyProgressReportLinkId() for why this needs no separate "report" row.
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  const date = request.nextUrl.searchParams.get("date")
  if (!projectId || !date) return NextResponse.json({ error: "projectId and date query params are required" }, { status: 400 })

  try {
    const report = await getDailyProgressReport({ orgId }, projectId, date)
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Daily progress report error:", error)
    return NextResponse.json({ error: "Failed to load daily progress report" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const formData = await request.formData()
    const projectId = (formData.get("projectId") as string | null)?.trim()
    const date = (formData.get("date") as string | null)?.trim()
    const file = formData.get("file")
    if (!projectId || !date) return NextResponse.json({ error: "projectId and date are required" }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: "A photo file is required" }, { status: 400 })

    const doc = await createDocumentRecord({ orgId, userId: dbUser?.id ?? null }, {
      name: (formData.get("name") as string | null) || file.name,
      file, category: "progress_photo",
      linkedEntityType: "progress_daily_report",
      linkedEntityId: dailyProgressReportLinkId(projectId, date),
    })
    return NextResponse.json(doc, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Daily progress photo upload error:", error)
    return NextResponse.json({ error: "Failed to upload photo" }, { status: 500 })
  }
}
