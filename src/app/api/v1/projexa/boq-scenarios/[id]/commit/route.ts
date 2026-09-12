// R85 Addendum 3 v4, Phase 10 -- gates 10-09/10-10/10-11/10-12/10-13. THE
// COMMIT ROUTE. A commit is FINANCIAL (10-12) -- this route:
//
//   1. Uses requireAuth() (session ONLY, never requireAuthOrApiKey) -- a
//      scenario commit needs a real compliance.users row for
//      commitScenario()'s ScenarioCommitContext.dbUser (audit logging,
//      10-09's "captured" requirement) and this codebase has no established
//      way to resolve a real dbUser from an API-key-only caller for this
//      surface (the actorEmail pattern auth-guard.ts's resolveActingUser()
//      offers elsewhere was judged out of this phase's scope to wire up
//      here -- an API-key caller is refused with a clear message below
//      rather than silently attributed to a fabricated actor).
//   2. Hard-codes `actorKind: "human"` LITERALLY -- never derived from the
//      request body, a header, or anything else a caller could set. This is
//      the other half of 10-12's fail-closed design (see boq-scenario-
//      service.ts's commitScenario() header for the full trace of why the
//      AI/pipeline dispatch layer cannot reach this function at all today):
//      the ONLY way "ai_agent" can ever reach commitScenario is a future
//      session wiring a NEW call site (e.g. a pipeline executor) that
//      passes it explicitly -- this HTTP route can never produce it.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { commitScenario, ServiceError } from "@/lib/services/boq-scenario-service"
import { ScopeReductionError } from "@/lib/services/construction-boq-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth()
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) {
    return NextResponse.json(
      { error: "A scenario commit requires a real, authenticated user session -- an API-key-only caller cannot commit a scenario." },
      { status: 403 }
    )
  }
  const roleErr = requireRole(ctx.dbUser, "manager")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as {
      evidenceArtefactRef?: string
      reason?: string
      allowScopeReductionOverride?: boolean
    }

    const result = await commitScenario(
      { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser, actorKind: "human" },
      id,
      {
        evidenceArtefactRef: body.evidenceArtefactRef,
        reason: body.reason,
        allowScopeReductionOverride: body.allowScopeReductionOverride,
      }
    )
    return NextResponse.json(result)
  } catch (error) {
    // X-24 / matches construction-boq-service.ts's own revisions route
    // convention: a scope-reduction 409 (an excluded line already has
    // recorded progress) carries the violating lines as structured rows so
    // the caller can render them and offer allowScopeReductionOverride.
    if (error instanceof ScopeReductionError) {
      return NextResponse.json({ error: error.message, conflicts: error.conflicts }, { status: error.status })
    }
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    console.error("v1 projexa boq-scenarios commit error:", error)
    return NextResponse.json({ error: "Failed to commit scenario" }, { status: 500 })
  }
}
