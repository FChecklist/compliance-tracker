// Intentionally public -- no requireAuth() call. Token-gated instead (see
// getReportByShareToken()'s expiry/revocation check and its schema-level
// snapshot-only security note). Mirrors /api/veri-meetings/share/[token]'s
// exact rationale.
import { NextResponse } from "next/server"
import { getReportByShareToken, ServiceError } from "@/lib/services/report-share-service"

type RouteContext = { params: Promise<{ token: string }> }

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { token } = await params
    const result = await getReportByShareToken(token)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Shared report error:", error)
    return NextResponse.json({ error: "This share link is invalid or has expired" }, { status: 404 })
  }
}
