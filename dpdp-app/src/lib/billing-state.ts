// The billing state machine, as the browser shows it. The DATABASE decides (drizzle/0734: dpdp.billing_state_calc and the gate); this file is
// the same rules as plain functions so the screens can word things, so the earnings calculator can run on a static page, and so a test can
// hold the two to each other at every boundary (src/lib/services/dpdp-account-billing.pglite.test.ts runs both over the same dates).
//
// Prices are NOT here. They live in the dpdp.plan table (editable) and reach the screens through dpdp_public_plans / dpdp_my_account.

export type BillingState = "TRIAL" | "ACTIVE" | "DUE" | "GRACE" | "LOCKED"

export type BillingSettings = { trialDays: number; dueDays: number; graceDays: number; finalDownloadAfterDays: number }

/** The defaults seeded in dpdp.billing_setting. The server's own row is the truth; these only let the pure functions run without it. */
export const DEFAULT_BILLING_SETTINGS: BillingSettings = { trialDays: 30, dueDays: 1, graceDays: 7, finalDownloadAfterDays: 90 }

const DAY_MS = 86_400_000

export type BillingInput = {
  /** A verified firm on the free plan: always ACTIVE. */
  free?: boolean
  openedAt: Date
  paidUntil: Date | null
  now: Date
}

/** The end of the paid period, or of the trial if the account never paid (E in the state machine). */
export function periodEnd(openedAt: Date, paidUntil: Date | null, s: BillingSettings = DEFAULT_BILLING_SETTINGS): Date {
  const trialEnd = openedAt.getTime() + s.trialDays * DAY_MS
  return new Date(Math.max(trialEnd, paidUntil ? paidUntil.getTime() : -Infinity))
}

export function billingState(i: BillingInput, s: BillingSettings = DEFAULT_BILLING_SETTINGS): BillingState {
  if (i.free) return "ACTIVE"
  const e = periodEnd(i.openedAt, i.paidUntil, s).getTime()
  const t = i.now.getTime()
  if (t < e) return i.paidUntil ? "ACTIVE" : "TRIAL"
  if (t < e + s.dueDays * DAY_MS) return "DUE"
  if (t < e + (s.dueDays + s.graceDays) * DAY_MS) return "GRACE"
  return "LOCKED"
}

/** True once the account is 90+ days past its period end (default): the final data-download notice is due. */
export function finalDownloadDue(i: BillingInput, s: BillingSettings = DEFAULT_BILLING_SETTINGS): boolean {
  if (i.free) return false
  return i.now.getTime() >= periodEnd(i.openedAt, i.paidUntil, s).getTime() + s.finalDownloadAfterDays * DAY_MS
}

/** The calm line e-mails and screens carry. Must equal dpdp.billing_due_line in drizzle/0734 (a test compares them). */
export function dueLine(state: BillingState): string | null {
  switch (state) {
    case "DUE":
      return "A gentle note: payment for this account is due. Everything keeps working while you sort it out."
    case "GRACE":
      return "A gentle note: payment for this account is due. Everything still works for a few more days."
    case "LOCKED":
      return "Payment for this account is due, so working screens are paused. Your data is safe. You can still pay, download your data, and record a breach, answer a grievance or honour a consent withdrawal."
    default:
      return null
  }
}

/** The actions a LOCKED account can still do. Everything else refuses with PAYMENT_DUE_PREFIX. A test pins this list against the migration. */
export const LOCKED_ALLOWED_ACTIONS = ["pay", "declare_payment", "download_data", "record_breach", "answer_grievance", "withdraw_consent", "sign_out"] as const
export type LockedAllowedAction = (typeof LOCKED_ALLOWED_ACTIONS)[number]

/** The public.dpdp_* functions behind each always-open action (withdraw_consent is by token and never meets the gate). */
export const LOCKED_ALLOWED_RPCS = [
  "dpdp_my_account", "dpdp_my_billing", "dpdp_declare_payment", "dpdp_pay_begin", "dpdp_locked_download", "dpdp_locked_record_breach", "dpdp_locked_answer_grievance",
  "dpdp_consent_withdraw",
] as const

export const PAYMENT_DUE_PREFIX = "Payment is due for this account"

/** Did a refusal from the server come from the payment gate? */
export function isPaymentDueError(message: string | null | undefined): boolean {
  return typeof message === "string" && message.startsWith(PAYMENT_DUE_PREFIX)
}

// ---- plans and prices (the numbers come from dpdp_public_plans; these are only the rules) ----

export type PlanWire = {
  key: string
  accountType: "firm" | "institution"
  name: string
  maxClients: number
  requiresVerified: boolean
  listMonthlyPaise: number
  /** What a NEW sign-up pays today: the offer price while an offer is running, else the list price. */
  monthlyPaise: number
  offerLabel: string | null
  offerEndsOn: string | null
  yearlyMonthsCharged: number
}

/** A year costs yearlyMonthsCharged (10) months of the monthly price. */
export function yearlyChargePaise(monthlyPaise: number, yearlyMonthsCharged = 10): number {
  return monthlyPaise * yearlyMonthsCharged
}

/** The wording for a running offer. Never "discount applied": the offer is simply the price. */
export function offerLabel(listPaise: number, offerPaise: number): string | null {
  if (!(listPaise > 0) || !(offerPaise < listPaise)) return null
  return `Festive offer: ${Math.round((1 - offerPaise / listPaise) * 100)}% off`
}

/** A firm may add one more client only while used < cap. Cap 0 (the free plan) means none. */
export function canAddClient(used: number, cap: number): boolean {
  return used < cap
}

export function capMessage(cap: number): string {
  return cap === 0
    ? "Your plan is for your own firm's file. To add client organisations, choose a plan that includes clients."
    : `Your plan covers up to ${cap} client organisations. To add more, choose a bigger plan.`
}

export function formatRupees(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN")}`
}

// ---- the firm page's earnings calculator ----

export type EarningsExample = { clients: number; feePerClientRupees: number; monthlyIncomeRupees: number; planPriceRupees: number; netRupees: number }

/** "clients x fee per client, minus the plan price", per month. An example, not a guarantee. */
export function earningsExample(clients: number, feePerClientRupees: number, planMonthlyPaise: number): EarningsExample {
  const c = Math.max(0, Math.floor(Number.isFinite(clients) ? clients : 0))
  const f = Math.max(0, Number.isFinite(feePerClientRupees) ? feePerClientRupees : 0)
  const income = c * f
  const price = Math.round(planMonthlyPaise) / 100
  return { clients: c, feePerClientRupees: f, monthlyIncomeRupees: income, planPriceRupees: price, netRupees: income - price }
}

export const EARNINGS_DISCLAIMER = "Example, not a guarantee."

/** The cheapest ladder plan whose cap covers this many clients (undefined above the largest). */
export function planForClients(plans: PlanWire[], clients: number): PlanWire | undefined {
  return plans
    .filter((p) => p.accountType === "firm" && !p.requiresVerified && p.maxClients >= Math.max(1, clients))
    .sort((a, b) => a.maxClients - b.maxClients)[0]
}
