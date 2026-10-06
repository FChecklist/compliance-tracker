/// <reference types="bun-types" />
// The browser's copy of the billing rules (src/lib/billing-state.ts). The database decides; these functions only word and calculate. The same
// rules are compared with the real database function at every boundary in src/lib/services/dpdp-account-billing.pglite.test.ts (repo root).
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_BILLING_SETTINGS, EARNINGS_DISCLAIMER, LOCKED_ALLOWED_ACTIONS, PAYMENT_DUE_PREFIX, billingState, canAddClient, capMessage, dueLine, earningsExample, finalDownloadDue,
  formatRupees, isPaymentDueError, offerLabel, periodEnd, planForClients, yearlyChargePaise, type PlanWire,
} from "./billing-state"

const DAY = 86_400_000
const opened = new Date("2026-01-01T00:00:00Z")
const at = (days: number, ms = 0) => new Date(opened.getTime() + days * DAY + ms)

describe("billingState", () => {
  test("trial 30 days, due on day 31, grace 7 days, then locked: every edge", () => {
    const s = (d: Date) => billingState({ openedAt: opened, paidUntil: null, now: d })
    expect(s(at(0))).toBe("TRIAL")
    expect(s(at(30, -1))).toBe("TRIAL")
    expect(s(at(30))).toBe("DUE")
    expect(s(at(31, -1))).toBe("DUE")
    expect(s(at(31))).toBe("GRACE")
    expect(s(at(38, -1))).toBe("GRACE")
    expect(s(at(38))).toBe("LOCKED")
    expect(s(at(5000))).toBe("LOCKED")
  })

  test("paid: ACTIVE until paid-until, then the same run from that date", () => {
    const paidUntil = at(100)
    const s = (d: Date) => billingState({ openedAt: opened, paidUntil, now: d })
    expect(s(at(50))).toBe("ACTIVE")
    expect(s(at(100, -1))).toBe("ACTIVE")
    expect(s(at(100))).toBe("DUE")
    expect(s(at(101))).toBe("GRACE")
    expect(s(at(108))).toBe("LOCKED")
  })

  test("a free verified firm is always ACTIVE", () => {
    expect(billingState({ free: true, openedAt: opened, paidUntil: null, now: at(9999) })).toBe("ACTIVE")
  })

  test("the periods are settings: change them and the machine moves", () => {
    const longer = { ...DEFAULT_BILLING_SETTINGS, trialDays: 60, graceDays: 14 }
    expect(billingState({ openedAt: opened, paidUntil: null, now: at(45) }, longer)).toBe("TRIAL")
    expect(billingState({ openedAt: opened, paidUntil: null, now: at(60 + 1 + 13) }, longer)).toBe("GRACE")
    expect(billingState({ openedAt: opened, paidUntil: null, now: at(60 + 1 + 14) }, longer)).toBe("LOCKED")
    expect(periodEnd(opened, null, longer).getTime()).toBe(at(60).getTime())
  })

  test("final download: only 90+ days past the period end, never for a free firm", () => {
    expect(finalDownloadDue({ openedAt: opened, paidUntil: null, now: at(30 + 89) })).toBe(false)
    expect(finalDownloadDue({ openedAt: opened, paidUntil: null, now: at(30 + 90) })).toBe(true)
    expect(finalDownloadDue({ free: true, openedAt: opened, paidUntil: null, now: at(9999) })).toBe(false)
  })
})

describe("the calm line and the locked-screen rules", () => {
  test("only DUE, GRACE and LOCKED have a line; it is calm (no alarm words) and says the data is safe when locked", () => {
    expect(dueLine("TRIAL")).toBeNull()
    expect(dueLine("ACTIVE")).toBeNull()
    for (const s of ["DUE", "GRACE", "LOCKED"] as const) {
      const l = dueLine(s)!
      expect(l.toLowerCase()).not.toMatch(/urgent|immediately|final warning|suspended|terminated|penalty|legal action|!/)
      expect(l).toContain("payment for this account is due".replace("payment", s === "LOCKED" ? "Payment" : "payment"))
    }
    expect(dueLine("LOCKED")).toContain("Your data is safe")
  })

  test("the always-open list is the legal-duty set plus paying and downloading (and signing out)", () => {
    expect([...LOCKED_ALLOWED_ACTIONS].sort()).toEqual(["answer_grievance", "declare_payment", "download_data", "pay", "record_breach", "sign_out", "withdraw_consent"])
  })

  test("the refusal is recognised by its words, and only by them", () => {
    expect(isPaymentDueError(`${PAYMENT_DUE_PREFIX}, so this screen is paused.`)).toBe(true)
    expect(isPaymentDueError("Not a member of this organisation")).toBe(false)
    expect(isPaymentDueError(null)).toBe(false)
    expect(isPaymentDueError(undefined)).toBe(false)
    expect(isPaymentDueError("payment is due")).toBe(false)
  })
})

describe("plans, prices and the client cap", () => {
  const plans: PlanWire[] = [
    { key: "firm_free", accountType: "firm", name: "Free", maxClients: 0, requiresDeclaration: true, listMonthlyPaise: 0, monthlyPaise: 0, offerLabel: null, yearlyMonthsCharged: 10 },
    { key: "firm_growth", accountType: "firm", name: "Growth", maxClients: 100, requiresDeclaration: false, listMonthlyPaise: 200100, monthlyPaise: 99900, offerLabel: "Festive offer: 50% off", yearlyMonthsCharged: 10 },
    { key: "firm_starter", accountType: "firm", name: "Starter", maxClients: 10, requiresDeclaration: false, listMonthlyPaise: 80100, monthlyPaise: 39900, offerLabel: "Festive offer: 50% off", yearlyMonthsCharged: 10 },
    { key: "institution", accountType: "institution", name: "Institution", maxClients: 0, requiresDeclaration: false, listMonthlyPaise: 80100, monthlyPaise: 39900, offerLabel: null, yearlyMonthsCharged: 10 },
  ]

  test("a year is ten months", () => {
    expect(yearlyChargePaise(39900)).toBe(399000)
    expect(yearlyChargePaise(99900, 10)).toBe(999000)
  })

  test("the offer wording is 'Festive offer: N% off' and never 'discount'", () => {
    expect(offerLabel(80100, 39900)).toBe("Festive offer: 50% off")
    expect(offerLabel(200100, 99900)).toBe("Festive offer: 50% off")
    expect(offerLabel(80100, 80100)).toBeNull()
    expect(offerLabel(0, 0)).toBeNull()
    expect(String(offerLabel(80100, 39900)).toLowerCase()).not.toContain("discount")
  })

  test("the cap: allowed below it, refused at it, never for the free plan; the message is calm and names the cap", () => {
    expect(canAddClient(9, 10)).toBe(true)
    expect(canAddClient(10, 10)).toBe(false)
    expect(canAddClient(0, 0)).toBe(false)
    expect(capMessage(10)).toBe("Your plan covers up to 10 client organisations. To add more, choose a bigger plan.")
    expect(capMessage(0)).toContain("own firm's file")
  })

  test("the cheapest paid plan that covers N clients, never the free one", () => {
    expect(planForClients(plans, 1)!.key).toBe("firm_starter")
    expect(planForClients(plans, 10)!.key).toBe("firm_starter")
    expect(planForClients(plans, 11)!.key).toBe("firm_growth")
    expect(planForClients(plans, 100)!.key).toBe("firm_growth")
    expect(planForClients(plans, 101)).toBeUndefined()
    expect(planForClients(plans, 0)!.key).toBe("firm_starter")
  })

  test("the earnings example: clients x fee, minus the plan price; bad input is treated as zero; it is labelled an example", () => {
    expect(earningsExample(20, 500, 39900)).toEqual({ clients: 20, feePerClientRupees: 500, monthlyIncomeRupees: 10000, planPriceRupees: 399, netRupees: 9601 })
    expect(earningsExample(-4, 500, 39900).monthlyIncomeRupees).toBe(0)
    expect(earningsExample(Number.NaN, Number.NaN, 0)).toMatchObject({ clients: 0, feePerClientRupees: 0, netRupees: 0 })
    expect(earningsExample(2.9, 100, 0).clients).toBe(2)
    expect(EARNINGS_DISCLAIMER).toBe("Example, not a guarantee.")
    expect(formatRupees(39900)).toBe("Rs 399")
  })

  test("no price is typed into a screen: none of the new account screens contains a rupee figure", () => {
    for (const f of ["PaymentDue.tsx", "EarningsCalculator.tsx", "OwnerAccountsAdmin.tsx"]) {
      const t = readFileSync(join(import.meta.dir, "..", "components", f), "utf8").replace(/borderRadius: 999/g, "") // a pill's radius is not a price
      expect(t, f).not.toMatch(/\b(399|801|999|1999|2001|2999|4001|6001|9999)\b/)
    }
    const screens = readFileSync(join(import.meta.dir, "..", "components", "Screens.tsx"), "utf8").replace(/borderRadius: 999/g, "")
    expect(screens).not.toMatch(/\b(399|801|999|1999|2001|2999|4001|6001|9999)\b/)
  })
})
