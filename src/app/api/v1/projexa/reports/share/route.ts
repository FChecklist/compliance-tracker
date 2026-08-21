// Point 118: authenticated (Bearer key or session) creation of a public,
// read-only share link. Resolving the token itself happens on a SEPARATE,
// intentionally-public route -- see /api/reports/share/[token]/route.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { createReportShareLink, ServiceError } from "@/lib/services/report-share-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!ctx.orgId || !actorId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const link = await createReportShareLink(
      { orgId: ctx.orgId, userId: actorId },
      { reportType: body.reportType, reportRef: body.reportRef, expiresInHours: body.expiresInHours }
    )
    return NextResponse.json({ token: link.token, expiresAt: link.expiresAt }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa report share create error:", error)
    return NextResponse.json({ error: "Failed to create share link" }, { status: 500 })
  }
}
