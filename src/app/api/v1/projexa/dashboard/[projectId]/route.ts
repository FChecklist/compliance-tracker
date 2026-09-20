import { NextResponse } from "next/server"
import { requireAuthOrApiKey, resolveActingUser, readActingUserId, readActingUserEmail } from "@/lib/supabase/auth-guard"
import { getProjectDashboard, ServiceError } from "@/lib/services/construction-dashboard-service"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/role-rank"

// R-50 REOPENED FIX (platform.sumeet_requirements): this route used to gate
// financial redaction on `ctx.dbUser && !hasRole(ctx.dbUser, "manager")`.
// PROJEXA's server authenticates every call with a single shared per-org
// API key (ctx.apiKey), never a per-user VERIDIAN session -- so ctx.dbUser
// was ALWAYS null for a PROJEXA-proxied request, that `&&` short-circuited
// every single time, and budget/revenue/expenses/projectValue/earnedValue/
// percentByValue/contractValue went out unredacted to EVERY PROJEXA role,
// including client_viewer -- R-50's own documented hard floor ("client_viewer
// can never be granted cost visibility, by any setting, any role, or any
// share token"). Live-confirmed: a direct API fetch as the real
// e2e/users.ts clientViewer account (karan.malhotra) returned a response
// byte-identical to site_engineer's own fetch.
//
// This mirrors v1/construction/boq/[id]/route.ts's resolveRoleForCostVisibility
// -- the SAME real bug (an API-key caller has no ctx.dbUser to check a role
// against) already fixed there for the BOQ dual-view read path, via the same
// D-05 identity bridge: resolveActingUser() maps PROJEXA's X-Acting-User /
// X-Acting-User-Email headers to a real, org-scoped compliance.users row (and
// therefore a real role) for an API-key caller. Resolution failing (no
// headers sent, unmapped id, no actorEmail) is NOT an error for a GET -- it
// just leaves role null, which the fail-closed check below turns into
// "redacted", the safe default this route always intended.
async function resolveRoleForFinancialVisibility(
  request: Request,
  ctx: Awaited<ReturnType<typeof requireAuthOrApiKey>>
): Promise<UserRole | null> {
  if (ctx.dbUser) return (ctx.dbUser.role as UserRole | undefined) ?? null
  if (!ctx.apiKey) return null
  const acting = await resolveActingUser(ctx, readActingUserEmail(request), readActingUserId(request))
  return (acting.user?.role as UserRole | undefined) ?? null
}

/** Same "manager" floor F059/R48 always used, just evaluated against a
 * resolved role value instead of requiring a live dbUser record. */
function hasFinancialVisibility(role: UserRole | null): boolean {
  if (!role) return false
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK.manager
}

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { projectId } = await params
    const dashboard = await getProjectDashboard({ orgId: ctx.orgId }, projectId)
    // R48 gap-closure (2026-08-30, F059) -- see the sibling org-level
    // route's comment for the full reasoning.
    const financialRole = await resolveRoleForFinancialVisibility(request, ctx)
    if (!hasFinancialVisibility(financialRole)) {
      return NextResponse.json({
        ...dashboard,
        budget: null, ledgerBudget: null, revenue: null, expenses: null,
        projectValue: null, earnedValue: null, percentByValue: null, contractValue: null,
        // R67 E-39: progressByBoqValuePct is the SAME number as percentByValue
        // under the name the UI uses. Redacting one and not the other would
        // have handed a non-manager the earned-value percentage through the
        // new field on the very same response -- exactly the F059 failure mode
        // this list exists to prevent. progressByActivityLogPct is NOT redacted,
        // for the same reason progressPercent beside it never was: it is a
        // completion percentage off the activity log, not a money figure.
        progressByBoqValuePct: null,
        financialsRedacted: true,
      })
    }
    return NextResponse.json(dashboard)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa project dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch project dashboard" }, { status: 500 })
  }
}
