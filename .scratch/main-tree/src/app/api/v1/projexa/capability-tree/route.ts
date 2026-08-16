// Wave 130: exposes buildConstructionNodes()'s subtree (Wave 128) over the
// API-key-authed /api/v1/projexa/* surface so PROJEXA's own Chain Selector
// UI can walk it, the same tree VeriComposer walks internally via the
// session-authed /api/capability-tree. Deliberately calls the construction
// builder directly rather than buildCapabilityTree() -- PROJEXA must never
// see GST/compliance/other product nodes, only its own (see assistant/route.ts
// for the matching principle on the dispatch side).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { buildConstructionNodes } from "@/lib/services/capability-tree-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const nodes = await withTenantContext({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id }, (db) =>
      buildConstructionNodes(db, ctx.orgId!)
    )
    return NextResponse.json({ nodes })
  } catch (error) {
    console.error("v1 projexa capability-tree error:", error)
    const message = error instanceof Error ? error.message : "Failed to build construction capability tree"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
