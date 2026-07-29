// AI-usage billing engine -- pricing configuration.
//
// Extends the real Token Usage Ledger (Finance) -- see
// src/lib/services/token-usage-service.ts and schema.ts's
// tokenUsageLedger -- rather than inventing a second ledger. This module
// holds every numeric value the billing formula in ai-usage-billing.ts
// needs that is NOT yet a real, Owner-confirmed number, plus the three
// values that genuinely are confirmed. The split between the two groups
// is deliberate and load-bearing: nothing in ai-usage-billing.ts's
// calculation logic ever hardcodes a raw number -- every call site takes
// a PricingConfig object as a parameter, so a real number can replace a
// placeholder later without touching the math.
//
// Per-org shape: PricingConfig is resolved per-organisation (see
// resolvePricingConfig below), same posture as organisations.plan /
// subscription_plans (existing real per-org pricing-tier tables in this
// schema) -- but deliberately NOT stored in either of those tables. Those
// already hold real, live, in-use values read by real signup/billing
// flows; writing PLACEHOLDER numbers into them risks a real code path
// treating a placeholder as an approved price. Until the Owner finalizes
// real numbers, this stays an explicit, clearly-labeled in-code config
// with a per-org override seam (ORG_PRICING_CONFIG_OVERRIDES) shaped so a
// real `compliance.ai_billing_pricing_config` table (org_id nullable for
// the platform default row, mirroring organisations/subscription_plans
// conventions) is a drop-in swap for resolvePricingConfig's body once
// real numbers exist -- not a redesign.

// ─── Real, confirmed business constants (NOT placeholders) ───────────────
// These three are settled: the Owner discussion that derived this whole
// formula fixed them. Named/commented, never inlined as magic numbers.

// Sales commission takes this fraction of the final sales price off the
// top before the Owner sees any of it.
export const COMMISSION_RATE = 0.50

// Derivation (confirmed): with 50% commission and a 100%-of-cost profit
// target on what's left after commission, sales_price = 4 x real_cost.
// Check: sales_price=4c -> commission=0.5*4c=2c -> net after commission=2c
// -> profit = net - cost = 2c - c = c = 100% of cost. See
// deriveMarginMultiplierFromBusinessRule below for the general form this
// specific value falls out of (used only in this module's own tests as a
// standing proof the constant hasn't drifted from the business rule that
// produced it -- the constant itself, not the derivation call, is what
// production code uses).
export const MARGIN_MULTIPLIER = 4.0

// Estimation-uncertainty padding applied ONLY to tasks billed off a
// guesstimated (not exactly metered) token count -- see
// ai-usage-billing.ts Step 3. Explicitly never applied to exactly-metered
// usage: padding a known-exact number would be a hidden second margin,
// rejected in the real discussion that derived this formula.
export const ESTIMATION_BUFFER = 1.20

/**
 * General form of the margin-multiplier business rule, kept as a pure
 * function so it can be exercised in a test that proves MARGIN_MULTIPLIER
 * (4.0) is still exactly what "50% commission + 100% profit on the
 * remainder" produces -- a standing regression check on the constant's
 * derivation, not a runtime dependency of the billing engine (which uses
 * the named MARGIN_MULTIPLIER constant directly, per the real, confirmed,
 * final value the Owner gave).
 */
export function deriveMarginMultiplierFromBusinessRule(
  commissionRate: number,
  profitMultipleOfCost: number,
): number {
  if (commissionRate >= 1 || commissionRate < 0) {
    throw new Error("deriveMarginMultiplierFromBusinessRule: commissionRate must be in [0, 1)")
  }
  return (1 + profitMultipleOfCost) / (1 - commissionRate)
}

// ─── PLACEHOLDER pricing (Owner has not finalized real numbers) ──────────
// Every value in this section is a PLACEHOLDER -- nominal numbers picked
// only so the engine has something concrete to compute with and test
// against. Do NOT use these in production billing without explicit
// Owner sign-off on real numbers. None of these are read directly by
// ai-usage-billing.ts's calculation functions -- they flow in only
// through a resolved PricingConfig object, so swapping them for real
// numbers later never touches calculation logic.
export type PricingConfigPlaceholders = {
  /** PLACEHOLDER -- Owner has not finalized real pricing. Nominal monthly base/infra price, USD, BEFORE margin. */
  basePrice: number
  /** PLACEHOLDER -- Owner has not finalized real pricing. Seats included in basePrice before extra-user charges apply. */
  includedUsersInBase: number
  /** PLACEHOLDER -- Owner has not finalized real pricing. USD per seat beyond includedUsersInBase, BEFORE margin. */
  pricePerExtraUser: number
}

export type PricingConfig = PricingConfigPlaceholders & {
  /** Real, confirmed -- see COMMISSION_RATE above. Carried on the resolved config so callers never need a second import to reconstruct it. */
  commissionRate: number
  /** Real, confirmed -- see MARGIN_MULTIPLIER above. */
  marginMultiplier: number
  /** Real, confirmed -- see ESTIMATION_BUFFER above. */
  estimationBuffer: number
}

// PLACEHOLDER -- Owner has not finalized real pricing. This is the
// brand-level default every org falls back to absent a per-org override.
// Do NOT use in production billing without explicit Owner sign-off.
export const PLATFORM_DEFAULT_PRICING_CONFIG: PricingConfig = {
  basePrice: 99, // PLACEHOLDER
  includedUsersInBase: 5, // PLACEHOLDER
  pricePerExtraUser: 15, // PLACEHOLDER
  commissionRate: COMMISSION_RATE,
  marginMultiplier: MARGIN_MULTIPLIER,
  estimationBuffer: ESTIMATION_BUFFER,
}

// Per-org overrides -- the "per-organization, alongside brand-level
// defaults" seam called for by this task. Empty by default (every org
// gets the placeholder platform default until the Owner sets a real,
// org-specific deal). Keyed by organisations.id.
const ORG_PRICING_CONFIG_OVERRIDES = new Map<string, Partial<PricingConfigPlaceholders>>()

/**
 * Register a per-org placeholder override (e.g. a negotiated deal that
 * still uses placeholder numbers pending Owner sign-off). Only the three
 * PLACEHOLDER fields are overridable per-org -- commissionRate/
 * marginMultiplier/estimationBuffer are real, confirmed, platform-wide
 * constants and are never org-specific.
 */
export function setOrgPricingConfigOverride(orgId: string, override: Partial<PricingConfigPlaceholders>): void {
  ORG_PRICING_CONFIG_OVERRIDES.set(orgId, override)
}

export function clearOrgPricingConfigOverride(orgId: string): void {
  ORG_PRICING_CONFIG_OVERRIDES.delete(orgId)
}

/**
 * Resolve the PricingConfig to bill a given org against: per-org override
 * (placeholder fields only) merged over the platform default, real
 * constants always taken from the platform-wide values. Pass null/
 * undefined orgId for the platform-default-only config (e.g. previewing
 * pricing before an org exists).
 */
export function resolvePricingConfig(orgId?: string | null): PricingConfig {
  const override = orgId ? ORG_PRICING_CONFIG_OVERRIDES.get(orgId) : undefined
  return {
    ...PLATFORM_DEFAULT_PRICING_CONFIG,
    ...override,
    // Real constants are never overridden per-org -- re-asserted here so a
    // future careless override object can't accidentally smuggle a
    // different margin/commission/buffer value in per Partial<...>'s
    // structural typing only covering the placeholder fields anyway.
    commissionRate: COMMISSION_RATE,
    marginMultiplier: MARGIN_MULTIPLIER,
    estimationBuffer: ESTIMATION_BUFFER,
  }
}
