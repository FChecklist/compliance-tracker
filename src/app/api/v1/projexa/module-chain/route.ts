// Exposes compliance-tracker's own full chain-selector tree
// (buildCapabilityTree() -- the exact function /api/capability-tree calls
// for the session-authed /chat page) over the API-key-authed
// /api/v1/projexa/* surface, so PROJEXA's chat can offer the same VERI GRC
// AI / VERI ERP / etc top-level module chain its own org would see, scoped
// to whatever VERIDIAN org that PROJEXA org's veridian_credentials row
// points at. Same requireAuthOrApiKey + requireRoleOrScope convention as
// every other /api/v1/projexa/* route (e.g. capability-tree/route.ts).
//
// Deliberately reuses buildCapabilityTree() rather than re-implementing any
// entity-listing query -- this route's only job is auth + shape, all real
// tree assembly (and its tenant scoping via withTenantContext) stays inside
// that one function.
//
// The construction_intelligence branch is filtered out of the response:
// PROJEXA already gets that exact branch from its own dedicated
// /api/v1/projexa/capability-tree (buildConstructionNodes(), Wave 130) --
// returning it here too would just create a second source of truth for the
// one branch PROJEXA already owns.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { buildCapabilityTree } from "@/lib/services/capability-tree-service"

const PROJEXA_OWNED_BRANCH_KEYS = new Set(["construction_intelligence"])

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const moduleScope = request.nextUrl.searchParams.get("module") ?? undefined
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const nodes = await buildCapabilityTree({ orgId: ctx.orgId, moduleScope, userId: actorId })
    return NextResponse.json({ nodes: nodes.filter((n) => !PROJEXA_OWNED_BRANCH_KEYS.has(n.key)) })
  } catch (error) {
    console.error("v1 projexa module-chain error:", error)
    const message = error instanceof Error ? error.message : "Failed to build module chain"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
