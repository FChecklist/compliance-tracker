// VERIDIAN Review Framework gap-closure, Commercial/Subscription & Pricing
// Model, 2026-08-07: turns the two real, existing signals -- seat count
// (org-license-service.ts) and AI spend (token-usage-service.ts's
// getOrgUsageForPeriod, itself built on tokenUsageLedger) -- into an actual
// customer-facing invoice, priced against platform_billing_plans (the
// backend counterpart to src/app/pricing/page.tsx's marketing tiers).
// Deliberately reuses those two functions rather than re-deriving seat/
// usage numbers a second way -- this file's only new logic is pricing math
// and invoice persistence. See payment-gateway-client.ts for why this
// stops at "generate a correct invoice" and does not attempt a real charge.
import { db, organisations, platformBillingPlans, platformBillingInvoices } from "@/lib/db"
import { eq, and, desc, sql } from "drizzle-orm"
import { getLicenseStatus } from "@/lib/org-license-service"
import { getOrgUsageForPeriod } from "@/lib/services/token-usage-service"
import { chargeInvoice, type PaymentGatewayResult } from "@/lib/services/payment-gateway-client"

export type BillingPlan = typeof platformBillingPlans.$inferSelect
export type BillingInvoice = typeof platformBillingInvoices.$inferSelect

export async function listBillingPlans(): Promise<BillingPlan[]> {
  return db.query.platformBillingPlans.findMany({ where: eq(platformBillingPlans.isActive, true) })
}

export async function getBillingPlanForOrg(orgId: string): Promise<BillingPlan | null> {
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
  if (!org) return null
  const plan = await db.query.platformBillingPlans.findFirst({ where: eq(platformBillingPlans.planKey, org.plan) })
  // An org on a plan key with no priced row yet (e.g. a custom/legacy plan
  // string) falls back to 'free' rather than throwing -- billing math
  // should degrade to "no charge" on an unpriced plan, never crash a
  // dashboard render.
  return plan ?? (await db.query.platformBillingPlans.findFirst({ where: eq(platformBillingPlans.planKey, "free") })) ?? null
}

export type InvoiceLineItems = {
  seatCount: number
  baseFeeUsd: number
  seatFeeUsd: number
  aiCostUsd: number
  includedAiCostUsd: number
  overageAiCostUsd: number
  overageChargeUsd: number
  totalUsd: number
}

/** Pure pricing math -- unit-testable independently of the DB/period plumbing around it. */
export function computeInvoiceLineItems(plan: BillingPlan, seatCount: number, aiCostUsd: number): InvoiceLineItems {
  const baseFeeUsd = Number(plan.baseFeeMonthlyUsd)
  const seatFeeUsd = Number(plan.perSeatMonthlyUsd) * seatCount
  const includedAiCostUsd = Number(plan.includedAiCostUsd)
  const overageAiCostUsd = Math.max(0, aiCostUsd - includedAiCostUsd)
  const overageChargeUsd = overageAiCostUsd * Number(plan.overageMultiplier)
  const totalUsd = baseFeeUsd + seatFeeUsd + overageChargeUsd
  return { seatCount, baseFeeUsd, seatFeeUsd, aiCostUsd, includedAiCostUsd, overageAiCostUsd, overageChargeUsd, totalUsd }
}

function startOfCurrentMonthUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

function startOfNextMonthUtc(from: Date): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1))
}

/** Live, unpersisted preview of the current billing period -- for a dashboard widget, no invoice row written. */
export async function previewCurrentPeriodInvoice(orgId: string): Promise<{ plan: BillingPlan; periodStart: Date; periodEnd: Date; lineItems: InvoiceLineItems } | null> {
  const plan = await getBillingPlanForOrg(orgId)
  if (!plan) return null
  const periodStart = startOfCurrentMonthUtc()
  const periodEnd = startOfNextMonthUtc(periodStart)
  const [license, usage] = await Promise.all([
    getLicenseStatus(orgId),
    getOrgUsageForPeriod(orgId, periodStart, periodEnd),
  ])
  return { plan, periodStart, periodEnd, lineItems: computeInvoiceLineItems(plan, license.activeSeatCount, usage.estimatedCostUsd) }
}

export async function listInvoicesForOrg(orgId: string): Promise<BillingInvoice[]> {
  return db.query.platformBillingInvoices.findMany({
    where: eq(platformBillingInvoices.orgId, orgId),
    orderBy: desc(platformBillingInvoices.periodStart),
  })
}

/**
 * Generates (or, if one already exists for this exact period, recomputes
 * and updates -- idempotent, same posture as the exchange-rate daily
 * refresh) a finalized invoice for one org/period. Attempts a real charge
 * via payment-gateway-client.ts; a "not_configured" result is expected and
 * non-fatal today (see that file's header) -- the invoice still generates
 * correctly, it just has no paymentGatewayRef until a real processor is
 * wired.
 */
export async function generateInvoiceForPeriod(
  orgId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<{ invoice: BillingInvoice; payment: PaymentGatewayResult }> {
  const plan = await getBillingPlanForOrg(orgId)
  if (!plan) throw new Error(`No billing plan resolved for org ${orgId} (not even the 'free' fallback -- has the platform_billing_plans seed run?)`)

  const [license, usage] = await Promise.all([
    getLicenseStatus(orgId),
    getOrgUsageForPeriod(orgId, periodStart, periodEnd),
  ])
  const lineItems = computeInvoiceLineItems(plan, license.activeSeatCount, usage.estimatedCostUsd)

  const existing = await db.query.platformBillingInvoices.findFirst({
    where: and(
      eq(platformBillingInvoices.orgId, orgId),
      eq(platformBillingInvoices.periodStart, periodStart),
      eq(platformBillingInvoices.periodEnd, periodEnd)
    ),
  })

  const values = {
    planId: plan.id,
    periodStart,
    periodEnd,
    seatCount: lineItems.seatCount,
    baseFeeUsd: lineItems.baseFeeUsd.toString(),
    seatFeeUsd: lineItems.seatFeeUsd.toString(),
    aiCostUsd: lineItems.aiCostUsd.toString(),
    includedAiCostUsd: lineItems.includedAiCostUsd.toString(),
    overageAiCostUsd: lineItems.overageAiCostUsd.toString(),
    overageChargeUsd: lineItems.overageChargeUsd.toString(),
    totalUsd: lineItems.totalUsd.toString(),
    status: "finalized" as const,
    generatedAt: new Date(),
  }

  let invoice: BillingInvoice
  if (existing) {
    // Re-running generation for an already-generated period recomputes and
    // updates in place rather than duplicating -- keeps invoiceNumber
    // stable (a real business document number should never get reassigned
    // by a re-run) while still reflecting a corrected usage figure if the
    // ledger changed since the first run.
    ;[invoice] = await db.update(platformBillingInvoices).set(values).where(eq(platformBillingInvoices.id, existing.id)).returning()
  } else {
    const [{ maxNumber }] = await db
      .select({ maxNumber: sql<number>`coalesce(max(${platformBillingInvoices.invoiceNumber}), 0)` })
      .from(platformBillingInvoices)
      .where(eq(platformBillingInvoices.orgId, orgId))
    ;[invoice] = await db.insert(platformBillingInvoices).values({ orgId, invoiceNumber: Number(maxNumber) + 1, ...values }).returning()
  }

  const payment = await chargeInvoice({ orgId, invoiceId: invoice.id, amountUsd: lineItems.totalUsd })
  if (payment.status === "charged") {
    ;[invoice] = await db.update(platformBillingInvoices).set({ status: "paid", paymentGatewayRef: payment.gatewayRef }).where(eq(platformBillingInvoices.id, invoice.id)).returning()
  }

  return { invoice, payment }
}

/** Convenience wrapper: generates the invoice for the just-completed calendar month (the normal monthly billing-run entry point). */
export async function generatePreviousMonthInvoice(orgId: string): Promise<{ invoice: BillingInvoice; payment: PaymentGatewayResult }> {
  const currentMonthStart = startOfCurrentMonthUtc()
  const previousMonthStart = new Date(Date.UTC(currentMonthStart.getUTCFullYear(), currentMonthStart.getUTCMonth() - 1, 1))
  return generateInvoiceForPeriod(orgId, previousMonthStart, currentMonthStart)
}
