// DPDP sales lifecycle -- the daily reminder run. pg_cron (drizzle/0673, job
// `dpdp-sales-lifecycle`, 04:00 UTC = 09:30 IST) posts {"job":"sales_lifecycle"} here.
//
// WHAT IT SENDS, to the ORGANISATION OWNER only:
//   trial10 / trial3 / trial0   10 days before, 3 days before, and the day the 30-day free trial
//                               ends ("trial ended, your data is safe, access unchanged")
//   renew30 / renew7            30 and 7 days before a yearly plan's anniversary
// The payment-received receipt is NOT sent from here: dpdp-pay sends it the moment its webhook
// books a payment.
//
// WHO IS DUE is decided in the database (public.dpdp_sales_due_reminders), including the rule that
// keeps this from mass-mailing: each reminder has a 3-day catch-up window, so an organisation whose
// trial ended months ago, or whose renewal is months away, is in no window and gets nothing. This
// function only sends what the database lists, once: dpdp_sales_reminder_claim takes a reminder
// before it is sent and dpdp_sales_reminder_mark records the result, so two overlapping runs, or a
// retry, cannot send the same reminder twice. A failed SEND is marked 'failed' and the next day's
// run (still inside the window) tries it again. Anything that goes wrong AFTER Resend accepted the
// mail (the mail-log write, the 'sent' mark) never makes it 'failed': the mark is retried, and the
// send carries an Idempotency-Key (org + reminder key) so even a stale-claim repeat is a no-op at Resend.
// (deliverClaimedReminder in _shared/billing-mail.ts; src/lib/services/dpdp-reminder-delivery.test.ts.)
//
// RECIPIENT GUARD: an address on a reserved domain (example.*, *.test, localhost, ...) is skipped
// without being claimed -- the same isDeliverableAddress rule dpdp-monday-email uses.
//
// DRY RUN: no RESEND_API_KEY (or {"dryRun":true}) renders and counts what WOULD go out and sends
// and records nothing, so adding the key later does not find those reminders already "used".
//
// SECURITY: deployed with verify_jwt FALSE (the cron sends a Vault secret, not a Supabase JWT);
// the bearer is checked here against DPDP_TIMER_SECRET when set, else through
// public.dpdp_timer_check_bearer (drizzle/0608, the same Vault secret the cron reads). A missing or
// short bearer, or no secret anywhere, refuses everything (fail closed). One public mailbox: From
// "VERIDIAN AI DPDP <dpdp@veridian-aios.com>", class sales_chain (trial) / invoice (renewal), so a
// reply is filed in the single inbox already labelled.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { buildOutbound, foreignSenderWarning, logOutbound, resolveFrom } from "../_shared/mail-outbound.ts"
import type { MailClass } from "../_shared/mail-taxonomy.ts"
import { type ReminderKind, REMINDER_KINDS, deliverClaimedReminder, isDeliverableAddress, reminderIdempotencyKey, renderBillingDue, renderReminder, rupees, sendViaResend } from "../_shared/billing-mail.ts"

const env = (k: string): string => Deno.env.get(k) ?? ""
const SUPABASE_URL = env("SUPABASE_URL")
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const TIMER_SECRET = env("DPDP_TIMER_SECRET")
const RESEND_API_KEY = env("RESEND_API_KEY")
const EMAIL_FROM = resolveFrom(env("DPDP_EMAIL_FROM"))
const APP_ORIGIN = (env("APP_ORIGIN") || "https://dpdp.veridian-aios.com").replace(/\/+$/, "")
const SENDER_WARNING = foreignSenderWarning(EMAIL_FROM)
if (SENDER_WARNING) console.warn(SENDER_WARNING)

/** Stop starting new sends after this long; the next day's run continues (the window is 3 days). */
const TIME_BUDGET_MS = 100_000

type Due = {
  orgId: string; orgName: string; product: string | null; kind: ReminderKind; reminderKey: string; dueDate: string; daysLeft: number
  ownerEmail: string; ownerMembershipId: string; ownerIdentityId: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

const serviceClient = (): SupabaseClient => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

async function bearerOk(req: Request): Promise<boolean> {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim())
  const presented = m?.[1]?.trim() ?? ""
  if (presented.length < 24) return false
  if (TIMER_SECRET) return TIMER_SECRET.length >= 24 && constantTimeEqual(presented, TIMER_SECRET)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return false
  try {
    const { data, error } = await serviceClient().rpc("dpdp_timer_check_bearer", { p_bearer: presented })
    return !error && data === true
  } catch {
    return false
  }
}

const classFor = (k: ReminderKind): MailClass => (k.startsWith("renew") ? "invoice" : "sales_chain")

type BillingDue = {
  orgId: string; orgName: string; state: "DUE" | "GRACE" | "LOCKED"; email: string; role: "owner" | "head of department" | "billing contact"
  weekKey: string; line: string; unsubscribeToken: string; finalDownload: boolean
}

// drizzle/0734, job "billing_due" (weekly, pg_cron dpdp-billing-due): the calm "payment for this account is due" note to an account's OWN contacts
// (owner, head of department, billing contact) while it is DUE, in GRACE or LOCKED. They go on for as long as the account is unpaid, and each one
// carries a one-click unsubscribe link (dpdp_unsubscribe, which also writes the audit trail). WHO is due, once per contact per ISO week, and who has
// opted out, is decided in the database (dpdp_billing_due_worklist); this only sends what it lists and reports the result back.
async function runBillingDue(sb: SupabaseClient, dryRun: boolean, started: number) {
  const { data, error } = await sb.rpc("dpdp_billing_due_worklist", { p_dry_run: dryRun })
  if (error) return { ok: false, error: error.message }
  const due = (data as BillingDue[] | null) ?? []
  const summary = { ok: true, job: "billing_due", dryRun, due: due.length, sent: 0, would_send: 0, failed: 0, skipped: 0, partial: false }
  const finalDownloadOrgs = new Set<string>()
  for (const d of due) {
    if (Date.now() - started > TIME_BUDGET_MS) { summary.partial = true; break }
    if (!d.email || !isDeliverableAddress(d.email)) {
      summary.skipped++
      if (!dryRun) await sb.rpc("dpdp_billing_notice_mark", { p_org_id: d.orgId, p_email: d.email, p_week_key: d.weekKey, p_status: "failed" })
      continue
    }
    const rendered = renderBillingDue({
      orgName: d.orgName, state: d.state, line: d.line, role: d.role, payUrl: `${APP_ORIGIN}/app/`, downloadUrl: `${APP_ORIGIN}/app/`,
      unsubscribeUrl: `${APP_ORIGIN}/unsubscribe/#${d.unsubscribeToken}`, finalDownload: d.finalDownload,
    })
    if (dryRun) { summary.would_send++; continue }
    const out = buildOutbound("invoice", rendered.subject, { from: EMAIL_FROM })
    try {
      const messageId = await sendViaResend(RESEND_API_KEY, d.email, out, rendered, `dpdp-billing-due/${d.orgId}/${d.weekKey}/${d.email}`)
      try { await logOutbound(sb, { ref: out.ref, cls: "invoice", to: d.email, subject: out.subject, providerMessageId: messageId || null, membershipId: null, orgId: d.orgId }) } catch { /* the mail is sent; a missing log row must not cause a second one */ }
      await sb.rpc("dpdp_billing_notice_mark", { p_org_id: d.orgId, p_email: d.email, p_week_key: d.weekKey, p_status: "sent" })
      if (d.finalDownload) finalDownloadOrgs.add(d.orgId)
      summary.sent++
    } catch (e) {
      summary.failed++
      await sb.rpc("dpdp_billing_notice_mark", { p_org_id: d.orgId, p_email: d.email, p_week_key: d.weekKey, p_status: "failed" })
      console.warn(`billing_due send failed for org ${d.orgId}: ${e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160)}`)
    }
  }
  for (const orgId of finalDownloadOrgs) await sb.rpc("dpdp_billing_final_download_mark", { p_org_id: orgId })
  console.log(JSON.stringify({ evt: "dpdp-lifecycle-email", job: "billing_due", dryRun, due: summary.due, sent: summary.sent, failed: summary.failed, skipped: summary.skipped }))
  return summary
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405)
  if (!(await bearerOk(req))) return json({ error: "Unauthorized" }, 401)
  let body: { job?: string; dryRun?: boolean } = {}
  try {
    body = await req.json()
  } catch { /* an empty body is the same as the default job */ }
  if (body.job && body.job !== "sales_lifecycle" && body.job !== "billing_due") return json({ error: "Unknown job" }, 400)

  const started = Date.now()
  const dryRun = body.dryRun === true || !RESEND_API_KEY
  const sb = serviceClient()
  if (body.job === "billing_due") return json(await runBillingDue(sb, dryRun, started))

  const { data: priceData } = await sb.rpc("dpdp_billing_prices", {})
  const yearPaise = Number((priceData as { yearPaise?: number } | null)?.yearPaise ?? 0)
  if (!yearPaise) return json({ ok: false, error: "Could not read the price" }, 500)
  const priceLabel = rupees(yearPaise)

  const { data, error } = await sb.rpc("dpdp_sales_due_reminders", {})
  if (error) return json({ ok: false, error: error.message }, 500)
  const due = (data as Due[] | null) ?? []

  const summary = { ok: true, dryRun, due: due.length, sent: 0, would_send: 0, failed: 0, skipped: 0, partial: false, details: [] as Array<{ orgId: string; kind: string; status: string; error?: string }> }
  for (const d of due) {
    if (Date.now() - started > TIME_BUDGET_MS) { summary.partial = true; break }
    if (!REMINDER_KINDS.includes(d.kind) || !d.ownerEmail || !isDeliverableAddress(d.ownerEmail)) { summary.skipped++; continue }
    const rendered = renderReminder({ kind: d.kind, orgName: d.orgName, daysLeft: d.daysLeft, dueDate: d.dueDate, priceLabel, appUrl: `${APP_ORIGIN}/app/` })
    if (dryRun) { summary.would_send++; summary.details.push({ orgId: d.orgId, kind: d.kind, status: "would_send" }); continue }

    const { data: claim, error: claimErr } = await sb.rpc("dpdp_sales_reminder_claim", { p_org_id: d.orgId, p_reminder_key: d.reminderKey, p_to_email: d.ownerEmail })
    if (claimErr || (claim as { claimed?: boolean } | null)?.claimed !== true) { summary.skipped++; continue }

    const cls = classFor(d.kind)
    const out = buildOutbound(cls, rendered.subject, { from: EMAIL_FROM })
    const result = await deliverClaimedReminder({
      send: () => sendViaResend(RESEND_API_KEY, d.ownerEmail, out, rendered, reminderIdempotencyKey(d.orgId, d.reminderKey)),
      afterSend: async (messageId) => {
        await logOutbound(sb, { ref: out.ref, cls, to: d.ownerEmail, subject: out.subject, providerMessageId: messageId || null, membershipId: d.ownerMembershipId, orgId: d.orgId })
      },
      markSent: async () => {
        const { error } = await sb.rpc("dpdp_sales_reminder_mark", { p_org_id: d.orgId, p_reminder_key: d.reminderKey, p_status: "sent" })
        return !error
      },
      markFailed: async (message) => {
        await sb.rpc("dpdp_sales_reminder_mark", { p_org_id: d.orgId, p_reminder_key: d.reminderKey, p_status: "failed", p_error: message })
      },
    })
    if (result.status === "sent") {
      summary.sent++
      summary.details.push({ orgId: d.orgId, kind: d.kind, status: result.markRecorded ? "sent" : "sent_unrecorded" })
    } else {
      summary.failed++
      summary.details.push({ orgId: d.orgId, kind: d.kind, status: "failed", error: (result.error ?? "").slice(0, 200) })
    }
  }
  summary.details = summary.details.slice(0, 150)
  console.log(JSON.stringify({ evt: "dpdp-lifecycle-email", job: "sales_lifecycle", dryRun, due: summary.due, sent: summary.sent, failed: summary.failed, skipped: summary.skipped }))
  return json(summary)
})
