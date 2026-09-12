// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers): the real
// SECOND execution the Owner's 2026-07-25 UX directive requires --
// "SECOND execution in the SERVER by the SOFTWARE." Deterministic
// server-side SOFTWARE execution of phase_2's compiler pipeline
// (src/lib/prompt-compiler/pipeline.ts's runPipeline), completing whatever
// the browser's FIRST pass (src/lib/browser-execution/client-compile.ts)
// started.
//
// Security/correctness note: `browserCompiled` (the FIRST-pass draft the
// client sends) is accepted ONLY as non-authoritative telemetry -- this
// route always recomputes the full pipeline itself from `rawText` via the
// real DB-backed org/user context, exactly like every other authenticated
// route in this codebase. It never substitutes client-supplied
// classification/intent/entities for its own, which would let an
// end-user's browser dictate its own compliance-relevant classification.
//
// Credit-governance reconciliation (registries.credit_spend_governance,
// "software first, AI second, minimal credits only when needed"): this
// route itself never calls Gateway G05 / llm-client.ts. It reports whether
// verification flagged Tier-5 escalation as needed (engine-server-
// escalation) so a caller (e.g. chat-service.ts's generateAiReply, unchanged
// by this phase) can decide to actually spend an AI call -- this endpoint's
// own job stops at the deterministic compiled+verified result.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { db, organisations } from "@/lib/db"
import { eq } from "drizzle-orm"
import { runPipeline } from "@/lib/prompt-compiler/pipeline"
import type { BrowserExecutionTier } from "@/lib/browser-execution/tier-detection"
import { exploreUnknownPrompt, shouldExploreAsUnknownPrompt } from "@/lib/services/capability-learning-service"

type ExecuteBody = {
  rawText?: unknown
  template?: unknown
  templateVariables?: unknown
  // Non-authoritative FIRST-pass telemetry from src/lib/browser-execution/
  // client-compile.ts -- see this file's own header for why it is never
  // trusted for the actual compiled output below.
  browserCompiled?: {
    tier?: unknown
    fallbackChain?: unknown
    compileMs?: unknown
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // R75 Part 2 Phase 5 (G8-misc): this route had no gate at all beyond a
  // real session -- "member" matches this codebase's established low bar
  // for a baseline authenticated org action (e.g. POST /api/tasks,
  // /api/social/posts, /api/audit-points/[id]), and is deliberately not
  // higher: this endpoint is the deterministic SECOND-pass compile behind
  // ordinary chat/task-creation typing (see this file's header), something
  // every real org member does, not a privileged operation. It excludes
  // only the viewer-tier roles (viewer/client_viewer/external_auditor/
  // stage_0), which this codebase treats as external/observer-only.
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  let body: ExecuteBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const rawText = typeof body.rawText === "string" ? body.rawText.trim() : ""
  if (!rawText) return NextResponse.json({ error: "rawText is required" }, { status: 400 })

  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })

  const result = runPipeline({
    rawText,
    business: { orgId, orgName: org?.name ?? null, country: org?.country ?? null },
    user: { userId: dbUser.id, displayName: dbUser.name ?? null, roles: [dbUser.role] },
    sessionMessages: [],
    template: typeof body.template === "string" ? body.template : undefined,
    templateVariables:
      typeof body.templateVariables === "object" && body.templateVariables !== null
        ? (body.templateVariables as Record<string, string>)
        : undefined,
    userRoles: [dbUser.role],
  })

  // engine-server-escalation (deepen): a request escalates to Tier-5 (an
  // actual AI call, made elsewhere -- see this file's header) either
  // because the browser never had a real local tier to run on
  // (browserCompiled.tier === "server", set by tier-orchestrator.ts's own
  // requiresServerEscalation()) or because this SECOND pass's own
  // verification didn't pass, per the exact same two-cause distinction
  // tier-orchestrator.ts's requiresServerEscalation() doc comment draws.
  const browserTier = typeof body.browserCompiled?.tier === "string" ? (body.browserCompiled.tier as BrowserExecutionTier) : null
  const needsServerEscalation = browserTier === "server" || !result.verification.allPassed

  // engine-ai-learning (phase_8): autonomous exploration/evaluation/
  // registration of a prompt Layer 4 couldn't match to a real template and
  // Layer 5 wasn't confident about -- see capability-learning-service.ts's
  // header comment on shouldExploreAsUnknownPrompt for why this is a
  // distinct gap from that file's business-task learning loop above it.
  if (shouldExploreAsUnknownPrompt(result.compiled.matchedTemplate, result.verification.confidence.composite)) {
    await exploreUnknownPrompt({
      category: result.analysis.classification.category,
      primaryIntent: result.analysis.intent.primary,
      rawText,
      orgId,
    })
  }

  return NextResponse.json({
    compiled: result.compiled,
    verification: result.verification,
    timings: result.timings,
    browserTier,
    needsServerEscalation,
  })
}
