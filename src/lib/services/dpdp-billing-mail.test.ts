/// <reference types="bun-types" />
// DPDP billing emails (supabase/functions/_shared/billing-mail.ts): the receipt and the five
// reminders. Pure rendering, no network. Checks the owner's own rules (access never locks, the
// card is entered on Razorpay's page) and that nothing a reminder says is a claim we cannot back.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { isDeliverableAddress as mondayDeliverable } from "../../../supabase/functions/dpdp-monday-email/render"
import { REMINDER_KINDS, type ReminderKind, dateLabel, isDeliverableAddress, SELLER, renderReceipt, renderReminder, rupees } from "../../../supabase/functions/_shared/billing-mail"
import { buildOutbound } from "../../../supabase/functions/_shared/mail-outbound"

const base = { orgName: "Acme Associates", daysLeft: 10, dueDate: "2026-10-31T00:00:00Z", priceLabel: rupees(999900), appUrl: "https://dpdp.veridian-aios.com/app/" }
const render = (kind: ReminderKind, daysLeft = 10) => renderReminder({ ...base, kind, daysLeft })

describe("reminders", () => {
  test("rupees and dates are fixed-format", () => {
    expect(rupees(999900)).toBe("Rs 9,999")
    expect(dateLabel("2026-10-31T00:00:00Z")).toBe("31 Oct 2026")
    expect(dateLabel("not a date")).toBe("not a date")
  })
  test("day-20 and day-27 reminders say how long is left and that nothing stops", () => {
    for (const [kind, days] of [["trial10", 10], ["trial3", 3]] as const) {
      const r = render(kind, days)
      expect(r.subject).toBe(`Your free trial ends in ${days} days -- Acme Associates`)
      expect(r.text).toContain(`ends on 31 Oct 2026, ${days} days from now`)
      expect(r.text).toContain("access to your account does not change")
      expect(r.text).toContain("Rs 9,999 a year")
    }
  })
  test("singular day", () => {
    expect(render("trial3", 1).subject).toContain("in 1 day --")
  })
  test("day-30 'trial ended' says the data is safe and access is unchanged", () => {
    const r = render("trial0", 0)
    expect(r.subject).toContain("trial has ended")
    expect(r.subject).toContain("your data is safe")
    expect(r.text).toContain("Your data is safe and your access is unchanged")
    expect(r.text).toContain("lock you out")
  })
  test("renewal reminders name the date and the price", () => {
    for (const [kind, days] of [["renew30", 30], ["renew7", 7]] as const) {
      const r = render(kind, days)
      expect(r.subject).toBe("Your yearly plan renews on 31 Oct 2026 -- Acme Associates")
      expect(r.text).toContain(`${days} days from now`)
      expect(r.text).toContain("Rs 9,999 for the year")
      expect(r.text).toContain("does not stop if you pay a little late")
    }
  })
  test("every reminder says the card is entered on Razorpay's page or that payment is online-or-bank, and links the app", () => {
    for (const kind of REMINDER_KINDS) {
      const r = render(kind)
      expect(r.text).toContain("https://dpdp.veridian-aios.com/app/")
      expect(r.text).toMatch(/Razorpay/)
      expect(r.text).toMatch(/bank transfer/)
      expect(r.text).toContain("-- VERIDIAN AI DPDP")
    }
  })
  test("no claim we cannot back: no 'instant', 'secure', 'guarantee', '100%', 'unlimited'", () => {
    for (const kind of REMINDER_KINDS) {
      const r = render(kind)
      for (const w of ["instant", "secure", "guarantee", "100%", "unlimited", "best"]) expect((r.subject + r.text).toLowerCase()).not.toContain(w)
    }
    expect(renderReceipt({ orgName: "A", plan: "firm", interval: "year", amountPaise: 999900, periodStart: "2026-10-01", confirmedAt: "2026-10-01T05:00:00Z" }).text.toLowerCase()).not.toMatch(/instant|secure|guarantee/)
  })
  test("html is escaped (an organisation name cannot inject markup)", () => {
    const r = renderReminder({ ...base, kind: "trial10", orgName: "<img src=x onerror=alert(1)>" })
    expect(r.html).not.toContain("<img")
    expect(r.html).toContain("&lt;img")
  })
  test("the envelope: one public mailbox, class tag in Reply-To, prefix once", () => {
    const sales = buildOutbound("sales_chain", render("trial10").subject)
    expect(sales.from).toContain("dpdp@veridian-aios.com")
    expect(sales.reply_to).toMatch(/^dpdp\+sch\.[0-9a-z]{10}@veridian-aios\.com$/)
    expect(sales.subject.startsWith("[VERIDIAN DPDP · Sales thread] ")).toBe(true)
    const inv = buildOutbound("invoice", render("renew7").subject)
    expect(inv.reply_to).toMatch(/^dpdp\+inv\./)
  })
})

describe("receipt", () => {
  const rec = { orgName: "Acme Associates", plan: "institution" as const, interval: "year" as const, amountPaise: 999900, periodStart: "2026-10-01", confirmedAt: "2026-10-01T05:00:00Z" }
  test("says what was paid and shows the Razorpay reference when there is one", () => {
    const r = renderReceipt({ ...rec, razorpayPaymentId: "pay_Abc123" })
    expect(r.subject).toBe("Your VERIDIAN receipt -- Acme Associates (Rs 9,999)")
    expect(r.text).toContain("Plan: Institution edition, Yearly")
    expect(r.text).toContain("Amount: Rs 9,999")
    expect(r.text).toContain("Payment reference: pay_Abc123")
    expect(r.text).toContain("Billing period start: 1 Oct 2026")
  })
  test("a bank-transfer receipt (no Razorpay id) has no online line", () => {
    expect(renderReceipt(rec).text).not.toContain("Razorpay")
  })
})

describe("recipient guard", () => {
  test("the shared guard agrees with dpdp-monday-email's on every kind of address", () => {
    const addrs = ["a@gmail.com", "owner@acme.in", "x@example.com", "x@foo.example.org", "x@example.org", "x@mail.test", "x@localhost", "x@bad", "x@x.invalid", "noatsign", "@nodomain.com", "", "  Owner@Acme.In "]
    for (const a of addrs) expect(isDeliverableAddress(a)).toBe(mondayDeliverable(a))
    expect(isDeliverableAddress("x@example.com")).toBe(false)
    expect(isDeliverableAddress("owner@acme.in")).toBe(true)
  })
})

describe("the receipt names who issued it", () => {
  test("legal name, GSTIN, CIN and registered office are on the receipt and equal the facts file", () => {
    const text = renderReceipt({ orgName: "A", plan: "firm", interval: "year", amountPaise: 999900, periodStart: "2026-10-01", confirmedAt: "2026-10-01T05:00:00Z" }).text
    expect(text).toContain("GSTIN: 09AAZCS4477M1Z3")
    expect(text).toContain("CIN: U74999UP2017PTC098453")
    expect(text).toContain("SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED")
    const facts = readFileSync(join(__dirname, "../../../dpdp-app/data/veridian-facts.yaml"), "utf8") as string
    expect(facts).toContain(`gstin: ${SELLER.gstin}`)
    expect(facts).toContain(`cin: ${SELLER.cin}`)
    expect(facts).toContain(`legal_name: ${SELLER.legalName}`)
    expect(facts).toContain(SELLER.registeredOffice)
  })
})
