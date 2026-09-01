import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { disposeDocument, ServiceError } from "@/lib/services/document-service"

// Real-screen conversion (2026-08-30): exposes the already-existing
// disposeDocument() -- the real "remove this" action for a document. A real
// gate, not a UI-only checkbox: refuses unless the document's own retention
// policy has actually lapsed and it isn't under legal hold (see that
// function's own doc comment in document-service.ts). Mirrors the internal
// api/documents/[id]/dispose/route.ts's manager-role gate.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const doc = await disposeDocument({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id }, id)
    return NextResponse.json(doc)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa document dispose error:", error)
    return NextResponse.json({ error: "Failed to dispose document" }, { status: 500 })
  }
}
