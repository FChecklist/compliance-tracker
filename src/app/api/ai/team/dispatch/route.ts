import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { classifyTask, runRole, runGuardrailLevel } from "@/lib/ai-team/team-service"
import { RoleNotCallableError } from "@/lib/ai-team/team-service"
import { evaluateGuardrails, recordGuardrailViolation } from "@/lib/guardrail-engine"
import { registerAllGuardrails, AI_TEAM_DISPATCH_LEAF } from "@/lib/guardrail-registrations"
import { assembleTightTaskPrompt, type TightTask } from "@/lib/task-tightening"

registerAllGuardrails()

// VERIDIAN Cognitive AI OS Development Team — dispatch endpoint.
// Platform-internal (builds/governs VERIDIAN itself, never a customer
// workflow), so this is veridian_admin-gated, not merely authenticated —
// same posture as prompt-os-service.ts's createPromptVersion.
//
// VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md, Objective/Scope/Instruction
// Validation Guardrails: the request body is now a structured TightTask
// (objective/scope/successCriteria/constraints), not a free-text string.
// This is the "make tightened tasks mandatory" enforcement point -- a
// task missing any required field is blocked here, before classification
// or any model is ever called, and the violation feeds the CLEE loop the
// same way a policy-guardrail block does.
//
// Flow: validate task structure (Guardrail Engine) -> classify (AI
// Router) -> execute (assigned AI Workforce role) -> guardrail (platform
// level always; product/account/user only if the caller says that layer
// is touched). Returns every step's output so a human can audit exactly
// what happened, not just the final answer.
export async function POST(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "AI Dev Team dispatch is veridian_admin-only" }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { objective, scope, successCriteria, constraints, touchesProduct, touchesAccount, touchesUser, role: forcedRole } = body as Partial<TightTask> & {
      touchesProduct?: boolean
      touchesAccount?: boolean
      touchesUser?: boolean
      role?: string // skip classification and force a specific AI Workforce role
    }

    const tightness = evaluateGuardrails(AI_TEAM_DISPATCH_LEAF, "input", { objective, scope, successCriteria, constraints })
    if (!tightness.passed) {
      void recordGuardrailViolation("ai_team_dispatch", AI_TEAM_DISPATCH_LEAF, "input", tightness)
      return NextResponse.json({
        status: "blocked",
        blockedBy: { reason: tightness.reason, guidance: tightness.guidance },
      }, { status: 422 })
    }

    const task = assembleTightTaskPrompt({ objective: objective!, scope: scope!, successCriteria: successCriteria!, constraints })

    const classification = forcedRole
      ? { role: forcedRole, reasoning: "Caller-specified role, classification skipped.", confidence: 1 }
      : await classifyTask(task)

    const platformGuardrails = await runGuardrailLevel("GUARDRAIL_PLATFORM", task)
    const blocked = platformGuardrails.find((g) => /\bBLOCK\b/i.test(g.verdict) || /\bFAIL\b/i.test(g.verdict))
    if (blocked) {
      return NextResponse.json({
        status: "blocked",
        classification,
        guardrails: { platform: platformGuardrails },
        blockedBy: blocked,
      }, { status: 422 })
    }

    const execution = await runRole(classification.role, task)

    const guardrails: Record<string, unknown> = { platform: platformGuardrails }
    if (touchesProduct) guardrails.product = await runGuardrailLevel("GUARDRAIL_PRODUCT", execution.content)
    if (touchesAccount) guardrails.account = await runGuardrailLevel("GUARDRAIL_ACCOUNT", execution.content)
    if (touchesUser) guardrails.user = await runGuardrailLevel("GUARDRAIL_USER", execution.content)

    return NextResponse.json({
      status: "completed",
      classification,
      executedBy: { roleKey: execution.role.roleKey, title: execution.role.title, model: execution.role.model },
      output: execution.content,
      usage: execution.usage,
      guardrails,
    })
  } catch (error) {
    if (error instanceof RoleNotCallableError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("AI Team dispatch error:", error)
    const message = error instanceof Error ? error.message : "Dispatch failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET() {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "veridian_admin-only" }, { status: 403 })
  }
  const { AI_TEAM_ROSTER } = await import("@/lib/ai-team/roster")
  return NextResponse.json({ roster: AI_TEAM_ROSTER })
}
