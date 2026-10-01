// DPDP billing emails -- the receipt, the trial reminders and the renewal reminders.
// Used by dpdp-pay (receipt, sent when the Razorpay webhook records a payment) and
// dpdp-lifecycle-email (reminders, sent by the daily pg_cron job).
//
// PURE like mail-outbound.ts / mail-taxonomy.ts: no Deno global, no supabase-js, no clock;
// bun tests it (src/lib/services/dpdp-billing-mail.test.ts). The only side effect is
// sendViaResend, which takes the API key as an argument and uses fetch.
//
// WORDING RULES (dpdp-app/scripts/check-claims.mjs spirit): plain, factual, no "instant",
// no "secure", no "guaranteed". The two promises that ARE true and ARE the owner's own
// rule are said plainly: access never locks, and the card is entered on Razorpay's page.

import { type OutboundEnvelope, resendPayload } from "./mail-outbound.ts"

export type ReminderKind = "trial10" | "trial3" | "trial0" | "renew30" | "renew7"
export const REMINDER_KINDS: readonly ReminderKind[] = ["trial10", "trial3", "trial0", "renew30", "renew7"]

export type Rendered = { subject: string; text: string; html: string }

export function rupees(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN")}`
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function toHtml(lines: string[]): string {
  return `<div style="font-family:sans-serif;max-width:520px">${lines.map((l) => l === "" ? "<br>" : `<p style="margin:4px 0">${esc(l)}</p>`).join("")}</div>`
}

/** "5 Oct 2026" -- fixed format so the text does not depend on the server's locale data. */
export function dateLabel(ymdOrIso: string): string {
  const d = new Date(ymdOrIso)
  if (Number.isNaN(d.getTime())) return ymdOrIso
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Who issues the receipt. Same values as company.* in dpdp-app/data/veridian-facts.yaml (owner gave the GSTIN in chat, 2026-10-01); a test pins them equal. */
export const SELLER = {
  legalName: "SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED",
  gstin: "09AAZCS4477M1Z3",
  cin: "U74999UP2017PTC098453",
  registeredOffice: "B-1105, Plot No. 14, Shipra Krishna Vista, Ahinsa Khand-1, Indirapuram, Ghaziabad, Uttar Pradesh 201014, India",
} as const

export type ReceiptInput = {
  orgName: string
  plan: "firm" | "institution"
  interval: "month" | "year"
  amountPaise: number
  periodStart: string
  confirmedAt: string
  /** Razorpay's payment id, when the payment was made online. Shown so the owner can quote it. */
  razorpayPaymentId?: string | null
}

export function renderReceipt(d: ReceiptInput): Rendered {
  const planLabel = d.plan === "institution" ? "Institution edition" : "Firm edition"
  const intervalLabel = d.interval === "year" ? "Yearly" : "Monthly"
  const subject = `Your VERIDIAN receipt -- ${d.orgName} (${rupees(d.amountPaise)})`
  const lines = [
    `Thank you -- your payment for ${d.orgName} is confirmed.`,
    ``,
    `Plan: ${planLabel}, ${intervalLabel}`,
    `Amount: ${rupees(d.amountPaise)}`,
    `Billing period start: ${dateLabel(d.periodStart)}`,
    `Confirmed: ${dateLabel(d.confirmedAt)}`,
    d.razorpayPaymentId ? `Paid online through Razorpay. Payment reference: ${d.razorpayPaymentId}` : null,
    ``,
    `This is your receipt -- keep it for your records. Questions? Just reply to this email.`,
    ``,
    `-- VERIDIAN AI DPDP`,
    ``,
    `Issued by ${SELLER.legalName}`,
    `GSTIN: ${SELLER.gstin} | CIN: ${SELLER.cin}`,
    `Registered office: ${SELLER.registeredOffice}`,
  ].filter((l): l is string => l !== null)
  return { subject, text: lines.join("\n"), html: toHtml(lines) }
}

export type ReminderInput = {
  kind: ReminderKind
  orgName: string
  /** Whole days from now to the end of the trial / the renewal date (0 on the day, never negative). */
  daysLeft: number
  /** The trial end date or the renewal date, ISO. */
  dueDate: string
  priceLabel: string
  /** Where the owner goes to pay: the app's own page (its Billing pill), https. */
  appUrl: string
}

const PAY_LINES = (priceLabel: string, appUrl: string): string[] => [
  `To continue on the yearly plan (${priceLabel} a year), open your owner page and press Billing, bottom left:`,
  appUrl,
  `You can pay online -- the card, UPI or net-banking details are entered on Razorpay's own page, never on ours -- or by bank transfer and press "I have paid". Either way we email you a receipt once the payment is confirmed.`,
]

const DAYS = (n: number) => `${n} day${n === 1 ? "" : "s"}`

export function renderReminder(r: ReminderInput): Rendered {
  const due = dateLabel(r.dueDate)
  let subject: string
  let lines: string[]
  switch (r.kind) {
    case "trial10":
    case "trial3":
      subject = `Your free trial ends in ${DAYS(r.daysLeft)} -- ${r.orgName}`
      lines = [
        `Your free trial of VERIDIAN DPDP for ${r.orgName} ends on ${due}, ${DAYS(r.daysLeft)} from now.`,
        ``,
        `Nothing stops working when it ends: your data stays, and access to your account does not change. This is a heads-up so you can plan the payment.`,
        ``,
        ...PAY_LINES(r.priceLabel, r.appUrl),
      ]
      break
    case "trial0":
      subject = `Your free trial has ended -- your data is safe -- ${r.orgName}`
      lines = [
        `The free trial of VERIDIAN DPDP for ${r.orgName} ended on ${due}.`,
        ``,
        `Your data is safe and your access is unchanged: you can keep working exactly as before. We will not lock you out of your own compliance work over an unpaid invoice.`,
        ``,
        ...PAY_LINES(r.priceLabel, r.appUrl),
      ]
      break
    case "renew30":
    case "renew7":
      subject = `Your yearly plan renews on ${due} -- ${r.orgName}`
      lines = [
        `Your yearly plan for ${r.orgName} comes up for renewal on ${due}, ${DAYS(r.daysLeft)} from now.`,
        ``,
        `To renew (${r.priceLabel} for the year), open your owner page and press Billing, bottom left:`,
        r.appUrl,
        `You can pay online through Razorpay or by bank transfer. We email you a receipt once the payment is confirmed. Your access does not stop if you pay a little late.`,
      ]
      break
  }
  lines.push(``, `Questions? Just reply to this email.`, ``, `-- VERIDIAN AI DPDP`)
  return { subject, text: lines.join("\n"), html: toHtml(lines) }
}

/** "Addresses that can never receive mail": reserved example/test domains. Same rule as dpdp-monday-email/render.ts's isDeliverableAddress (the test pins them together). */
export function isDeliverableAddress(email: string): boolean {
  const at = email.trim().toLowerCase().lastIndexOf("@")
  if (at <= 0) return false
  const domain = email.trim().toLowerCase().slice(at + 1)
  if (!domain || !domain.includes(".")) return false
  if (/(^|\.)(test|example|invalid|localhost)$/.test(domain)) return false
  if (/^(example\.(com|net|org))$/.test(domain) || /\.example\.(com|net|org)$/.test(domain)) return false
  return true
}

/** Sends one message through Resend. Returns Resend's message id; throws with a short reason on a non-2xx. */
export async function sendViaResend(apiKey: string, to: string, out: OutboundEnvelope, body: { html: string; text: string }): Promise<string> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(resendPayload(to, out, body)),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
  return String((json as { id?: string }).id ?? "")
}
