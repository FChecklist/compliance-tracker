import { NextRequest, NextResponse } from "next/server"
import { requireAuth, hasRole, requireRole } from "@/lib/supabase/auth-guard"
import { getSalesPipelineDashboardData, setSalesTarget, ServiceError } from "@/lib/services/crm-service"
import type { users } from "@/lib/db"

// VERIDIAN Review Framework gap-closure (2026-08-07, "Sales Dashboard"
// wave): "Access Control / Role-Based Permissions" -- this route used to
// hand every authenticated org user the whole org's pipeline regardless of
// role. Below manager, the caller is forced to their own ownerId
// (dbUser.id) -- same UserRole/hasRole gate the rest of this codebase
// already uses (auth-guard.ts), not a new ERP_ACTION_ROLES entry. manager+
// sees the full team by default, or a specific rep's pipeline via
// ?ownerId= -- safe by construction even if that id belongs to a different
// org's user, since crm-service.ts's query is always additionally scoped by
// this session's own orgId, so a foreign id just yields zero rows, never a
// cross-tenant leak.
export function resolveViewerScope(dbUser: typeof users.$inferSelect | null, requestedOwnerId: string | null): string | undefined {
  if (!hasRole(dbUser, "manager")) return dbUser?.id
  return requestedOwnerId ?? undefined
}

export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ deals: [], targets: [] })

  try {
    const requestedOwnerId = new URL(request.url).searchParams.get("ownerId")
    const restrictToOwnerId = resolveViewerScope(dbUser, requestedOwnerId)
    const data = await getSalesPipelineDashboardData({ orgId }, { restrictToOwnerId })
    return NextResponse.json({ ...data, scopedToOwnerId: restrictToOwnerId ?? null, isManager: hasRole(dbUser, "manager") })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM sales pipeline dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch sales pipeline dashboard" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const target = await setSalesTarget({ orgId, userId: dbUser.id }, { month: body.month, targetValue: Number(body.targetValue) })
    return NextResponse.json(target, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM sales pipeline target set error:", error)
    return NextResponse.json({ error: "Failed to set sales target" }, { status: 500 })
  }
}
