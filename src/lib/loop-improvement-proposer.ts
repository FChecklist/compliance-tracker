// Wave 146 (VERIDIAN.docx joint implementation plan, Phase 2): closes the
// CLEE (Continuous Learning Engineering) capture->apply gap named in both
// independent studies -- loopExecutions has been capturing real findings
// (11+ daily loops running) but loopImprovements had zero rows ever, so
// nothing the loops observed ever became a structured, reviewable
// improvement proposal. This is the shared helper every loop calls when it
// finds something concrete and actionable -- NOT a new subsystem, just
// wiring loops up to the loopImprovements table that already existed for
// exactly this purpose (see schema.ts).
//
// Human-gated by construction: isDeployed is always false here. No loop
// gets a path to set it true -- that stays a manual/future-approval-flow
// decision, matching every loop's existing "read-only, no autonomous
// writes" posture (see api-token-audit.ts's own header comment for the
// precedent this follows).
import { db, loopImprovements } from "@/lib/db"

export type LoopImprovementProposal = {
  loopId: string
  improvementType: string
  targetType: string
  targetId?: string | null
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
  improvementDelta?: number | null
}

export async function proposeLoopImprovement(input: LoopImprovementProposal): Promise<void> {
  await db.insert(loopImprovements).values({
    loopId: input.loopId,
    improvementType: input.improvementType,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    improvementDelta: input.improvementDelta != null ? String(input.improvementDelta) : null,
    isDeployed: false,
  })
}
