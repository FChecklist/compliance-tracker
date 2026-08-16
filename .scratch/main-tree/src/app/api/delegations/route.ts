import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createDelegation, listMyDelegations, ServiceError, DELEGATION_SCOPE_TYPES } from "@/lib/services/delegation-service"

// Wave 173 (GAP-DELEGATION-AUTHORITY). GET lists delegations this user
// either gave (delegator) or received (delegate) -- POST creates a new one,
// always scoped to the caller as delegator (a person can only delegate
// their OWN authority away, never someone else's).
export async function GET() {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ delegations: [] })

  try {
    const delegations = await listMyDelegations({ orgId, userId: dbUser.id })
    return NextResponse.json({ delegations })
  } catch (error) {
    console.error("Delegations list error:", error)
    return NextResponse.json({ error: "Failed to fetch delegations" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    if (!DELEGATION_SCOPE_TYPES.includes(body.scopeType)) {
      return NextResponse.json({ error: `scopeType must be one of: ${DELEGATION_SCOPE_TYPES.join(", ")}` }, { status: 400 })
    }
    const created = await createDelegation(
      { orgId, userId: dbUser.id },
      {
        delegatorUserId: dbUser.id,
        delegateUserId: body.delegateUserId ?? null,
        delegateRoleKey: body.delegateRoleKey ?? null,
        scopeType: body.scopeType,
        scopeId: body.scopeId ?? null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      }
    )
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Delegation create error:", error)
    return NextResponse.json({ error: "Failed to create delegation" }, { status: 500 })
  }
}
