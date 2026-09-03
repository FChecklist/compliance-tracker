// R67 D-15 (audit R-040). "Replace file" on PROJEXA's document object page.
//
// The versioning columns have existed since Wave 61 and are already maintained
// (parentDocumentId / versionNumber / isLatestVersion, flipped inside one
// transaction by markSupersededVersion). The internal, cookie-session route
// POST /api/documents has driven them through its `versionOfId` form field ever
// since. Nothing on the Bearer-key /api/v1/projexa surface PROJEXA actually
// calls ever exposed them -- so a file uploaded by mistake could only be
// disposed, and Dispose is retention-gated and therefore refused for exactly the
// fresh upload someone wants to fix.
//
// Multipart, not JSON: this carries file bytes. Same shape as the drawings and
// permits upload routes.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { createDocumentVersion, ServiceError } from "@/lib/services/document-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 })

    // R39/R-C14: ctx.apiKey?.id is not a real compliance.users row, so null is
    // the honest value for "who uploaded this" on an API-key call.
    const doc = await createDocumentVersion({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? null }, id, { file })
    return NextResponse.json(doc, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa document version create error:", error)
    return NextResponse.json({ error: "Failed to replace document file" }, { status: 500 })
  }
}
