// GAP-OCID-049-SUBSCRIPTION-PLAN-ENTITLEMENT, Tasks A/B/E (PM decision
// UMR-20260802-165606-4413 OCID-020 / UMR-20260802-173631-ca85 OCID-021,
// 2026-08-04). Real, existing model: compliance.subscription_plans (4
// seeded tiers, drizzle/0231_ai_router_mother_router.sql) +
// organisations.subscriptionPlanId (nullable FK). Resolution logic mirrors
// mother-router.ts's getOrgAiPackage() exactly (explicit assignment first,
// else the smallest tier whose userPackSize fits the org's real live user
// count) but returns the full plan row, not just features.aiPackage --
// callers here need assistantsPerUser/name, not the AI-routing string.
import { db, organisations, subscriptionPlans, users, aiAssistants } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, count, sql } from "drizzle-orm"

export type ResolvedSubscriptionPlan = typeof subscriptionPlans.$inferSelect

export async function resolveSubscriptionPlan(orgId: string): Promise<ResolvedSubscriptionPlan | null> {
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
  if (!org) return null

  if (org.subscriptionPlanId) {
    const plan = await db.query.subscriptionPlans.findFirst({ where: eq(subscriptionPlans.id, org.subscriptionPlanId) })
    if (plan) return plan
  }

  const [[{ value: userCount }], plans] = await Promise.all([
    db.select({ value: count() }).from(users).where(eq(users.orgId, orgId)),
    db.query.subscriptionPlans.findMany({
      // Real, live bug found during Group F re-verification (UMR-20260804-221844-c915):
      // the real subscription_plans table also carries 4 pre-existing legacy rows
      // (Trial/Starter/Growth/Scale) seeded well before this task's own
      // Basic/Standard/Professional/Enterprise scheme's migration -- see that
      // migration's own file header for the real timeline -- that were never
      // meant to participate in this fallback. Confirmed live: a
      // fresh 1-user org resolved to "Trial" (cap 5) instead of "Basic" (cap 3), and
      // an existing 48-user org resolved to "Scale" (cap 5) instead of "Professional"
      // (cap 8), since both tie at userPackSize=50 and Scale sorted first. Filtering
      // on `features.aiPackage` (this migration's own documented discriminator, see
      // drizzle/0231_ai_router_mother_router.sql and mother-router.ts's matching fix)
      // excludes the legacy rows without touching them.
      where: and(eq(subscriptionPlans.isActive, true), sql`${subscriptionPlans.features} ->> 'aiPackage' IS NOT NULL`),
      orderBy: (t, { asc }) => asc(t.userPackSize),
    }),
  ])
  if (plans.length === 0) return null

  return plans.find((p) => userCount <= p.userPackSize) ?? plans[plans.length - 1]
}

// Task A chokepoint: every real site that provisions a new user's AI
// Assistants (POST /api/users, normal signup, invite-link accept, org-join-
// code redeem, stage-0 upgrade x2) previously hardcoded `Array.from({length: 5}...)`
// regardless of the org's real tier -- confirmed live (OCID_049 certification
// doc, 2026-08-03 amendment) that a real 1-user Basic-tier org (cap 3) already
// had 5 real rows, exceeding its own cap by 2 with zero enforcement anywhere.
// This is the actual enforcement point: there is no separate "create one more
// assistant" UI/API anywhere in this codebase (confirmed via grep -- GET
// /api/assistants only lists/renames the ones provisioned here), so capping
// the provisioned quantity at the org's real resolved limit IS the real fix,
// not a new gate on a nonexistent creation flow.
export async function provisionAiAssistantsForUser(userId: string, orgId: string): Promise<void> {
  const plan = await resolveSubscriptionPlan(orgId)
  const assistantCount = plan?.assistantsPerUser ?? 5 // schema column default, same fallback as an org with zero active plan rows
  // R53 / F_021 -- REAL PRODUCTION ERROR, TWICE: "new row violates row-level
  // security policy for table ai_assistants" (Vercel runtime, route
  // /api/users, 2026-08-24T17:50-17:51Z).
  //
  // THE COMMENT AT THE CALL SITE WAS WRONG, NOT THE POLICY. api/users/route.ts
  // said this "uses the raw (RLS-bypassing) db client deliberately". The
  // module-level `db` is only RLS-bypassing if the ROLE behind DATABASE_URL
  // carries rolbypassrls -- an environment property, never a code property,
  // and not one this deployment has. compliance.ai_assistants has FORCE ROW
  // LEVEL SECURITY and its policy requires compliance.current_user_id() to
  // equal the row's user_id. Outside withTenantContext, set_config is never
  // run, current_user_id() is NULL, `user_id = NULL` is NULL, and the insert
  // is refused. The route's own users insert two statements earlier IS
  // wrapped correctly, which is exactly why it succeeds while this failed.
  //
  // The comment's own stated requirement -- current_user_id() must equal the
  // row's user_id -- is precisely what this now satisfies. The
  // compliance.users row for userId is already committed by the caller
  // before this runs, so the context is real, not asserted.
  //
  // NOT getProvisioningDb(): that module's header restricts it to the
  // organisations INSERT, and borrowing an elevated connection to dodge a
  // policy that is doing its job is how the next one of these gets written.
  await withTenantContext({ orgId, userId }, (tx) => tx.insert(aiAssistants).values(
    Array.from({ length: assistantCount }, (_, i) => ({
      userId,
      assistantNumber: i + 1,
      label: `Assistant ${i + 1}`,
    }))
  ))
}

// Task B/E shared status shape -- /api/me (read-only, every user) and the
// admin settings PATCH endpoint (assigns organisations.subscriptionPlanId)
// both resolve through this so they can never drift.
export type SubscriptionPlanStatus = {
  subscriptionPlanId: string | null
  subscriptionPlanName: string | null
  assistantsPerUserLimit: number
  resolvedViaFallback: boolean // true when no explicit subscriptionPlanId is set and the live-user-count band fit was used instead
}

export async function getSubscriptionPlanStatus(orgId: string): Promise<SubscriptionPlanStatus> {
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
  const plan = await resolveSubscriptionPlan(orgId)
  return {
    subscriptionPlanId: org?.subscriptionPlanId ?? null,
    subscriptionPlanName: plan?.name ?? null,
    assistantsPerUserLimit: plan?.assistantsPerUser ?? 5,
    resolvedViaFallback: !org?.subscriptionPlanId,
  }
}

export async function getAssistantsUsedByUser(userId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(aiAssistants).where(eq(aiAssistants.userId, userId))
  return row?.value ?? 0
}

// Task E backend: admin assigns (or clears) an org's explicit subscription
// plan. Clearing (planId=null) is a real, valid choice -- it reverts the org
// to the live-user-count band-fit fallback resolveSubscriptionPlan() already
// applies, not an error state.
export async function setSubscriptionPlanForOrg(orgId: string, subscriptionPlanId: string | null): Promise<SubscriptionPlanStatus> {
  if (subscriptionPlanId) {
    const plan = await db.query.subscriptionPlans.findFirst({ where: eq(subscriptionPlans.id, subscriptionPlanId) })
    if (!plan) throw new Error(`subscription plan '${subscriptionPlanId}' does not exist`)
  }
  await db.update(organisations).set({ subscriptionPlanId }).where(eq(organisations.id, orgId))
  return getSubscriptionPlanStatus(orgId)
}

export async function listActiveSubscriptionPlans(): Promise<ResolvedSubscriptionPlan[]> {
  return db.query.subscriptionPlans.findMany({
    where: eq(subscriptionPlans.isActive, true),
    orderBy: (t, { asc }) => asc(t.userPackSize),
  })
}
