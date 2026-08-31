// Intentionally public -- no requireAuth() and no requireAuthOrApiKey() call.
// Token-gated instead (see resolveReportShareLink()'s expiry/revocation
// check). Mirrors /api/veri-meetings/share/[token]/route.ts's exact
// rationale: never add auth here, that would defeat the point of a share
// link. AR-10: this route may RENDER data but must never AUTHORISE a write --
// there is no POST/PATCH/DELETE handler in this file, on purpose.
import { NextResponse } from "next/server"
import { resolveReportShareLink, ServiceError } from "@/lib/services/report-share-service"

type RouteContext = { params: Promise<{ token: string }> }

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { token } = await params
    const result = await resolveReportShareLink(token)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Shared report error:", error)
    return NextResponse.json({ error: "This share link is invalid or has expired" }, { status: 404 })
  }
}
