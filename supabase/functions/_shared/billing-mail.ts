// DPDP billing emails -- the receipt, the trial reminders and the renewal reminders.
// Used by dpdp-pay (receipt, sent when the Razorpay webhook records a payment) and
// dpdp-lifecycle-email (reminders, sent by the daily pg_cron job).
//
// PURE like mail-outbound.ts / mail-taxonomy.ts: no Deno global, no supabase-js, no clock;
// bun tests it (src/lib/services/dpdp-billing-mail.test.ts). The only side effect is
// sendViaResend, which takes the API key as an argument and uses fetch.
//
// WORDING RULES (dpdp-app/scripts/check-claims.mjs spirit): plain, factual, no "instant",
// no "secure", no "guaranteed". The promises that ARE true are said plainly: the card is entered
// on Razorpay's page, the data is safe, and (policy of 2026-10-06, drizzle/0734) the working
// screens pause only after the trial, the due day and a short grace, never the data, the payment
// screen, the download, a breach record or a grievance answer.

import { type OutboundEnvelope, resendPayload } from "./mail-outbound.ts"

import { brandWrap } from "./brand-mail.ts"

export type ReminderKind = "trial10" | "trial3" | "trial0" | "renew30" | "renew7"
export const REMINDER_KINDS: readonly ReminderKind[] = ["trial10", "trial3", "trial0", "renew30", "renew7"]

export type Rendered = { subject: string; text: string; html: string }

export function rupees(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN")}`
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** One line for a Subject: an organisation name is free text (the sign-up RPC only trims it), so a line break, tab or Unicode line separator in it must not reach the Subject header. */
export function oneLine(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ").trim()
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
  const subject = `Your VERIDIAN receipt -- ${oneLine(d.orgName)} (${rupees(d.amountPaise)})`
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
    `Issued by ${SELLER.legalName}`,
    `GSTIN: ${SELLER.gstin} | CIN: ${SELLER.cin}`,
    `Registered office: ${SELLER.registeredOffice}`,
  ].filter((l): l is string => l !== null)
  return brandWrap({ subject, text: lines.join("\n") + "\n\n-- VERIDIAN AI DPDP", html: toHtml(lines) })
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
      subject = `Your free trial ends in ${DAYS(r.daysLeft)} -- ${oneLine(r.orgName)}`
      lines = [
        `Your free trial of VERIDIAN DPDP for ${r.orgName} ends on ${due}, ${DAYS(r.daysLeft)} from now.`,
        ``,
        `Everything keeps working through the end of the trial and for a few days after it, so there is time to arrange the payment. Your data stays safe either way. If the payment has still not been made by then, the working screens pause until it is, and you can always pay, download your data, and record a breach or answer a grievance. This is a heads-up so you can plan the payment.`,
        ``,
        ...PAY_LINES(r.priceLabel, r.appUrl),
      ]
      break
    case "trial0":
      subject = `Your free trial has ended -- your data is safe -- ${oneLine(r.orgName)}`
      lines = [
        `The free trial of VERIDIAN DPDP for ${r.orgName} ended on ${due}.`,
        ``,
        `Your data is safe, and everything still works for a few days while you arrange the payment. If it has not been made by then, the working screens pause until it is. Nothing is taken away, and you can always pay, download your data, and record a breach or answer a grievance.`,
        ``,
        ...PAY_LINES(r.priceLabel, r.appUrl),
      ]
      break
    case "renew30":
    case "renew7":
      subject = `Your yearly plan renews on ${due} -- ${oneLine(r.orgName)}`
      lines = [
        `Your yearly plan for ${r.orgName} comes up for renewal on ${due}, ${DAYS(r.daysLeft)} from now.`,
        ``,
        `To renew (${r.priceLabel} for the year), open your owner page and press Billing, bottom left:`,
        r.appUrl,
        `You can pay online through Razorpay or by bank transfer. We email you a receipt once the payment is confirmed. If you pay a little late, everything still works for a few days first.`,
      ]
      break
  }
  lines.push(``, `Questions? Just reply to this email.`)
  return brandWrap({ subject, text: lines.join("\n"), html: toHtml(lines) })
}

export type BillingDueInput = {
  orgName: string
  state: "DUE" | "GRACE" | "LOCKED"
  /** dpdp.billing_due_line(state), the one calm sentence, worded in the database so the screens and the e-mails never drift apart. */
  line: string
  role: "owner" | "head of department" | "billing contact"
  payUrl: string
  unsubscribeUrl: string
  /** 90+ days past the period end and this account has not yet had the final download notice. */
  finalDownload: boolean
  downloadUrl: string
}

/**
 * The weekly note to an account's own contacts while it is DUE, in GRACE or LOCKED (drizzle/0734). Calm on purpose: the data is safe, nothing is
 * removed, and the way to pay is one link. Every message carries a one-click unsubscribe link; the contact can stop these and nothing else changes.
 * The final-download variant goes once, when the account is 90+ days past its period end.
 */
export function renderBillingDue(d: BillingDueInput): Rendered {
  const subject = d.finalDownload
    ? `Please download a copy of your data -- ${oneLine(d.orgName)}`
    : `A gentle note about payment -- ${oneLine(d.orgName)}`
  const lines = [
    d.line,
    ``,
    d.finalDownload
      ? `It has been a while, so this is a last reminder to take a copy of what is kept for ${d.orgName}: the jobs and the dated record. Your data is kept for a year in all, and the owner can download it here:`
      : d.role === "owner" || d.role === "billing contact"
      ? `To pay for ${d.orgName}, open:`
      : `The owner of ${d.orgName} can pay here, so please let them know:`,
    d.finalDownload ? d.downloadUrl : d.payUrl,
    ``,
    `You can pay by bank transfer or UPI and tell us on that page. We email a receipt once the payment is confirmed.`,
    ``,
    `You get this note because you are a contact for the account (${d.role}). To stop these notes, one click:`,
    d.unsubscribeUrl,
  ]
  return brandWrap({ subject, text: lines.join("\n") + "\n\n-- VERIDIAN AI DPDP", html: toHtml(lines) })
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

/** Sends one message through Resend. Returns Resend's message id; throws with a short reason on a non-2xx.
 * `idempotencyKey` (Resend's Idempotency-Key header, kept for 24 hours) makes a repeat of the SAME logical
 * message a no-op on Resend's side: if a first attempt was accepted but we never recorded it, a retry
 * returns the first send instead of mailing again. */
export async function sendViaResend(apiKey: string, to: string, out: OutboundEnvelope, body: { html: string; text: string }, idempotencyKey?: string): Promise<string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey.slice(0, 256)
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify(resendPayload(to, out, body)),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
  return String((json as { id?: string }).id ?? "")
}

/** One reminder = one key, for ever: the same organisation + reminder key always maps to the same string. */
export function reminderIdempotencyKey(orgId: string, reminderKey: string): string {
  return `dpdp-reminder/${orgId}/${reminderKey}`
}

/**
 * Deliver a reminder the caller has already CLAIMED, without ever mailing it twice.
 * The old flow put the send, the mail-log write and "mark sent" in one try block, so ANY failure after
 * Resend had accepted the mail (the log write, or the mark) fell into the catch, marked the reminder
 * 'failed' and made tomorrow's run send it again. Here only a failure of the SEND itself is "failed".
 * Once the mail is accepted: the log write is best effort, and "mark sent" is retried; if it still
 * cannot be recorded the reminder stays 'claimed' (the 30-minute stale-claim rule then re-offers it) and
 * the Idempotency-Key on the send makes that repeat a no-op at Resend. Returns what happened.
 */
export async function deliverClaimedReminder(steps: {
  send: () => Promise<string>
  afterSend: (messageId: string) => Promise<void>
  markSent: () => Promise<boolean>
  markFailed: (message: string) => Promise<void>
  attempts?: number
}): Promise<{ status: "sent" | "failed"; markRecorded: boolean; error?: string }> {
  let messageId: string
  try {
    messageId = await steps.send()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    try { await steps.markFailed(message) } catch { /* the claim goes stale in 30 minutes and is re-offered */ }
    return { status: "failed", markRecorded: false, error: message }
  }
  try { await steps.afterSend(messageId) } catch { /* the mail is sent; a missing log row must not cause a second one */ }
  let recorded = false
  for (let i = 0; i < (steps.attempts ?? 3) && !recorded; i++) {
    try { recorded = await steps.markSent() } catch { recorded = false }
  }
  return { status: "sent", markRecorded: recorded }
}
