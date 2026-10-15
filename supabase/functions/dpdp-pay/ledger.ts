// LEDGER C for Veridian DPDP -- the PURE half (no Deno global, no clock, no database; bun tests it: src/lib/services/dpdp-pay-ledger.test.ts).
// Owner order 2026-10-13: every payment, expense, revenue and commission is tracked at three connected levels with the same ids, nothing twice:
//   A = Razorpay's own ledger, B = the central ledger of IT SERVICES BY RAJAT AGARWAL, C = this website's own ledger (Supabase, schema dpdp, drizzle/0749).
// Spec: PAYMENT_LEDGER_ABC_SPEC_2026-10-13.md. Reference implementation in the games: tictactoe apps/edge/src/ledgerc.ts (same rules, same wording).
//
// THE IDS (each has exactly one meaning)
//   txn_id         "DPD-dpdp_<attempt id>" (logic.ts txnIdOf). One "Pay online" press = one dpdp.payment_attempt row = one txn_id. The same text is in the Razorpay
//                  order notes and the central payment row (B) and in dpdp.payment_attempt.txn_id (C, a generated column).
//   rzp_order_id   Razorpay's order, one per txn_id.
//   rzp_payment_id Razorpay's payment, one per ATTEMPT: a failed try and the paying try are two rows of dpdp.ledger_payment_attempt under the one txn_id.
//   rzp_refund_id  Razorpay's refund, one row of dpdp.ledger_refund.
//   commission     dpdp.referral_commission.id is the central payout's site_ref (central: UNIQUE(site, site_ref)): sending it again updates, never adds.
//
// WHAT IS KEPT PER ATTEMPT (success AND failure): amount, currency, status (authorized / captured / failed), method, bank, wallet, card network / type / issuer, the LAST
// FOUR digits of a card, a masked UPI id (ab***@bank), the bank reference (rrn, auth code), Razorpay's error code / description / source / step / reason, fee and GST on
// the fee, international flag, and the times of authorisation, capture and failure. A full card number or a full UPI id is never stored: the code below copies only the
// named fields out of Razorpay's message. The payer's e-mail and phone are NOT stored in C at all (the owner view shows the organisation's name only).
//
// ZERO DUPLICATION (enforced by the database, not by hope): ledger_payment_attempt.rzp_payment_id PRIMARY KEY; ledger_event_seen.rzp_event_id PRIMARY KEY (Razorpay's
// x-razorpay-event-id, or the derived key below when the header did not arrive); ledger_refund.rzp_refund_id PRIMARY KEY; ledger_commission_sync.commission_id PRIMARY KEY.
// Status only moves FORWARD (failed -> authorized -> captured): a late "failed" message can never undo a capture (SQL: dpdp_ledger_record_attempt).
//
// HOW C AND B DIFFER (each is deliberate; the owner report shows both so a difference is visible, never hidden)
//   1. Month. B dates a sale at Razorpay's capture time, C at the moment the website booked it (dpdp.payment.confirmed_at, a few seconds later). Both in INDIAN months.
//   2. What counts as a sale. A payment that has a Razorpay payment id (real money moved) and is not a test-mode payment. A payment recorded by bank transfer ("I have paid",
//      no Razorpay id) is never counted here and never sent to B.
//   3. Fee and tax. fee_paise is Razorpay's fee INCLUDING the GST on it; tax_paise is that GST.
//   4. Refunds. C counts refunds that are not "failed" (a refund Razorpay could not pay out moved no money).
//   5. Commission. DPDP has two states, pending and paid; they go to B as "accrued" and "paid". DPDP has NO "void" state, so a commission on a refunded sale stays accrued in B
//      and shows in the owner report under issues (commission_on_refunded_sale) for a human decision -- no clawback rule is invented here.
import { CENTRAL_SITE, txnIdOf } from "./logic.ts"

export { txnIdOf }

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown, max = 300): string | null => (v === null || v === undefined || v === "" ? null : String(v).slice(0, max))
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** A UPI id is kept masked (ab***@bank): enough to recognise, never enough to use. */
export function maskVpa(v: unknown): string | null {
  const s = str(v, 120)
  if (!s) return null
  const i = s.indexOf("@")
  return i > 0 ? s.slice(0, Math.min(2, i)) + "***" + s.slice(i) : s.slice(0, 2) + "***"
}

// ---------------------------------------------------------------- attempts (A -> C)
export type AttemptStatus = "authorized" | "captured" | "failed"

/** Which attempt status a Razorpay event stands for; null for events that are not about a payment attempt. */
export function attemptStatusOf(event: string): AttemptStatus | null {
  if (event === "payment.captured" || event === "order.paid" || event === "payment_link.paid") return "captured"
  if (event === "payment.authorized") return "authorized"
  if (event === "payment.failed") return "failed"
  return null
}

/** The attempt status a payment entity (as Razorpay's API returns it) stands for; null while it is only "created". */
export function attemptStatusOfEntity(status: unknown): AttemptStatus | null {
  const s = str(status, 20)
  if (s === "captured" || s === "refunded") return "captured"
  if (s === "authorized") return "authorized"
  if (s === "failed") return "failed"
  return null
}

/** What the database function dpdp_ledger_record_attempt takes: only the named, safe fields. Null when the entity has no payment id. */
export type AttemptRow = {
  rzpPaymentId: string; status: AttemptStatus; orderId: string | null; attemptHint: string | null; currency: string | null; amountPaise: number | null
  method: string | null; bank: string | null; wallet: string | null; cardNetwork: string | null; cardType: string | null; cardLast4: string | null; cardIssuer: string | null
  vpaMasked: string | null; rrn: string | null; authCode: string | null; international: boolean | null
  errorCode: string | null; errorDescription: string | null; errorSource: string | null; errorStep: string | null; errorReason: string | null
  feePaise: number | null; taxPaise: number | null; eventMs: number; createdMs: number | null
}

export function buildAttemptRow(ent: unknown, status: AttemptStatus, eventMs: number): AttemptRow | null {
  if (!isObj(ent)) return null
  const id = str(ent.id, 60)
  if (!id || !/^pay_\w{6,40}$/.test(id)) return null
  const a = isObj(ent.acquirer_data) ? ent.acquirer_data : null
  const card = isObj(ent.card) ? ent.card : null
  const notes = isObj(ent.notes) ? ent.notes : null
  const failed = status === "failed"
  const last4 = card?.last4 != null ? String(card.last4).replace(/\D/g, "").slice(-4) || null : null
  const created = num(ent.created_at)
  return {
    rzpPaymentId: id, status, orderId: str(ent.order_id, 60), attemptHint: str(notes?.attempt_id, 60), currency: str(ent.currency, 3)?.toUpperCase() ?? null,
    amountPaise: num(ent.amount) !== null ? Math.round(num(ent.amount)!) : null,
    method: str(ent.method, 20), bank: str(ent.bank, 20), wallet: str(ent.wallet, 30), cardNetwork: str(card?.network, 30), cardType: str(card?.type, 20), cardLast4: last4, cardIssuer: str(card?.issuer, 40),
    vpaMasked: maskVpa(ent.vpa), rrn: str(a?.rrn, 60), authCode: str(a?.auth_code, 30), international: typeof ent.international === "boolean" ? ent.international : null,
    errorCode: failed ? str(ent.error_code, 80) : null, errorDescription: failed ? str(ent.error_description, 300) : null, errorSource: failed ? str(ent.error_source, 40) : null,
    errorStep: failed ? str(ent.error_step, 40) : null, errorReason: failed ? str(ent.error_reason, 80) : null,
    feePaise: num(ent.fee) !== null ? Math.round(num(ent.fee)!) : null, taxPaise: num(ent.tax) !== null ? Math.round(num(ent.tax)!) : null,
    eventMs, createdMs: created !== null ? created * 1000 : null,
  }
}

// ---------------------------------------------------------------- refunds (A -> C)
export type RefundStatus = "pending" | "processed" | "failed"
export type RefundRow = { rzpRefundId: string; rzpPaymentId: string; currency: string | null; amountPaise: number; status: RefundStatus; createdMs: number | null }

/** One Razorpay refund (rfnd_...) from refund.created / refund.processed / refund.failed. Null when it does not name a refund and a payment. */
export function buildRefundRow(event: string, refund: unknown, nowMs: number): RefundRow | null {
  if (!isObj(refund)) return null
  const id = str(refund.id, 60), pay = str(refund.payment_id, 60)
  if (!id || !pay) return null
  const status: RefundStatus = event === "refund.processed" ? "processed" : event === "refund.failed" ? "failed" : refund.status === "processed" ? "processed" : refund.status === "failed" ? "failed" : "pending"
  const created = num(refund.created_at)
  return { rzpRefundId: id, rzpPaymentId: pay, currency: str(refund.currency, 3)?.toUpperCase() ?? null, amountPaise: Math.max(0, Math.round(num(refund.amount) ?? 0)), status, createdMs: created !== null ? created * 1000 : nowMs }
}

// ---------------------------------------------------------------- one webhook message
/** When the x-razorpay-event-id header did not arrive, the same event is still recognised: its name, the payment / refund / order it is about, and Razorpay's own time of it. */
export function derivedEventKey(ev: unknown): string | null {
  if (!isObj(ev)) return null
  const payload = isObj(ev.payload) ? ev.payload : {}
  const ent = (k: string): Json | null => (isObj(payload[k]) && isObj((payload[k] as Json).entity) ? ((payload[k] as Json).entity as Json) : null)
  const name = str(ev.event, 60), id = str(ent("payment")?.id ?? ent("refund")?.id ?? ent("order")?.id, 80), at = num(ev.created_at)
  return name && id && at ? `d:${name}:${id}:${at}` : null
}

export type LedgerEvent = {
  /** The header id when present, else the derived key; null when neither can be made (the rows themselves are idempotent anyway). */
  eventKey: string | null
  event: string | null
  attempt: AttemptRow | null
  refund: RefundRow | null
}

/** Reads one VERIFIED webhook body for the ledger. Never throws. A message about neither a payment attempt nor a refund yields attempt = refund = null. */
export function parseLedgerEvent(rawBody: string, eventIdHeader: string | null | undefined, nowMs: number): LedgerEvent {
  let ev: unknown
  try { ev = JSON.parse(rawBody) } catch { return { eventKey: null, event: null, attempt: null, refund: null } }
  if (!isObj(ev) || typeof ev.event !== "string") return { eventKey: null, event: null, attempt: null, refund: null }
  const header = (eventIdHeader ?? "").trim()
  const eventKey = header !== "" ? header.slice(0, 80) : derivedEventKey(ev)
  const payload = isObj(ev.payload) ? ev.payload : {}
  const entity = (k: string): unknown => (isObj(payload[k]) ? (payload[k] as Json).entity : null)
  const at = num(ev.created_at)
  const evMs = at !== null ? at * 1000 : nowMs
  const st = attemptStatusOf(ev.event)
  const attempt = st ? buildAttemptRow(entity("payment"), st, evMs) : null
  const refund = ev.event.startsWith("refund.") ? buildRefundRow(ev.event, entity("refund"), nowMs) : null
  return { eventKey, event: ev.event.slice(0, 60), attempt, refund }
}

// ---------------------------------------------------------------- Indian months
const IST = 19_800_000
export const monthKeyOf = (ms: number): string => { const d = new Date(ms + IST); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` }
export const prevMonthKey = (key: string): string => { const [y, m] = key.split("-").map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}` }

// ---------------------------------------------------------------- C -> B
// 29, not 30: the cron ticks every 30 minutes, and a tick can land a moment before the stored push time + 30 minutes, which skipped every second tick
// (the summary went out hourly). 29 minutes keeps it at most every 29 minutes and lets every tick through. Keep equal to migration 0750.
export const SUMMARY_EVERY_MS = 29 * 60_000
export const COMMISSION_RETRY_MS = 10 * 60_000

export type Summary = {
  site: string; period_key: string; currency: string; paid_count: number; failed_count: number; revenue_minor: number; fee_minor: number; tax_minor: number
  refunded_minor: number; commission_accrued_minor: number; commission_paid_minor: number
}
const n0 = (v: unknown): number => { const x = Math.round(Number(v ?? 0)); return Number.isFinite(x) && x >= 0 ? x : 0 }
/** The body of POST /api/pay/site-summary from one row of the database's month figures. */
export function buildSummaryBody(row: unknown, site: string = CENTRAL_SITE): Summary | null {
  if (!isObj(row) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(row.period_key ?? ""))) return null
  return {
    site, period_key: String(row.period_key), currency: row.currency === "USD" ? "USD" : "INR", paid_count: n0(row.paid_count), failed_count: n0(row.failed_count), revenue_minor: n0(row.revenue_minor),
    fee_minor: n0(row.fee_minor), tax_minor: n0(row.tax_minor), refunded_minor: n0(row.refunded_minor), commission_accrued_minor: n0(row.commission_accrued_minor), commission_paid_minor: n0(row.commission_paid_minor),
  }
}

export type CommissionRow = { id: string; rzpPaymentId: string; status: "accrued" | "paid"; amountPaise: number; partnerCode: string | null; partnerName: string | null; paidRef: string | null }
/** The body of POST /api/pay/commission. Null when the row cannot be sent (no amount, or "paid" without a payout reference). */
export function buildCommissionBody(r: CommissionRow, site: string = CENTRAL_SITE): Record<string, unknown> | null {
  if (!r.id || !r.rzpPaymentId || !(r.amountPaise > 0)) return null
  if (r.status === "paid" && !r.paidRef) return null
  return {
    site, site_ref: String(r.id).slice(0, 80), rzp_payment_id: r.rzpPaymentId, partner_code: (r.partnerCode ?? "unknown").slice(0, 80), ...(r.partnerName ? { partner_name: r.partnerName.slice(0, 120) } : {}),
    amount_minor: Math.round(r.amountPaise), currency: "INR", status: r.status, ...(r.status === "paid" ? { paid_ref: String(r.paidRef).slice(0, 80) } : {}),
  }
}

/** The database as the ledger code sees it: Supabase's rpc(), which answers { data, error }. */
export type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
export type Central = { url: string; key: string; site: string }
export type Deps = { rpc: Rpc; fetchFn: typeof fetch; central: Central | null }

export type SyncOut = { posted: number; kept: number; skipped: number; failed: number }

/**
 * Posts commission rows to the central ledger: new rows, and rows whose status changed since the last post (accrued -> paid). Test-mode payments and payments that never went
 * through Razorpay are never listed (the database function leaves them out). The central ledger answers 409 while the sale is not in B yet: the row then stays unsynced and
 * is retried no sooner than COMMISSION_RETRY_MS. A service that cannot be reached stops the run (it is tried again by the next tick).
 */
export async function syncCommissions(d: Deps, limit = 5): Promise<SyncOut> {
  const out: SyncOut = { posted: 0, kept: 0, skipped: 0, failed: 0 }
  if (!d.central) return out
  const { data, error } = await d.rpc("dpdp_ledger_commissions_to_post", { p_limit: Math.min(Math.max(limit, 1), 25), p_retry_seconds: COMMISSION_RETRY_MS / 1000 })
  if (error || !Array.isArray(data)) throw new Error(`commission worklist: ${error?.message ?? "no list"}`)
  for (const raw of data as Json[]) {
    const row: CommissionRow = {
      id: String(raw.id ?? ""), rzpPaymentId: String(raw.rzpPaymentId ?? ""), status: raw.status === "paid" ? "paid" : "accrued", amountPaise: Number(raw.amountPaise ?? 0),
      partnerCode: str(raw.partnerCode, 80), partnerName: str(raw.partnerName, 120), paidRef: str(raw.paidRef, 80),
    }
    const body = buildCommissionBody(row, d.central.site)
    if (!body) {
      await d.rpc("dpdp_ledger_commission_mark", { p_commission_id: row.id, p_status: row.status, p_ok: false, p_error: "missing amount or payout reference" })
      out.failed++
      continue
    }
    let res: Response
    try {
      res = await d.fetchFn(`${d.central.url}/api/pay/commission`, { method: "POST", headers: { "content-type": "application/json", "x-site-key": d.central.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) })
    } catch {
      await d.rpc("dpdp_ledger_commission_mark", { p_commission_id: row.id, p_status: row.status, p_ok: false, p_error: "central ledger unreachable" })
      out.failed++
      break
    }
    if (res.ok) {
      await d.rpc("dpdp_ledger_commission_mark", { p_commission_id: row.id, p_status: row.status, p_ok: true, p_error: null })
      out.posted++
      continue
    }
    const why = ((await res.json().catch(() => ({}))) as Json)?.error
    await d.rpc("dpdp_ledger_commission_mark", { p_commission_id: row.id, p_status: row.status, p_ok: false, p_error: `${res.status}: ${String(why ?? "refused").slice(0, 150)}` })
    if (res.status === 409) out.kept++
    else out.failed++
  }
  return out
}

/**
 * Sends the current and the previous Indian month to B, at most once every 29 minutes (the 30-minute cron then pushes on every tick). The "is it due" decision is taken in the database in one atomic step
 * (dpdp_ledger_summary_claim), so two overlapping runs cannot both push. A failed try is repeated after 5 minutes (the claim's own rule).
 */
export async function pushSummaries(d: Deps, force = false): Promise<{ pushed: number; skipped?: string }> {
  if (!d.central) return { pushed: 0, skipped: "no central key" }
  const claim = await d.rpc("dpdp_ledger_summary_claim", { p_force: force })
  if (claim.error) throw new Error(`summary claim: ${claim.error.message}`)
  if (claim.data !== true) return { pushed: 0, skipped: "pushed less than 29 minutes ago, or a try failed less than 5 minutes ago" }
  const figs = await d.rpc("dpdp_ledger_month_figures", {})
  if (figs.error || !Array.isArray(figs.data)) throw new Error(`summary figures: ${figs.error?.message ?? "no list"}`)
  let sent = 0, bad = 0
  for (const row of figs.data) {
    const body = buildSummaryBody(row, d.central.site)
    if (!body) continue
    try {
      const res = await d.fetchFn(`${d.central.url}/api/pay/site-summary`, { method: "POST", headers: { "content-type": "application/json", "x-site-key": d.central.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) })
      if (res.ok) sent++
      else bad++
    } catch { bad++ }
  }
  if (bad === 0) await d.rpc("dpdp_ledger_summary_done", {})
  return { pushed: sent }
}

/** Commission rows and (when due) the monthly figures. Never throws. */
export async function ledgerTick(d: Deps, force = false): Promise<{ commission?: SyncOut; summary?: { pushed: number; skipped?: string }; error?: string }> {
  const out: { commission?: SyncOut; summary?: { pushed: number; skipped?: string }; error?: string } = {}
  try { out.commission = await syncCommissions(d, 5) } catch (e) { out.error = String(e).slice(0, 160) }
  try { out.summary = await pushSummaries(d, force) } catch (e) { out.error = String(e).slice(0, 160) }
  return out
}

// ---------------------------------------------------------------- recording (A -> C)
/** Writes one verified webhook message into C: the attempt or the refund it is about. Throws when the database refuses (the caller answers 500 so Razorpay retries). */
export async function recordLedgerEvent(rpc: Rpc, ev: LedgerEvent): Promise<void> {
  if (ev.attempt) {
    const r = await rpc("dpdp_ledger_record_attempt", { p: ev.attempt })
    if (r.error) throw new Error(`record attempt: ${r.error.message}`)
  }
  if (ev.refund) {
    const r = await rpc("dpdp_ledger_record_refund", { p: ev.refund })
    if (r.error) throw new Error(`record refund: ${r.error.message}`)
  }
}

// ---------------------------------------------------------------- the owner's CSV
const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : String(v)
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s // a spreadsheet must never run a cell as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
/** The payments of the owner report (dpdp_owner_ledger) as a CSV, one line per website payment. No payer e-mail exists in the report to leak. */
export function ledgerCsv(report: unknown): string {
  const head = ["txn_id", "attempt_id", "rzp_order_id", "rzp_payment_id", "amount_paise", "currency", "status", "method", "bank", "card_network", "card_type", "rrn", "fee_paise", "tax_paise", "net_paise", "paid_utc", "created_utc", "organisation", "product", "variation", "razorpay_attempts", "captured_attempts", "last_error_code", "last_error_reason"]
  const lines = [head.join(",")]
  const pays = isObj(report) && Array.isArray(report.payments) ? (report.payments as Json[]) : []
  for (const p of pays) {
    const atts = Array.isArray(p.attempts) ? (p.attempts as Json[]) : []
    const cap = atts.find((a) => a.status === "captured") ?? null
    const bad = [...atts].reverse().find((a) => a.errorCode || a.errorReason) ?? null
    const fee = cap ? (cap.feePaise as number | null) : null
    lines.push([p.txnId, p.attemptId, p.rzpOrderId, cap?.rzpPaymentId ?? p.rzpPaymentId, p.amountPaise, p.currency, p.status, cap?.method ?? p.method, cap?.bank, cap?.cardNetwork, cap?.cardType, cap?.rrn, fee, cap?.taxPaise,
      fee == null ? null : Number(p.amountPaise) - fee, p.paidUtc, p.createdUtc, p.organisation, p.product, p.variation, atts.length, atts.filter((a) => a.status === "captured").length, bad?.errorCode ?? "", bad?.errorReason ?? ""].map(csvCell).join(","))
  }
  return lines.join("\r\n") + "\r\n"
}
