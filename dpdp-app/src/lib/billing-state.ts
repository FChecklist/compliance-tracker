// The billing state machine, as the browser shows it. The DATABASE decides (drizzle/0734: dpdp.billing_state_calc and the gate); this file is
// the same rules as plain functions so the screens can word things, so the earnings calculator can run on a static page, and so a test can
// hold the two to each other at every boundary (src/lib/services/dpdp-account-billing.pglite.test.ts runs both over the same dates).
//
// Prices are NOT here. They live in the dpdp.plan table and dpdp.billing_setting (editable) and reach the screens through dpdp_public_plans /
// dpdp_my_account. The rules below are the ones the database applies (drizzle/0755, the owner's pricing of 2026-11-02):
//   a new account chooses the trial pack | monthly | yearly; after the trial pack only monthly | yearly remain;
//   a Professional's monthly price includes ten clients and adds a fixed price for each client beyond (counted on the real number, no tiers);
//   a year is charged as 6 months of the monthly price (half price); nobody is free.

export type BillingState = "TRIAL" | "ACTIVE" | "DUE" | "GRACE" | "LOCKED"

export type BillingSettings = { trialDays: number; dueDays: number; graceDays: number; finalDownloadAfterDays: number }

/** The defaults seeded in dpdp.billing_setting. The server's own row is the truth; these only let the pure functions run without it. */
export const DEFAULT_BILLING_SETTINGS: BillingSettings = { trialDays: 30, dueDays: 1, graceDays: 7, finalDownloadAfterDays: 90 }

const DAY_MS = 86_400_000

export type BillingInput = {
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
  const e = periodEnd(i.openedAt, i.paidUntil, s).getTime()
  const t = i.now.getTime()
  if (t < e) return i.paidUntil ? "ACTIVE" : "TRIAL"
  if (t < e + s.dueDays * DAY_MS) return "DUE"
  if (t < e + (s.dueDays + s.graceDays) * DAY_MS) return "GRACE"
  return "LOCKED"
}

/** True once the account is 90+ days past its period end (default): the final data-download notice is due. */
export function finalDownloadDue(i: BillingInput, s: BillingSettings = DEFAULT_BILLING_SETTINGS): boolean {
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

/**
 * What everyone except the owner sees when payment is pending (owner, 2026-11-02): they cannot pay, so they are told to ask their admin and get
 * no pay button or link. Must equal PAYMENT_PENDING_FOR_STAFF in supabase/functions/dpdp-monday-email/render.ts (a test compares them).
 */
export const PAYMENT_PENDING_FOR_STAFF = "Payment pending. Please check with your admin."

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
  requiresDeclaration: boolean
  listMonthlyPaise: number
  /** What a NEW sign-up pays today: the offer price while an offer is running, else the list price. */
  monthlyPaise: number
  offerLabel: string | null
  yearlyMonthsCharged: number
  /** Clients the monthly price already covers (a Professional: 10; an Organisation has no clients). */
  includedClients: number
  /** What each client beyond `includedClients` adds to the monthly price. */
  extraClientMonthlyPaise: number
  /** The trial pack: a flat price, once, for this many days, covering at most packMaxClients clients. */
  packPricePaise: number
  packDays: number
  packMaxClients: number
}

/** A year costs yearlyMonthsCharged (6) months of the monthly price: half price. */
export function yearlyChargePaise(monthlyPaise: number, yearlyMonthsCharged: number): number {
  return monthlyPaise * yearlyMonthsCharged
}

/** "50% off" for a year charged as 6 months; null when the year saves nothing. */
export function yearOffLabel(yearlyMonthsCharged: number): string | null {
  const off = Math.round((1 - yearlyMonthsCharged / 12) * 100)
  return off > 0 && off < 100 ? `${off}% off` : null
}

/**
 * What an account pays a month: the plan's monthly price plus the extra-client price for every client beyond the included ones, counted on the
 * real number of clients (no tiers). Must equal dpdp.account_monthly_total_paise (a test compares them).
 */
export function monthlyTotalPaise(basePaise: number, includedClients: number, extraClientMonthlyPaise: number, clients: number): number {
  const used = Math.max(0, Math.floor(Number.isFinite(clients) ? clients : 0))
  return basePaise + Math.max(used - includedClients, 0) * extraClientMonthlyPaise
}

/** The way a payment was made, in the words a person uses: the trial pack, monthly, yearly. */
export function intervalWord(interval: "pack" | "month" | "year" | null | undefined): string {
  return interval === "pack" ? "trial pack" : interval === "year" ? "yearly" : "monthly"
}

/** The trial pack's length in the words a person uses: 90 days is "3 months". */
export function packLength(days: number): string {
  if (days === 30) return "1 month"
  return days > 0 && days % 30 === 0 ? `${days / 30} months` : `${days} days`
}

/**
 * The whole ladder in one calm line, shown BEFORE anyone pays the trial pack so that what follows it is no surprise:
 * "Rs 99 for 3 months, then Rs 999 a month or Rs 5,994 a year (50% off)." The numbers come from the plan the database sent.
 */
export function ladderLine(p: Pick<PlanWire, "monthlyPaise" | "yearlyMonthsCharged" | "packPricePaise" | "packDays">): string {
  const off = yearOffLabel(p.yearlyMonthsCharged)
  return `${formatRupees(p.packPricePaise)} for ${packLength(p.packDays)}, then ${formatRupees(p.monthlyPaise)} a month or ${formatRupees(yearlyChargePaise(p.monthlyPaise, p.yearlyMonthsCharged))} a year${off ? ` (${off})` : ""}.`
}

/**
 * The soft ask at the step where the first e-mails go out: the whole ladder in plain lines, from the account's own numbers, or null when the
 * trial pack is not on offer (it was bought, or the account has paid). Nothing is blocked by it; it only says what the pack is and what follows it.
 */
export function packNudgeLines(
  m: { monthPaise: number; yearlyMonthsCharged: number; pack: { available: boolean; pricePaise: number; days: number; maxClients: number }; perClient: { includedClients: number; extraMonthlyPaise: number } },
  accountType: "firm" | "institution",
): string[] | null {
  if (!m.pack.available) return null
  const lines = [ladderLine({ monthlyPaise: m.monthPaise, yearlyMonthsCharged: m.yearlyMonthsCharged, packPricePaise: m.pack.pricePaise, packDays: m.pack.days })]
  if (accountType === "firm") {
    const c = clientsLine({ includedClients: m.perClient.includedClients, extraClientMonthlyPaise: m.perClient.extraMonthlyPaise })
    if (c) lines.push(c)
    lines.push(`The trial pack covers up to ${m.pack.maxClients} clients.`)
  }
  return lines
}

/** For a Professional: what the monthly price includes and what each further client adds. Null for a plan with no clients. */
export function clientsLine(p: Pick<PlanWire, "includedClients" | "extraClientMonthlyPaise">): string | null {
  return p.includedClients > 0 ? `Includes ${p.includedClients} clients, then ${formatRupees(p.extraClientMonthlyPaise)} a month for each further client.` : null
}

/** The wording for a running offer. Never "discount applied": the offer is simply the price. */
export function offerLabel(listPaise: number, offerPaise: number): string | null {
  if (!(listPaise > 0) || !(offerPaise < listPaise)) return null
  return `Festive offer: ${Math.round((1 - offerPaise / listPaise) * 100)}% off`
}

/** A firm may add one more client only while used < cap. A null cap (a firm that pays monthly or yearly) means no limit: the price follows the count. */
export function canAddClient(used: number, cap: number | null): boolean {
  return cap === null || used < cap
}

/** The words for the one limit left: the trial pack covers a few clients. Must equal the refusal in dpdp_create_client_org (drizzle/0755). */
export function capMessage(cap: number, includedClients: number, extraClientMonthlyPaise: number): string {
  return `Your trial pack covers up to ${cap} client organisations. To add more, start the monthly or yearly plan: it covers any number of clients (${formatRupees(extraClientMonthlyPaise)} a month for each client beyond ${includedClients}).`
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

/** The one Professional plan (there are no tiers any more); undefined only if the plans have not arrived. */
export function firmPlan(plans: PlanWire[]): PlanWire | undefined {
  return plans.find((p) => p.accountType === "firm")
}
