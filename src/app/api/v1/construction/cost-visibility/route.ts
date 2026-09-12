// R85 Addendum 3 v4 Phase 6 -- VISIBILITY AND THE CLIENT BOUNDARY, gates
// 6-01/6-02. The cost-visibility config API: GET lists every configurable
// role (client_viewer is NEVER included -- see CONFIGURABLE_ROLES in
// cost-visibility-service.ts, the second of the three independent layers
// this phase builds against a client_viewer grant: the DB CHECK constraint,
// this route never listing it as an option, and setCostVisibilityForRole's
// own application-layer refusal below/inside that service). PATCH grants or
// revokes one role's cost visibility for the caller's org.
//
// Gated at "admin" for PATCH (this is, per the work order, "the single most
// important line of defense in this phase" alongside the DB constraint --
// a materially higher bar than the "member"/"manager" gates most BOQ write
// routes in this file's own sibling routes use) and "manager" for GET
// (viewing which roles are currently granted does not itself expose any
// cost figure, only role names and booleans).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import {
  listCostVisibilityConfig,
  setCostVisibilityForRole,
  CONFIGURABLE_ROLES,
  ServiceError,
} from "@/lib/services/cost-visibility-service"
import type { UserRole } from "@/lib/supabase/role-rank"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const roleErr = requireRoleOrScope(ctx, "manager", "read")
  if (roleErr) return roleErr

  try {
    const roles = await listCostVisibilityConfig({ orgId: ctx.orgId })
    // 6-01, layer 2 of 3: client_viewer is structurally absent from this
    // response, not merely unchecked in the UI -- CONFIGURABLE_ROLES (which
    // `roles` is built from) excludes it entirely.
    return NextResponse.json({ configurableRoles: CONFIGURABLE_ROLES, roles })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("cost-visibility config list error:", error)
    return NextResponse.json({ error: "Failed to load cost visibility config" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const roleErr = requireRoleOrScope(ctx, "admin", "write")
  if (roleErr) return roleErr

  try {
    const body = await request.json()
    const role = body?.role as UserRole | undefined
    const canSeeCost = body?.canSeeCost
    if (!role || typeof role !== "string" || typeof canSeeCost !== "boolean") {
      return NextResponse.json({ error: "role (string) and canSeeCost (boolean) are required" }, { status: 400 })
    }
    // Layer 3 of 3: setCostVisibilityForRole() itself refuses role
    // "client_viewer" with canSeeCost true (400, ServiceError) -- caught and
    // surfaced below exactly like every other ServiceError this route
    // family raises. Not re-checked here so there is exactly ONE place this
    // refusal is implemented, per this phase's own "one gate" rule.
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const updated = await setCostVisibilityForRole({ orgId: ctx.orgId, userId: actorId }, role, canSeeCost)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("cost-visibility config update error:", error)
    return NextResponse.json({ error: "Failed to update cost visibility config" }, { status: 500 })
  }
}
