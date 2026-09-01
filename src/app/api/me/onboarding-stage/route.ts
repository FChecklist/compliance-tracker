import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { db, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { checkAndUnlockAchievements } from "@/lib/services/veri-reward-service"

// V2-17 HR validation UX cross-check (2026-07-26): keep in sync with
// OnboardingChecklist.tsx's STEPS ids -- that component is the only real
// caller and always sends one of these 4 (see its toggleStep/autoComplete
// fetch calls). Previously this route accepted ANY string (or none at all,
// which would have set onboardingStage to undefined/null) with zero
// validation; rejecting anything else stops a malformed direct API call
// from silently corrupting users.onboardingStage.
const VALID_ONBOARDING_STAGES = ["profile", "compliance", "connectors", "invite"]

export async function PATCH(request: NextRequest) {
  const { user, dbUser, orgId, response } = await requireAuth()
  if (!user || !dbUser) return response!

  const { stage, allComplete } = await request.json() as { stage?: string; allComplete?: boolean }

  if (typeof stage !== "string" || !VALID_ONBOARDING_STAGES.includes(stage)) {
    return NextResponse.json({ error: `stage must be one of: ${VALID_ONBOARDING_STAGES.join(", ")}` }, { status: 400 })
  }

  const updateData: Record<string, unknown> = { onboardingStage: stage }
  // VERI Reward / onboarding_complete: users.onboardingCompleted is set to
  // false at signup (auth-guard.ts autoProvisionUser) but, until this
  // change, was never flipped back to true anywhere in the codebase --
  // confirmed by search, not assumed. OnboardingChecklist.tsx already
  // computes "all 4 steps done" client-side (STEPS.length comparison) and
  // calls this same PATCH route on every step toggle, so this is the one
  // real, existing sync point for onboarding progress -- reused here rather
  // than inventing a parallel completion-tracking mechanism (the
  // onboarding_steps DB table is unrelated dead code: defined in schema.ts
  // but never read or written anywhere in the app, out of scope for this
  // narrow wiring task).
  if (allComplete === true) updateData.onboardingCompleted = true

  await db.update(users).set(updateData).where(eq(users.id, dbUser.id))

  if (allComplete === true && orgId) {
    try {
      await withTenantContext({ orgId, userId: dbUser.id }, (tx) =>
        checkAndUnlockAchievements(tx, { orgId, userId: dbUser.id, achievementKey: "onboarding_complete" })
      )
    } catch (err) {
      console.error("[veri-reward] failed to check onboarding_complete achievement", err)
    }
  }

  return NextResponse.json({ stage })
}