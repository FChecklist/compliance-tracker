import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listAbacPolicies, createAbacPolicy, ServiceError } from "@/lib/services/abac-policy-service"

// VERIDIAN Review Framework gap-closure (2026-07-18), "ABAC / Fine-Grained
// Policies" -- admin-only CRUD surface for org-scoped deny policies, same
// admin-gating posture as approval-workflows/route.ts (this codebase's own
// precedent for org-level policy configuration).
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ policies: [] })

  try {
    const resourceType = request.nextUrl.searchParams.get("resourceType") || undefined
    const policies = await listAbacPolicies({ orgId }, resourceType)
    return NextResponse.json({ policies })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("ABAC policy list error:", error)
    return NextResponse.json({ error: "Failed to fetch ABAC policies" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "admin")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const policy = await createAbacPolicy({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(policy, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("ABAC policy create error:", error)
    return NextResponse.json({ error: "Failed to create ABAC policy" }, { status: 500 })
  }
}
