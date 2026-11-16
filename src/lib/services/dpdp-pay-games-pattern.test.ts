/// <reference types="bun-types" />
// Owner order (16 Nov 2026): DPDP takes payment the SAME way the games do --
//   product website -> IT Services by Rajat Agarwal (central payment service) -> Razorpay,
// with no separate Razorpay account for DPDP. This file pins that shape in the sources, so a later edit cannot quietly turn it into
// "DPDP talks to Razorpay on its own" or name another payee / gateway. It reads the Edge Function as text (the Deno wiring cannot be
// imported by bun) and runs the pure builders from logic.ts for real.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CENTRAL_SITE, PRODUCT_CODE, SITE_CODE, buildCentralOrderBody, buildCheckoutOptions, receiptFor, txnIdOf } from "../../../supabase/functions/dpdp-pay/logic"

const ROOT = join(import.meta.dir, "..", "..", "..")
const index = readFileSync(join(ROOT, "supabase/functions/dpdp-pay/index.ts"), "utf8")
const logic = readFileSync(join(ROOT, "supabase/functions/dpdp-pay/logic.ts"), "utf8")
const ledger = readFileSync(join(ROOT, "supabase/functions/dpdp-pay/ledger.ts"), "utf8")
const ATTEMPT = "0123456789abcdef0123456789abcdef"

describe("DPDP pays the way the games do", () => {
  test("the order goes to the central payment service with DPDP's own site key, and there is NO direct Razorpay call or API key", () => {
    const central = index.indexOf("`${PAY_SERVICE_URL}/api/pay/order`")
    expect(central).toBeGreaterThan(-1)
    const call = index.slice(central, central + 400)
    expect(call).toContain('"x-site-key": PAY_SERVICE_KEY')
    expect(index).toContain('const PAY_SERVICE_KEY = env("PAY_SERVICE_KEY")') // its own secret, not a shared or hard-coded one
    // owner rule 2026-11-16: no direct Razorpay per product
    for (const src of [index, logic, ledger]) {
      expect(src).not.toContain("api.razorpay.com")
      expect(src).not.toMatch(/RAZORPAY_API|RAZORPAY_KEY_ID|RAZORPAY_KEY_SECRET|basicAuthHeader|verifyCheckoutSignature/)
    }
    expect(index).toContain('env("RAZORPAY_WEBHOOK_SECRET")') // the only Razorpay value left: the inbound webhook signature check
    expect(index.match(/env\("RAZORPAY_/g)?.length).toBe(1)
    expect(index).toContain("keyId: order.keyId") // the checkout key id comes from the central service's answer
  })

  test("the answer hands over to the registered pay frame of IT Services by Rajat Agarwal", () => {
    expect(index).toContain('env("PAY_HOP_URL") || "https://itservices-rajat-agarwal.pages.dev/payframe/"')
    expect(index).toMatch(/hop: PAY_HOP_URL/)
    expect(index).toContain('env("PAY_SERVICE_URL") || "https://itservices-rajat-agarwal.pages.dev"')
  })

  test("the signed result is checked by the central service, and what it answers is booked against OUR attempt", () => {
    const at = index.indexOf("async function verify(")
    const fn = index.slice(at, index.indexOf("async function webhook", at))
    expect(fn).toContain("`${PAY_SERVICE_URL}/api/pay/verify`")
    expect(fn).toContain('"x-site-key": PAY_SERVICE_KEY')
    expect(fn).toContain("site: CENTRAL_SITE")
    expect(fn).toContain("razorpay_signature: v.signature")
    expect(fn).toContain("capturedFromCentral(answer, v.orderId)")
    expect(fn).toContain("await recordCaptured(outcome.payment)")
  })

  test("the site is veridian-aios.com and its code is DPD, in the order, the txn id and the ledger", () => {
    expect(CENTRAL_SITE).toBe("veridian-aios.com")
    expect(SITE_CODE).toBe("DPD")
    expect(txnIdOf(ATTEMPT)).toBe(`DPD-dpdp_${ATTEMPT}`)
    expect(txnIdOf(ATTEMPT)).toBe(`${SITE_CODE}-${receiptFor(ATTEMPT)}`)
    const body = buildCentralOrderBody({ attemptId: ATTEMPT, orgId: "org1", orgName: "Acme School", plan: "institution", interval: "year", amountPaise: 599400, currency: "INR" }) as Record<string, unknown>
    expect(body.site).toBe("veridian-aios.com")
    expect(body.product).toBe(PRODUCT_CODE)
    expect(body.payment_ref).toBe(receiptFor(ATTEMPT))
    expect(body.amount_minor).toBe(599400)
    expect(ledger).toContain('import { CENTRAL_SITE, txnIdOf } from "./logic.ts"') // ledger C and the order cannot drift apart
  })

  test("the person sees English text and the payee 'IT Services by Rajat Agarwal'", () => {
    const o = buildCheckoutOptions({ keyId: "rzp_test_placeholder", orderId: "order_abc123456", amountPaise: 599400, currency: "INR", orgName: "Acme School", plan: "institution", interval: "year", ownerEmail: null })
    expect(String(o.name)).toBe("VERIDIAN DPDP")
    expect(String(o.description)).toContain("IT Services by Rajat Agarwal")
    for (const s of [String(o.name), String(o.description)]) expect(s).toMatch(/^[\x20-\x7E]+$/) // plain ASCII English
  })

  test("Razorpay is the only gateway and the sources hold no key value", () => {
    for (const src of [index, logic, ledger]) {
      expect(src).not.toMatch(/stripe|paypal|cashfree|payu|instamojo|ccavenue|phonepe/i)
      expect(src).not.toMatch(/rzp_(live|test)_[A-Za-z0-9]{6,}/)
      expect(src).not.toMatch(/[0-9a-f]{64}/) // no hash or secret literal
    }
  })
})
