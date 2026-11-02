/// <reference types="bun-types" />
// Owner decision, 2026-11-02: DPDP is paid for the way Corporate Tambola is -- choose, press pay, Razorpay's window opens, the person pays, Razorpay tells
// us, and the account is made paid and active. There is NO manual UPI or bank-transfer path and no placeholder payment details anywhere a customer can see.
// This file reads the sources a customer meets on the pay path and pins:
//   - no placeholder UPI id, bank account, QR image, WhatsApp number, UTR field, or "I have paid" button is left in the pay panel
//   - when Razorpay cannot be opened the panel shows the one agreed sentence and nothing else to pay with
//   - after Razorpay reports success the panel calls /dpdp-pay/verify (through confirmOnlinePayment) and then re-reads the BILLING STATE AND THE ACCOUNT
//   - the locked "Payment due" screen opens the working screens again by itself once the payment is confirmed
//   - the customer-visible texts around the pay path (the Edge Function's refusal, the guide for it) no longer send anyone to a bank transfer
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const APP = join(import.meta.dir, "..", "..")
const ROOT = join(APP, "..")
const read = (rel: string) => readFileSync(join(APP, rel), "utf8")
const readRoot = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

const panel = read("src/components/BillingPanel.tsx")
const paymentDue = read("src/components/PaymentDue.tsx")
const catalog = read("src/lib/guide/catalog.ts")
const payFn = readRoot("supabase/functions/dpdp-pay/index.ts")

const AGREED_UNAVAILABLE = "Online payment is not available right now. Please try again in a few minutes, or write to {PAY_EMAIL} and we will help."

describe("the pay panel has one way to pay: Razorpay", () => {
  test("no placeholder payment details, QR image, WhatsApp link, UTR field or manual-claim button is left", () => {
    for (const bad of [
      "veridian@upi", "bank details pending", "-- pending --", "payment-qr", "PAY_UPI_ID", "PAY_BANK", "PAY_QR_IMAGE", "PAY_WHATSAPP_NUMBER", "wa.me",
      "UTR", "I have paid", "bank transfer", "Bank:", "UPI:", "declarePayment", "uploadPaymentProof", "paymentProofMailto",
    ]) expect(panel, `BillingPanel.tsx still has "${bad}"`).not.toContain(bad)
    expect(panel).not.toMatch(/type="file"/)
  })

  test("the only payment button starts the Razorpay flow, behind the ticked K3 box", () => {
    expect(panel).toContain("startOnlinePayment(client, orgId, terms, interval)")
    expect(panel.match(/onClick=\{\(\) => void payOnline\(/g)?.length).toBe(2) // the pay button and the yearly renewal button
    expect(panel).not.toMatch(/onClick=\{pay\}/)
    expect(panel).not.toMatch(/function pay\(/)
  })

  test("when Razorpay cannot be opened, the panel shows the agreed sentence (in the pay form and in the renewal), with a Try again, and nothing else to pay with", () => {
    expect(panel).toContain(AGREED_UNAVAILABLE)
    expect(panel.match(/onlineOffNote/g)?.length).toBe(3) // defined once, used in the renewal and in the pay form
    expect(panel).toContain("onClick={() => setOnlineOff(false)}")
  })

  test("after Razorpay reports success: verify, then re-read the billing state AND the account, then tell the page", () => {
    const at = (s: string, from = 0) => panel.indexOf(s, from)
    const pay = at("const c = await confirmOnlinePayment(resp)")
    const reread = at("await reread()")
    const received = at('setPayStatus("received")', reread)
    const paid = at("onPaid?.()", received)
    expect(pay).toBeGreaterThan(-1)
    expect(reread).toBeGreaterThan(pay)
    expect(received).toBeGreaterThan(reread)
    expect(paid).toBeGreaterThan(received)
    // the re-read covers both reads, not just the billing pill
    const fn = panel.slice(at("async function reread()"), at("async function payOnline("))
    expect(fn).toContain("myBilling(client, orgId)")
    expect(fn).toContain("fetchMyAccount(client, orgId)")
    expect(fn).toContain("setBilling(")
    expect(fn).toContain("setAccount(")
  })

  test("coming back to a payment the webhook booked (the page was reloaded mid-payment) also re-reads the account", () => {
    const poll = panel.slice(panel.indexOf("const baseline = readPending(orgId)"), panel.indexOf("if (billing === undefined || billing === null) return null"))
    expect(poll).toContain("fetchMyAccount(client, orgId)")
    expect(poll).toContain('setPayStatus("received")')
  })
})

describe("the locked Payment due screen", () => {
  test("opens the working screens again by itself once the payment is confirmed, and no longer sends anyone to a transfer", () => {
    expect(paymentDue).toMatch(/<BillingPanel[^>]*\sonPaid=\{/)
    expect(paymentDue).toContain("window.setTimeout(onRetry")
    expect(paymentDue).not.toMatch(/bank transfer|UPI, then tell us/i)
  })
})

describe("the words around the pay path", () => {
  test("the Edge Function's refusal and its header no longer promise a bank transfer or an 'I have paid' button", () => {
    expect(payFn).not.toMatch(/bank transfer|bank-transfer|I have paid/i)
    expect(payFn).toContain("Razorpay did not accept the request. Please try again in a few minutes, or write to dpdp@veridian-aios.com and we will help.")
  })

  test("the guide for it points to the mailbox, not to a transfer, and still matches the Edge Function's refusal", () => {
    // the partner-payout entries legitimately say "bank transfer" (that is how a partner is paid); only the customer-payment entries must not
    expect(catalog).not.toContain("paid by bank transfer")
    expect(catalog).not.toContain("pay by bank transfer")
    expect(catalog).toContain("write to dpdp@veridian-aios.com and we will help")
    expect(catalog).toContain('"Razorpay did not accept the request"')
  })
})
