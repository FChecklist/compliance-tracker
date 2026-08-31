// VERIDIAN Review Framework gap-closure, Commercial/Subscription & Pricing
// Model, 2026-08-07: the finding's recommended approach was "integrate a
// payment gateway" -- this file is the deliberate seam for that, not the
// integration itself. No real payment-processor credentials (Stripe,
// Razorpay, etc.) exist anywhere in this repo/environment, and choosing +
// provisioning one is a business decision for the Owner (which processor,
// what merchant account, what compliance posture for card data), not
// something an agent should fabricate or guess at. Every function here is
// honest about that: it returns a clear "not configured" result rather than
// pretending a charge succeeded. platform-billing-service.ts calls this for
// every invoice's payment step, so wiring a real gateway later is a matter
// of implementing chargeInvoice() against PAYMENT_GATEWAY_PROVIDER, not
// hunting down every call site that assumed billing = payment.
export type PaymentGatewayResult =
  | { status: "not_configured"; reason: string }
  | { status: "charged"; gatewayRef: string }
  | { status: "failed"; reason: string }

export function isPaymentGatewayConfigured(): boolean {
  // Deliberately env-gated rather than hardcoded false: this becomes real
  // the moment an Owner-provisioned processor's env var is actually set,
  // with zero call-site changes needed elsewhere.
  return Boolean(process.env.PAYMENT_GATEWAY_PROVIDER)
}

export async function chargeInvoice(input: {
  orgId: string
  invoiceId: string
  amountUsd: number
}): Promise<PaymentGatewayResult> {
  if (!isPaymentGatewayConfigured()) {
    return {
      status: "not_configured",
      reason:
        "No payment gateway is configured (PAYMENT_GATEWAY_PROVIDER unset). Invoices generate and total correctly, but no real charge is attempted -- see AGENTS.md Rule 7(e): this is the one step in the billing pipeline that requires explicit Owner confirmation before going live, not something an agent enables on its own.",
    }
  }
  // No provider is wired yet -- reaching here would mean the env var above
  // was set without a matching implementation added, which is itself a bug
  // to surface loudly rather than silently no-op.
  throw new Error(
    `PAYMENT_GATEWAY_PROVIDER=${process.env.PAYMENT_GATEWAY_PROVIDER} is set but chargeInvoice() has no implementation for it yet (invoice ${input.invoiceId}, org ${input.orgId}).`
  )
}
