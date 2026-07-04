import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createMeetingShareLink, listMeetingShareLinks, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ links: [] })

  try {
    const { id } = await params
    const links = await listMeetingShareLinks({ orgId }, id)
    return NextResponse.json({ links })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Meetings list share links error:", error)
    return NextResponse.json({ error: "Failed to fetch share links" }, { status: 500 })
  }
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const link = await createMeetingShareLink({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(link, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Meetings create share link error:", error)
    return NextResponse.json({ error: "Failed to create share link" }, { status: 500 })
  }
}
