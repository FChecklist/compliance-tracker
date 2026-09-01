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
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    // R38 (R-C15 fix): NOT ctx.dbUser?.id ?? ctx.apiKey?.id -- an API key's
    // id is never a real `users` row, and created_by_id used to have a
    // strict NOT NULL FK to `users`, so every API-key-authenticated request
    // (the real production shape for PROJEXA's server-to-server calls) 500'd
    // on this exact insert. null is now a valid, real "created by an API
    // key, not a person" value (see schema.ts's createdById comment).
    const link = await createReportShareLink(
      { orgId: ctx.orgId, userId: ctx.dbUser?.id ?? null },
      { reportType: body.reportType, reportRef: body.reportRef, expiresInHours: body.expiresInHours }
    )
    return NextResponse.json({ token: link.token, expiresAt: link.expiresAt }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa report share create error:", error)
    return NextResponse.json({ error: "Failed to create share link" }, { status: 500 })
  }
}
