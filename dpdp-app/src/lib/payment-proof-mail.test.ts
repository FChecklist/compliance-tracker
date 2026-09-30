/// <reference types="bun-types" />
// The billing widget's "Prefer email?" link (components/BillingPanel.tsx).
//
// It used to open a mail to the owner's personal Gmail address. It must open a
// mail to the ONE public DPDP mailbox instead, with a subject that starts
// "Invoice payment proof" so the inbound classifier files it as an invoice.
// The classifier itself is exercised over this same subject and body by
// src/lib/services/dpdp-mail-edge-functions.test.ts at the repo root (dpdp-app's
// tsconfig cannot import the Deno-style edge function sources); the keyword
// check below is only a local mirror of the two invoice words it keys on.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  PAY_EMAIL, PAY_PROOF_SUBJECT_PREFIX, paymentProofBody, paymentProofMailto, paymentProofSubject,
  type PaymentProofMail,
} from "./payment-proof-mail"

const SRC = join(import.meta.dir, "..") // dpdp-app/src/
const panel = readFileSync(join(SRC, "components", "BillingPanel.tsx"), "utf8")
const helper = readFileSync(join(SRC, "lib", "payment-proof-mail.ts"), "utf8")

const ORG = "0123456789abcdef0123456789abcdef"
const sample: PaymentProofMail = { orgId: ORG, amountLabel: "Rs 9,999", interval: "year", reference: "412345678901" }

function parts(url: string): { to: string; subject: string; body: string } {
  const m = /^mailto:([^?]+)\?subject=([^&]*)&body=(.*)$/s.exec(url)
  if (!m) throw new Error(`not the mailto shape we build: ${url}`)
  return { to: decodeURIComponent(m[1]), subject: decodeURIComponent(m[2]), body: decodeURIComponent(m[3]) }
}

describe("payment proof by email goes to the one public mailbox", () => {
  test("the address is dpdp@veridian-aios.com", () => {
    expect(PAY_EMAIL).toBe("dpdp@veridian-aios.com")
    expect(parts(paymentProofMailto(sample)).to).toBe("dpdp@veridian-aios.com")
  })

  test("the owner's personal address appears nowhere in the panel or its helper", () => {
    for (const [name, src] of [["BillingPanel.tsx", panel], ["payment-proof-mail.ts", helper]] as const) {
      expect(src, `${name} still names the owner's personal mailbox`).not.toMatch(/raajat|@gmail\.|@googlemail\./i)
    }
  })

  test("the panel builds its link and its visible address from the helper, with no mailto: of its own", () => {
    expect(panel).toContain(`from "@/lib/payment-proof-mail"`)
    expect(panel).toContain("paymentProofMailto(")
    expect(panel).toContain("{PAY_EMAIL}")
    expect(panel).not.toMatch(/mailto:/)
  })

  test("the subject begins 'Invoice payment proof' and keeps the org reference", () => {
    const { subject } = parts(paymentProofMailto(sample))
    expect(subject.startsWith("Invoice payment proof")).toBe(true)
    expect(subject).toBe(paymentProofSubject(ORG))
    expect(subject).toContain(ORG)
    expect(PAY_PROOF_SUBJECT_PREFIX).toBe("Invoice payment proof")
  })

  test("the subject carries both invoice words the classifier keys on (local mirror of its 'invoic' and 'payment' rules)", () => {
    const { subject } = parts(paymentProofMailto(sample))
    expect(subject).toMatch(/\binvoic/i)
    expect(subject).toMatch(/\bpayments?\b/i)
  })

  test("the body keeps the org, the amount, the interval and the reference", () => {
    const { body } = parts(paymentProofMailto(sample))
    expect(body).toBe(paymentProofBody(sample))
    expect(body).toContain(`Org: ${ORG}`)
    expect(body).toContain("Amount: Rs 9,999 (yearly)")
    expect(body).toContain("Reference: 412345678901")
    expect(body).toContain("attach your payment screenshot")
  })

  test("monthly wording, and the placeholder when no reference was typed", () => {
    const body = paymentProofBody({ ...sample, interval: "month", reference: "   " })
    expect(body).toContain("(monthly)")
    expect(body).toContain("Reference: (attached separately)")
  })

  test("nothing typed by the customer can break out of the mailto: query", () => {
    const url = paymentProofMailto({ ...sample, orgId: "a&b=c d?e#f", reference: "x&subject=evil\nBcc: x@y.z" })
    const { to, subject, body } = parts(url)
    expect(to).toBe("dpdp@veridian-aios.com")
    expect(subject.startsWith("Invoice payment proof")).toBe(true)
    expect(subject).toContain("a&b=c d?e#f")
    expect(body).toContain("x&subject=evil\nBcc: x@y.z")
    expect(url.split("?")).toHaveLength(2)
    expect(url.match(/&/g)).toHaveLength(1) // only the subject/body separator survives unencoded
  })
})
