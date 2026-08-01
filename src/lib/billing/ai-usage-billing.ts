// AI-usage billing calculation engine.
//
// Extends the real Token Usage Ledger (Finance) -- see
// src/lib/services/token-usage-service.ts, schema.ts's tokenUsageLedger,
// and src/lib/cost-guard.ts's existing per-org spend controls -- this is
// the Finance-owned, real billing-to-customer calculation that ledger has
// never had (it only ever recorded/forecast/capped Owner spend, never
// computed what to charge a customer for it). Pure/DB-free by convention
// with this codebase's other calculation modules (see spend-forecast.ts) --
// every function here takes plain data in and returns a plain number/
// object out, so the exact-correctness this is graded on can be unit
// tested without a database. Wiring real inputs (querying
// token_usage_ledger, OpenRouter's live balance via cost-policy.ts's
// checkOpenRouterBalance, real per-org user counts) is a separate,
// follow-up integration step layered on top of these functions, not part
// of this module.
//
// Formula (Owner-confirmed, five steps -- do not re-derive, only the
// PricingConfig placeholder numbers in pricing-config.ts are open):
//
//   Step 1: BLENDED_OWNER_COST_PER_TOKEN = platform-wide (fixed-cost $
//           paid + variable/metered $ paid) / (fixed-cost tokens
//           delivered + variable/metered tokens delivered), this period.
//   Step 2: AI_TOKEN_RATE = BLENDED_OWNER_COST_PER_TOKEN x MARGIN_MULTIPLIER
//           -- margin applied EXACTLY ONCE, here.
//   Step 3: per real end-user task, billable tokens = GUESSTIMATED_TOKENS x
//           ESTIMATION_BUFFER (fixed-cost/estimated-cost model only) OR
//           ACTUAL_TOKENS_USED with NO padding (metered/variable-cost model).
//   Step 4: TOTAL_BILLABLE_TOKENS_FOR_ORG = sum of Step 3 across every end
//           user in the org, for the billing period.
//   Step 5: BILLING_TO_CUSTOMER_FOR_AI = TOTAL_BILLABLE_TOKENS_FOR_ORG x
//           AI_TOKEN_RATE.
//
// Separately, base/infra billing (config-driven, PLACEHOLDER values -- see
// pricing-config.ts):
//
//   INTERPRETATION CHOICE (flagged for Owner correction if wrong): the
//   literal formula this task was given --
//     TOTAL_CUSTOMER_BILL = (base_price + extra_user_charges +
//       BILLING_TO_CUSTOMER_FOR_AI) x margin_multiplier
//   -- would, read literally, multiply BILLING_TO_CUSTOMER_FOR_AI by
//   margin_multiplier a SECOND time (it already has margin baked in via
//   AI_TOKEN_RATE in Step 2). That is exactly the margin-stacking bug the
//   real Owner discussion caught and rejected when deriving this formula
//   in the first place, so this implementation does NOT do that. Instead,
//   per this task's own fallback instruction ("implement BOTH components
//   ... with margin applied at the same single point in each one's own
//   calculation, mirroring Step 2's discipline"), base/infra margin is
//   applied exactly once, at its own point, structurally identical to how
//   Step 2 applies it to the AI side:
//     BASE_INFRA_BILL = (base_price + max(0, real_user_count -
//       included_users_in_base) x price_per_extra_user) x margin_multiplier
//   and the two already-margined components are summed, not re-margined:
//     TOTAL_CUSTOMER_BILL = BILLING_TO_CUSTOMER_FOR_AI + BASE_INFRA_BILL
//   See computeCustomerBillForOrg's own comment and this module's
//   "margin applied exactly once" regression test.

import {
  MARGIN_MULTIPLIER,
  ESTIMATION_BUFFER,
  type PricingConfig,
} from "./pricing-config"

// Mirrors token-usage-service.ts's CostModelType / schema.ts's
// tokenUsageLedger.costModelType exactly -- kept as its own local type
// (rather than importing token-usage-service.ts, which pulls in the `db`
// client) so this module stays pure/DB-free per this codebase's
// convention. If that column's allowed values ever change, update both.
export type CostModelType = "fixed_estimated" | "metered_actual"

// ─── Step 1 ────────────────────────────────────────────────────────────

export type PlatformPeriodOwnerCostTotals = {
  /** Real $ the Owner actually paid this period across flat-rate/subscription AI sources. */
  fixedCostUsdPaid: number
  /** Real (or, for fixed-cost sources, best-known) tokens delivered this period across those same fixed-cost sources. */
  fixedCostTokensDelivered: number
  /** Real $ the Owner actually paid this period across metered/pay-per-token AI sources. */
  variableCostUsdPaid: number
  /** Real, exactly-metered tokens delivered this period across those same variable-cost sources. */
  variableCostTokensDelivered: number
}

/**
 * Step 1: BLENDED_OWNER_COST_PER_TOKEN, platform-wide for the period --
 * no margin applied here (see Step 2 for the one and only place margin
 * enters this calculation).
 */
export function computeBlendedOwnerCostPerToken(totals: PlatformPeriodOwnerCostTotals): number {
  const totalUsd = totals.fixedCostUsdPaid + totals.variableCostUsdPaid
  const totalTokens = totals.fixedCostTokensDelivered + totals.variableCostTokensDelivered
  if (totalTokens <= 0) {
    throw new Error(
      "computeBlendedOwnerCostPerToken: total tokens delivered must be > 0 -- no real usage this period to blend a per-token cost from",
    )
  }
  return totalUsd / totalTokens
}

// ─── Step 2 ────────────────────────────────────────────────────────────

/**
 * Step 2: AI_TOKEN_RATE -- margin applied EXACTLY ONCE, here. This is the
 * single platform-wide rate every org's Step 5 bill is computed against
 * for the period.
 */
export function computeAiTokenRate(
  blendedOwnerCostPerToken: number,
  marginMultiplier: number = MARGIN_MULTIPLIER,
): number {
  return blendedOwnerCostPerToken * marginMultiplier
}

// ─── Step 3 ────────────────────────────────────────────────────────────

export type BillableTask = {
  costModelType: CostModelType
  /** Required when costModelType === 'fixed_estimated'; ignored otherwise. */
  guesstimatedTokens?: number
  /** Required when costModelType === 'metered_actual'; ignored otherwise. */
  actualTokensUsed?: number
}

/**
 * Step 3: per-task billable tokens. Padding (estimationBuffer) applies
 * ONLY to fixed_estimated tasks. metered_actual tasks pass through with
 * NO padding -- padding a known-exact number would be a hidden second
 * margin, explicitly rejected in the real discussion that derived this
 * formula.
 */
export function computeBillableTokensForTask(
  task: BillableTask,
  estimationBuffer: number = ESTIMATION_BUFFER,
): number {
  if (task.costModelType === "fixed_estimated") {
    if (task.guesstimatedTokens == null) {
      throw new Error("computeBillableTokensForTask: guesstimatedTokens is required for costModelType 'fixed_estimated'")
    }
    return task.guesstimatedTokens * estimationBuffer
  }
  if (task.costModelType === "metered_actual") {
    if (task.actualTokensUsed == null) {
      throw new Error("computeBillableTokensForTask: actualTokensUsed is required for costModelType 'metered_actual'")
    }
    return task.actualTokensUsed // no padding -- already exact
  }
  throw new Error(`computeBillableTokensForTask: unrecognized costModelType '${String((task as BillableTask).costModelType)}'`)
}

// ─── Step 4 ────────────────────────────────────────────────────────────

export type OrgEndUserTasks = {
  userId: string
  tasks: BillableTask[]
}

/**
 * Step 4: TOTAL_BILLABLE_TOKENS_FOR_ORG -- sum of Step 3 across every end
 * user in the org for the billing period.
 */
export function aggregateBillableTokensForOrg(
  endUsers: OrgEndUserTasks[],
  estimationBuffer: number = ESTIMATION_BUFFER,
): number {
  let total = 0
  for (const endUser of endUsers) {
    for (const task of endUser.tasks) {
      total += computeBillableTokensForTask(task, estimationBuffer)
    }
  }
  return total
}

// ─── Step 5 ────────────────────────────────────────────────────────────

/** Step 5: BILLING_TO_CUSTOMER_FOR_AI. */
export function computeAiUsageBillForOrg(totalBillableTokensForOrg: number, aiTokenRate: number): number {
  return totalBillableTokensForOrg * aiTokenRate
}

// ─── Base/infra component (config-driven, PLACEHOLDER values) ────────────

/** Base/infra cost BEFORE margin -- base_price plus any extra-user charges beyond includedUsersInBase. */
export function computeBaseInfraBillableBeforeMargin(config: PricingConfig, realUserCount: number): number {
  const extraUsers = Math.max(0, realUserCount - config.includedUsersInBase)
  return config.basePrice + extraUsers * config.pricePerExtraUser
}

/**
 * Base/infra bill AFTER margin -- margin applied exactly once, at this
 * component's own point, mirroring Step 2's discipline for the AI side.
 * See this file's header comment for why the total bill does not apply
 * margin a second time across the combined base+AI sum.
 */
export function computeBaseInfraBill(
  config: PricingConfig,
  realUserCount: number,
  marginMultiplier: number = MARGIN_MULTIPLIER,
): number {
  return computeBaseInfraBillableBeforeMargin(config, realUserCount) * marginMultiplier
}

// ─── Combined total ───────────────────────────────────────────────────

export type CustomerBillInput = {
  pricingConfig: PricingConfig
  realUserCount: number
  platformPeriodOwnerCostTotals: PlatformPeriodOwnerCostTotals
  orgEndUserTasks: OrgEndUserTasks[]
}

export type CustomerBillBreakdown = {
  blendedOwnerCostPerToken: number
  aiTokenRate: number
  totalBillableTokensForOrg: number
  aiUsageBillUsd: number
  baseInfraBillUsd: number
  totalBillUsd: number
}

/**
 * Full Steps 1-5 + base/infra, combined into one org's real customer bill
 * for the period. See this file's header comment for the explicit
 * interpretation of the base/infra margin-timing ambiguity: both
 * components have margin applied exactly once, at their own respective
 * points (Step 2 for AI, computeBaseInfraBill for base/infra), and are
 * then summed WITHOUT a further margin multiplication on the total --
 * multiplying the sum again would double the margin already baked into
 * aiUsageBillUsd, which is precisely the stacking bug this formula's real
 * derivation rejected.
 */
export function computeCustomerBillForOrg(input: CustomerBillInput): CustomerBillBreakdown {
  const blendedOwnerCostPerToken = computeBlendedOwnerCostPerToken(input.platformPeriodOwnerCostTotals)
  const aiTokenRate = computeAiTokenRate(blendedOwnerCostPerToken, input.pricingConfig.marginMultiplier)
  const totalBillableTokensForOrg = aggregateBillableTokensForOrg(
    input.orgEndUserTasks,
    input.pricingConfig.estimationBuffer,
  )
  const aiUsageBillUsd = computeAiUsageBillForOrg(totalBillableTokensForOrg, aiTokenRate)
  const baseInfraBillUsd = computeBaseInfraBill(
    input.pricingConfig,
    input.realUserCount,
    input.pricingConfig.marginMultiplier,
  )
  const totalBillUsd = aiUsageBillUsd + baseInfraBillUsd

  return {
    blendedOwnerCostPerToken,
    aiTokenRate,
    totalBillableTokensForOrg,
    aiUsageBillUsd,
    baseInfraBillUsd,
    totalBillUsd,
  }
}
