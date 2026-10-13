/// <reference types="bun-types" />
// Veridian DPDP ledger C (A = Razorpay, B = central ledger of IT Services by Rajat Agarwal, C = this database): the pure half and the C -> B posting,
// supabase/functions/dpdp-pay/ledger.ts. Spec: PAYMENT_LEDGER_ABC_SPEC_2026-10-13.md (L8, L9, L10, L11).
// No network and no database here: the database is replaced by a small fake that records the calls, and fetch by a fake that answers what the central service answers.
// The SQL half (drizzle/0749) was proved against the live database in a rolled-back transaction (PR description).
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  type Deps, type Rpc, attemptStatusOf, attemptStatusOfEntity, buildAttemptRow, buildCommissionBody, buildRefundRow, buildSummaryBody, derivedEventKey, ledgerCsv, ledgerTick, maskVpa,
  monthKeyOf, parseLedgerEvent, prevMonthKey, pushSummaries, recordLedgerEvent, syncCommissions,
} from "../../../supabase/functions/dpdp-pay/ledger"
import { CENTRAL_SITE, buildCentralOrderBody, buildOrderBody, receiptFor, txnIdOf } from "../../../supabase/functions/dpdp-pay/logic"

const ATTEMPT = "11111111222233334444555555555555"
const migration = readFileSync("drizzle/0749_dpdp_ledger_c.sql", "utf8")
const indexTs = readFileSync("supabase/functions/dpdp-pay/index.ts", "utf8")

// ---- fakes ---------------------------------------------------------------------------------------------------------------------------------------------
type Call = { name: string; args?: Record<string, unknown> }
function fakeDb(answers: Record<string, unknown> = {}): { rpc: Rpc; calls: Call[] } {
  const calls: Call[] = []
  const rpc: Rpc = async (name, args) => {
    calls.push({ name, args })
    const a = answers[name]
    if (a instanceof Error) return { data: null, error: { message: a.message } }
    return { data: typeof a === "function" ? (a as (x: unknown) => unknown)(args) : a ?? null, error: null }
  }
  return { rpc, calls }
}
type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> }
function fakeFetch(status: number | Error | ((n: number) => number | Error), sent: Sent[]): typeof fetch {
  let n = 0
  return (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    n++
    sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) })
    const st = typeof status === "function" ? status(n) : status
    if (st instanceof Error) throw st
    return new Response(JSON.stringify(st >= 400 ? { error: "the sale is not a paid sale in the central ledger yet" } : { ok: true }), { status: st })
  }) as unknown as typeof fetch
}
const central = { url: "https://central.test", key: "site-key-not-real", site: CENTRAL_SITE }

// A Razorpay payment as its webhook / API carries it, with the details that must NEVER be copied (full card number, payer e-mail and phone, full UPI id).
const payEntity = (over: Record<string, unknown> = {}) => ({
  id: "pay_Abc12345", entity: "payment", amount: 999900, currency: "INR", status: "captured", order_id: "order_Zzz12345", method: "upi", international: false, bank: null, wallet: null,
  vpa: "rajat.agarwal@okbank", email: "payer@example.com", contact: "+919999999999", fee: 23600, tax: 3600, created_at: 1790000000,
  notes: { attempt_id: ATTEMPT, org_id: "org1", txn_id: txnIdOf(ATTEMPT) }, card: { number: "4111111111111111", network: "Visa", type: "credit", last4: "1111", issuer: "HDFC" },
  acquirer_data: { rrn: "123456789012", auth_code: "A1B2C3" }, ...over,
})
const failedEntity = () => payEntity({ status: "failed", fee: null, tax: null, error_code: "BAD_REQUEST_ERROR", error_description: "Payment failed", error_source: "bank", error_step: "payment_authorization", error_reason: "payment_failed", acquirer_data: {} })
const evBody = (event: string, payload: Record<string, unknown>, createdAt = 1790000100) => JSON.stringify({ entity: "event", event, created_at: createdAt, payload })

// ---- the ids that tie A, B and C together ---------------------------------------------------------------------------------------------------------------
describe("txn_id (A = order notes + receipt, B = central payment row, C = dpdp.payment_attempt.txn_id)", () => {
  test("txn_id is DPD- + the receipt, and the receipt is what the central service is given as payment_ref", () => {
    expect(txnIdOf(ATTEMPT)).toBe(`DPD-dpdp_${ATTEMPT}`)
    expect(receiptFor(ATTEMPT)).toBe(`dpdp_${ATTEMPT}`) // 37 characters, never cut by Razorpay's 40-character limit
    const central = buildCentralOrderBody({ attemptId: ATTEMPT, orgId: "o", orgName: "Org", plan: "firm", interval: "year", amountPaise: 999900, currency: "INR" })
    // The central service builds txn_id as SITE_CODES[site] + "-" + payment_ref (itservices-site functions/_lib.js txnIdOf). Same recipe, same text.
    expect(`DPD-${central.payment_ref}`).toBe(txnIdOf(ATTEMPT))
    expect(central.site).toBe(CENTRAL_SITE)
  })
  test("a direct Razorpay order (the fallback when the central service is down) carries the same txn_id in its notes and the same receipt", () => {
    const body = buildOrderBody({ attemptId: ATTEMPT, orgId: "o", orgName: "Org", plan: "firm", interval: "year", amountPaise: 999900, currency: "INR" })
    expect((body.notes as Record<string, string>).txn_id).toBe(txnIdOf(ATTEMPT))
    expect(body.receipt).toBe(receiptFor(ATTEMPT))
    expect(Object.keys(body.notes as object).length).toBeLessThanOrEqual(15) // Razorpay's limit on notes
  })
  test("the database computes the same text: a generated column on dpdp.payment_attempt", () => {
    expect(migration).toContain("add column if not exists txn_id text generated always as ('DPD-dpdp_' || id) stored")
    // and the SQL that links an attempt to its payment uses the same recipe
    expect(migration).toContain("'DPD-dpdp_' || v_att")
  })
})

// ---- what Razorpay says -> what is kept ---------------------------------------------------------------------------------------------------------------
describe("attempt rows (success AND failure)", () => {
  test("event and entity statuses map to the three attempt statuses", () => {
    expect(attemptStatusOf("payment.captured")).toBe("captured")
    expect(attemptStatusOf("order.paid")).toBe("captured")
    expect(attemptStatusOf("payment.authorized")).toBe("authorized")
    expect(attemptStatusOf("payment.failed")).toBe("failed")
    expect(attemptStatusOf("refund.created")).toBeNull()
    expect(attemptStatusOf("payment.dispute.created")).toBeNull()
    expect(attemptStatusOfEntity("captured")).toBe("captured")
    expect(attemptStatusOfEntity("refunded")).toBe("captured")
    expect(attemptStatusOfEntity("failed")).toBe("failed")
    expect(attemptStatusOfEntity("created")).toBeNull()
  })
  test("a captured payment keeps amount, method, bank reference, card (last four only), masked UPI id, fee and GST on the fee, times", () => {
    const row = buildAttemptRow(payEntity(), "captured", 1790000100000)!
    expect(row).toMatchObject({
      rzpPaymentId: "pay_Abc12345", status: "captured", orderId: "order_Zzz12345", attemptHint: ATTEMPT, currency: "INR", amountPaise: 999900, method: "upi", cardNetwork: "Visa", cardType: "credit",
      cardLast4: "1111", cardIssuer: "HDFC", vpaMasked: "ra***@okbank", rrn: "123456789012", authCode: "A1B2C3", international: false, feePaise: 23600, taxPaise: 3600, eventMs: 1790000100000, createdMs: 1790000000000,
      errorCode: null, errorReason: null,
    })
  })
  test("a failed attempt keeps Razorpay's code, description, source, step and reason", () => {
    const row = buildAttemptRow(failedEntity(), "failed", 1790000200000)!
    expect(row).toMatchObject({ status: "failed", errorCode: "BAD_REQUEST_ERROR", errorDescription: "Payment failed", errorSource: "bank", errorStep: "payment_authorization", errorReason: "payment_failed", feePaise: null })
  })
  test("a full card number, the payer's e-mail and phone and a full UPI id never appear in what is stored", () => {
    const text = JSON.stringify(buildAttemptRow(payEntity(), "captured", 1)!)
    for (const secret of ["4111111111111111", "payer@example.com", "+919999999999", "rajat.agarwal@okbank"]) expect(text).not.toContain(secret)
  })
  test("an entity that is not a payment gives nothing", () => {
    expect(buildAttemptRow(null, "captured", 1)).toBeNull()
    expect(buildAttemptRow({ id: "order_X1234567" }, "captured", 1)).toBeNull()
    expect(buildAttemptRow({}, "captured", 1)).toBeNull()
  })
  test("maskVpa", () => {
    expect(maskVpa("ab@bank")).toBe("ab***@bank")
    expect(maskVpa("a@bank")).toBe("a***@bank")
    expect(maskVpa("nobank")).toBe("no***")
    expect(maskVpa(null)).toBeNull()
  })
})

describe("refund rows", () => {
  const refund = (over: Record<string, unknown> = {}) => ({ id: "rfnd_Abc12345", payment_id: "pay_Abc12345", amount: 5000, currency: "INR", status: "pending", created_at: 1790000300, ...over })
  test("the event decides the status; the same refund is the same id", () => {
    expect(buildRefundRow("refund.created", refund(), 1)).toMatchObject({ rzpRefundId: "rfnd_Abc12345", rzpPaymentId: "pay_Abc12345", amountPaise: 5000, status: "pending", createdMs: 1790000300000 })
    expect(buildRefundRow("refund.processed", refund(), 1)?.status).toBe("processed")
    expect(buildRefundRow("refund.failed", refund(), 1)?.status).toBe("failed")
    expect(buildRefundRow("refund.speed_changed", refund({ status: "processed" }), 1)?.status).toBe("processed")
  })
  test("a refund without ids is not recorded", () => {
    expect(buildRefundRow("refund.created", refund({ id: "" }), 1)).toBeNull()
    expect(buildRefundRow("refund.created", refund({ payment_id: undefined }), 1)).toBeNull()
    expect(buildRefundRow("refund.created", null, 1)).toBeNull()
  })
})

describe("one webhook message", () => {
  test("the header id is the dedupe key; without it a key is derived from the event, the entity and Razorpay's own time", () => {
    const raw = evBody("payment.failed", { payment: { entity: failedEntity() } })
    expect(parseLedgerEvent(raw, "evt_123", 5).eventKey).toBe("evt_123")
    expect(parseLedgerEvent(raw, null, 5).eventKey).toBe("d:payment.failed:pay_Abc12345:1790000100")
    expect(parseLedgerEvent(raw, "", 5).eventKey).toBe("d:payment.failed:pay_Abc12345:1790000100")
    // the same message twice -> the same key; a different event for the same payment -> a different key
    expect(derivedEventKey(JSON.parse(raw))).toBe(derivedEventKey(JSON.parse(raw)))
    expect(derivedEventKey(JSON.parse(evBody("payment.captured", { payment: { entity: payEntity() } })))).not.toBe(derivedEventKey(JSON.parse(raw)))
  })
  test("failed / authorized / captured / order.paid / payment_link.paid all become an attempt; refund.* becomes a refund; anything else becomes neither", () => {
    expect(parseLedgerEvent(evBody("payment.failed", { payment: { entity: failedEntity() } }), "e1", 5).attempt?.status).toBe("failed")
    expect(parseLedgerEvent(evBody("payment.authorized", { payment: { entity: payEntity({ status: "authorized" }) } }), "e2", 5).attempt?.status).toBe("authorized")
    expect(parseLedgerEvent(evBody("payment.captured", { payment: { entity: payEntity() } }), "e3", 5).attempt?.status).toBe("captured")
    expect(parseLedgerEvent(evBody("order.paid", { order: { entity: { id: "order_Zzz12345" } }, payment: { entity: payEntity() } }), "e4", 5).attempt?.status).toBe("captured")
    expect(parseLedgerEvent(evBody("payment_link.paid", { payment: { entity: payEntity() } }), "e5", 5).attempt?.status).toBe("captured")
    const rf = parseLedgerEvent(evBody("refund.processed", { refund: { entity: { id: "rfnd_Abc12345", payment_id: "pay_Abc12345", amount: 100, currency: "INR" } }, payment: { entity: payEntity() } }), "e6", 5)
    expect(rf.refund?.status).toBe("processed")
    expect(rf.attempt).toBeNull() // a refund message does not re-record the payment as an attempt
    const other = parseLedgerEvent(evBody("settlement.processed", { settlement: { entity: { id: "setl_1" } } }), "e7", 5)
    expect(other.attempt).toBeNull()
    expect(other.refund).toBeNull()
  })
  test("garbage never throws", () => {
    expect(parseLedgerEvent("not json", "e", 5)).toEqual({ eventKey: null, event: null, attempt: null, refund: null })
    expect(parseLedgerEvent("[]", "e", 5).attempt).toBeNull()
  })
  test("recordLedgerEvent writes the attempt and the refund through the database functions, and a refusal throws (the webhook then answers 500 and Razorpay retries)", async () => {
    const db = fakeDb()
    await recordLedgerEvent(db.rpc, parseLedgerEvent(evBody("payment.failed", { payment: { entity: failedEntity() } }), "e1", 5))
    await recordLedgerEvent(db.rpc, parseLedgerEvent(evBody("refund.created", { refund: { entity: { id: "rfnd_Abc12345", payment_id: "pay_Abc12345", amount: 100 } } }), "e2", 5))
    expect(db.calls.map((c) => c.name)).toEqual(["dpdp_ledger_record_attempt", "dpdp_ledger_record_refund"])
    await expect(recordLedgerEvent(fakeDb({ dpdp_ledger_record_attempt: new Error("db down") }).rpc, parseLedgerEvent(evBody("payment.failed", { payment: { entity: failedEntity() } }), "e1", 5))).rejects.toThrow("db down")
  })
})

// ---- months and figures ---------------------------------------------------------------------------------------------------------------------------------
describe("Indian months", () => {
  test("a moment late on the last day of a month in UTC is already next month in India", () => {
    expect(monthKeyOf(Date.UTC(2026, 9, 31, 18, 29, 59))).toBe("2026-10")
    expect(monthKeyOf(Date.UTC(2026, 9, 31, 18, 30, 0))).toBe("2026-11")
    expect(prevMonthKey("2026-01")).toBe("2025-12")
    expect(prevMonthKey("2026-10")).toBe("2026-09")
  })
  test("the SQL builds the same month boundaries in Asia/Kolkata", () => {
    expect(migration).toContain("make_timestamptz(v_y, v_m, 1, 0, 0, 0, 'Asia/Kolkata')")
  })
})

describe("what is sent to B", () => {
  test("site-summary body: whole numbers, never negative, INR unless USD", () => {
    expect(buildSummaryBody({ period_key: "2026-10", currency: "INR", paid_count: 2, failed_count: "1", revenue_minor: 1999800, fee_minor: 47200, tax_minor: 7200, refunded_minor: 1000, commission_accrued_minor: 0, commission_paid_minor: 399960 })).toEqual({
      site: CENTRAL_SITE, period_key: "2026-10", currency: "INR", paid_count: 2, failed_count: 1, revenue_minor: 1999800, fee_minor: 47200, tax_minor: 7200, refunded_minor: 1000, commission_accrued_minor: 0, commission_paid_minor: 399960,
    })
    expect(buildSummaryBody({ period_key: "2026-13" })).toBeNull()
    expect(buildSummaryBody(null)).toBeNull()
    expect(buildSummaryBody({ period_key: "2026-10", revenue_minor: -5 })?.revenue_minor).toBe(0)
  })
  test("commission body: the commission id is site_ref (central UNIQUE(site, site_ref)); paid needs a payout reference", () => {
    const base = { id: "c1", rzpPaymentId: "pay_Abc12345", status: "accrued" as const, amountPaise: 199980, partnerCode: "P1", partnerName: "A Partner", paidRef: null }
    expect(buildCommissionBody(base)).toEqual({ site: CENTRAL_SITE, site_ref: "c1", rzp_payment_id: "pay_Abc12345", partner_code: "P1", partner_name: "A Partner", amount_minor: 199980, currency: "INR", status: "accrued" })
    expect(buildCommissionBody({ ...base, status: "paid" })).toBeNull()
    expect(buildCommissionBody({ ...base, status: "paid", paidRef: "UTR123" })).toMatchObject({ status: "paid", paid_ref: "UTR123" })
    expect(buildCommissionBody({ ...base, amountPaise: 0 })).toBeNull()
    expect(buildCommissionBody({ ...base, partnerCode: null })?.partner_code).toBe("unknown")
  })
})

describe("commission C -> B", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "c1", rzpPaymentId: "pay_Abc12345", status: "accrued", amountPaise: 199980, partnerCode: "P1", partnerName: null, paidRef: null, ...over })
  test("no central key = nothing is asked of the database or the network", async () => {
    const db = fakeDb()
    const sent: Sent[] = []
    expect(await syncCommissions({ rpc: db.rpc, fetchFn: fakeFetch(200, sent), central: null })).toEqual({ posted: 0, kept: 0, skipped: 0, failed: 0 })
    expect(db.calls).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })
  test("a listed commission is posted with the site key and marked as told", async () => {
    const db = fakeDb({ dpdp_ledger_commissions_to_post: [row()] })
    const sent: Sent[] = []
    const out = await syncCommissions({ rpc: db.rpc, fetchFn: fakeFetch(200, sent), central }, 5)
    expect(out.posted).toBe(1)
    expect(sent[0]!.url).toBe("https://central.test/api/pay/commission")
    expect(sent[0]!.headers["x-site-key"]).toBe("site-key-not-real")
    expect(sent[0]!.body).toMatchObject({ site: CENTRAL_SITE, site_ref: "c1", status: "accrued", amount_minor: 199980 })
    expect(db.calls.at(-1)).toEqual({ name: "dpdp_ledger_commission_mark", args: { p_commission_id: "c1", p_status: "accrued", p_ok: true, p_error: null } })
  })
  test("409 (the sale is not in B yet) keeps the row for a later retry and records why; a service that is down stops the run", async () => {
    const db = fakeDb({ dpdp_ledger_commissions_to_post: [row({ id: "c1" }), row({ id: "c2" })] })
    const sent: Sent[] = []
    const out = await syncCommissions({ rpc: db.rpc, fetchFn: fakeFetch(409, sent), central })
    expect(out).toMatchObject({ kept: 2, posted: 0 })
    expect(db.calls.filter((c) => c.name === "dpdp_ledger_commission_mark").every((c) => c.args!.p_ok === false && String(c.args!.p_error).startsWith("409"))).toBe(true)
    const db2 = fakeDb({ dpdp_ledger_commissions_to_post: [row({ id: "c1" }), row({ id: "c2" })] })
    const sent2: Sent[] = []
    const out2 = await syncCommissions({ rpc: db2.rpc, fetchFn: fakeFetch(new Error("network"), sent2), central })
    expect(out2.failed).toBe(1)
    expect(sent2).toHaveLength(1) // it did not hammer a service that is down
  })
  test("a paid commission without a payout reference is not sent and says so", async () => {
    const db = fakeDb({ dpdp_ledger_commissions_to_post: [row({ status: "paid", paidRef: null })] })
    const sent: Sent[] = []
    const out = await syncCommissions({ rpc: db.rpc, fetchFn: fakeFetch(200, sent), central })
    expect(out.failed).toBe(1)
    expect(sent).toHaveLength(0)
  })
})

describe("monthly figures C -> B (at most every 30 minutes)", () => {
  const figures = [
    { period_key: "2026-10", currency: "INR", paid_count: 1, failed_count: 0, revenue_minor: 999900, fee_minor: 23600, tax_minor: 3600, refunded_minor: 0, commission_accrued_minor: 199980, commission_paid_minor: 0 },
    { period_key: "2026-09", currency: "INR", paid_count: 0, failed_count: 1, revenue_minor: 0, fee_minor: 0, tax_minor: 0, refunded_minor: 0, commission_accrued_minor: 0, commission_paid_minor: 0 },
  ]
  test("when the database says it is not due, nothing is read or sent", async () => {
    const db = fakeDb({ dpdp_ledger_summary_claim: false })
    const sent: Sent[] = []
    const out = await pushSummaries({ rpc: db.rpc, fetchFn: fakeFetch(200, sent), central })
    expect(out.pushed).toBe(0)
    expect(out.skipped).toBeDefined()
    expect(sent).toHaveLength(0)
    expect(db.calls.map((c) => c.name)).toEqual(["dpdp_ledger_summary_claim"])
  })
  test("when due, both months go to B and the push is marked done only if every one was accepted", async () => {
    const db = fakeDb({ dpdp_ledger_summary_claim: true, dpdp_ledger_month_figures: figures })
    const sent: Sent[] = []
    expect((await pushSummaries({ rpc: db.rpc, fetchFn: fakeFetch(200, sent), central })).pushed).toBe(2)
    expect(sent.map((s) => s.url)).toEqual(["https://central.test/api/pay/site-summary", "https://central.test/api/pay/site-summary"])
    expect(sent.map((s) => s.body.period_key)).toEqual(["2026-10", "2026-09"])
    expect(db.calls.map((c) => c.name)).toContain("dpdp_ledger_summary_done")

    const db2 = fakeDb({ dpdp_ledger_summary_claim: true, dpdp_ledger_month_figures: figures })
    const out2 = await pushSummaries({ rpc: db2.rpc, fetchFn: fakeFetch((n) => (n === 1 ? 200 : 500), []), central })
    expect(out2.pushed).toBe(1)
    expect(db2.calls.map((c) => c.name)).not.toContain("dpdp_ledger_summary_done") // so it is tried again after 5 minutes
  })
  test("force skips the claim's waiting rule but still asks the database", async () => {
    const db = fakeDb({ dpdp_ledger_summary_claim: true, dpdp_ledger_month_figures: [] })
    await pushSummaries({ rpc: db.rpc, fetchFn: fakeFetch(200, []), central }, true)
    expect(db.calls[0]).toEqual({ name: "dpdp_ledger_summary_claim", args: { p_force: true } })
  })
  test("ledgerTick never throws, even when the database or the network fails", async () => {
    const db = fakeDb({ dpdp_ledger_commissions_to_post: new Error("db down"), dpdp_ledger_summary_claim: new Error("db down") })
    const deps: Deps = { rpc: db.rpc, fetchFn: fakeFetch(200, []), central }
    const out = await ledgerTick(deps)
    expect(out.error).toContain("db down")
  })
})

// ---- the owner's CSV --------------------------------------------------------------------------------------------------------------------------------------
describe("owner CSV", () => {
  const report = {
    payments: [{
      txnId: txnIdOf(ATTEMPT), attemptId: ATTEMPT, rzpOrderId: "order_Zzz12345", amountPaise: 999900, currency: "INR", status: "paid", organisation: '=HYPERLINK("http://evil","x")', product: "veridian_dpdp", variation: "firm_year",
      paidUtc: "2026-10-13T19:49:27Z", createdUtc: "2026-10-13T19:40:00Z",
      attempts: [
        { rzpPaymentId: "pay_FAIL0001", status: "failed", errorCode: "BAD_REQUEST_ERROR", errorReason: "payment_failed" },
        { rzpPaymentId: "pay_OK000001", status: "captured", method: "card", cardNetwork: "Visa", rrn: "123", feePaise: 23600, taxPaise: 3600 },
      ],
    }],
  }
  test("one line per website payment with the captured attempt's details, the last failure reason, and fee / net", () => {
    const lines = ledgerCsv(report).trim().split("\r\n")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain("txn_id,attempt_id,rzp_order_id,rzp_payment_id")
    expect(lines[1]).toContain(txnIdOf(ATTEMPT))
    expect(lines[1]).toContain("pay_OK000001")
    expect(lines[1]).toContain("23600")
    expect(lines[1]).toContain(String(999900 - 23600))
    expect(lines[1]).toContain("BAD_REQUEST_ERROR")
  })
  test("a cell that starts like a formula is neutralised", () => {
    const line = ledgerCsv(report).trim().split("\r\n")[1]!
    expect(line).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`)
  })
})

// ---- the database half and the wiring: structural guarantees -------------------------------------------------------------------------------------------------
describe("zero duplication and closed tables (drizzle/0749)", () => {
  test("every ledger table has its primary key, row level security on, and no grant to browser roles", () => {
    for (const t of ["ledger_payment_attempt", "ledger_refund", "ledger_event_seen", "ledger_commission_sync", "ledger_state"]) {
      expect(migration).toContain(`create table if not exists dpdp.${t} (`)
      expect(migration).toContain(`alter table dpdp.${t} enable row level security;`)
      expect(migration).toContain(`dpdp.${t}`)
    }
    expect(migration).toContain("rzp_payment_id text primary key")
    expect(migration).toContain("rzp_refund_id text primary key")
    expect(migration).toContain("rzp_event_id text primary key")
    expect(migration).toContain("commission_id text primary key")
    expect(migration).toMatch(/revoke all on dpdp\.ledger_payment_attempt, dpdp\.ledger_refund, dpdp\.ledger_event_seen, dpdp\.ledger_commission_sync, dpdp\.ledger_state from anon, authenticated;/)
    expect(migration).not.toMatch(/create policy/i)
    expect(migration).not.toMatch(/grant [^;]* on dpdp\.ledger/i)
  })
  test("no payer e-mail or phone column exists in any ledger table", () => {
    const tables = migration.split("create table if not exists dpdp.ledger_").slice(1).map((t) => t.split(");")[0]!)
    for (const t of tables) expect(t).not.toMatch(/email|phone|contact/i)
  })
  test("the attempt status only moves forward (failed < authorized < captured) in the upsert", () => {
    expect(migration).toContain("when 'captured' then 3 when 'authorized' then 2 else 1 end")
    expect(migration).toContain("public.dpdp__ledger_rank(excluded.status) >= public.dpdp__ledger_rank(t.status)")
  })
  test("every function is closed to browsers except the owner's report, which refuses anyone but the platform owner", () => {
    for (const f of ["dpdp_ledger_record_attempt(jsonb)", "dpdp_ledger_record_refund(jsonb)", "dpdp_ledger_event_seen(text)", "dpdp_ledger_mark_event(text, text)", "dpdp_ledger_month_figures(timestamptz)", "dpdp_ledger_summary_claim(boolean)",
      "dpdp_ledger_summary_done()", "dpdp_ledger_commissions_to_post(integer, integer)", "dpdp_ledger_commission_mark(text, text, boolean, text)"]) {
      expect(migration).toContain(`revoke all on function public.${f} from public, anon, authenticated;`)
      expect(migration).toContain(`grant execute on function public.${f} to service_role;`)
    }
    expect(migration).toContain("revoke all on function public.dpdp_owner_ledger(text) from public, anon;")
    expect(migration).toContain("grant execute on function public.dpdp_owner_ledger(text) to authenticated, service_role;")
    expect(migration).toContain("if not public.dpdp__is_platform_admin() then")
  })
  test("the booking functions of 0673 / 0748 are not redefined here", () => {
    expect(migration).not.toMatch(/create or replace function public\.(dpdp_pay_begin|dpdp_pay_confirm|dpdp_record_confirmed_payment)/)
  })
  test("the migration is registered in the journal after 0748", () => {
    const j = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; when: number; tag: string }[] }
    const e = j.entries.find((x) => x.tag === "0749_dpdp_ledger_c")!
    const prev = j.entries.find((x) => x.tag === "0748_dpdp_terms_acceptance")!
    expect(e.idx).toBe(prev.idx + 1)
    expect(e.when).toBeGreaterThan(prev.when)
  })
})

describe("the edge function wiring", () => {
  test("the webhook marks a delivery as seen only AFTER the booking and the ledger write succeeded, and checks it BEFORE", () => {
    const seen = indexTs.indexOf('"dpdp_ledger_event_seen"')
    const book = indexTs.indexOf("await recordCaptured(parsed.payment)")
    const rec = indexTs.indexOf("await recordLedgerEvent(ledgerDeps(sb).rpc, ledger)")
    const mark = indexTs.indexOf('"dpdp_ledger_mark_event"')
    expect(seen).toBeGreaterThan(0)
    expect(seen).toBeLessThan(book)
    expect(book).toBeLessThan(rec)
    expect(rec).toBeLessThan(mark)
  })
  test("the order answer carries txnId, the verify path records the attempt whatever its outcome, and the new routes exist", () => {
    expect(indexTs).toContain("txnId: txnIdOf(a.attemptId)")
    expect(indexTs).toContain("await recordPaymentEntity(pay)")
    expect(indexTs).toContain('path.endsWith("/ledger-tick")')
    expect(indexTs).toContain('path.endsWith("/ledger")')
    // the cron endpoint is guarded by the Vault bearer
    expect(indexTs).toContain('"dpdp_timer_check_bearer"')
  })
})
