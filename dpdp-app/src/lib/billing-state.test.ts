/// <reference types="bun-types" />
// The browser's copy of the billing rules (src/lib/billing-state.ts). The database decides; these functions only word and calculate. The same
// rules are compared with the real database function at every boundary in src/lib/services/dpdp-account-billing.pglite.test.ts (repo root).
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_BILLING_SETTINGS, EARNINGS_DISCLAIMER, LOCKED_ALLOWED_ACTIONS, PAYMENT_DUE_PREFIX, billingState, canAddClient, capMessage, clientsLine, dueLine, earningsExample,
  finalDownloadDue, firmPlan, ladderLine, monthlyTotalPaise, packLength, packNudgeLines, PAYMENT_PENDING_FOR_STAFF, formatRupees, isPaymentDueError, offerLabel, periodEnd, yearOffLabel, yearAsMonthlyPhrase, yearlyPerClientLine, yearlyPerClientPhrase,
  yearlyChargePaise, type PlanWire,
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

  test("nobody is free: a firm that never pays runs the same TRIAL / DUE / GRACE / LOCKED course as anyone", () => {
    expect(billingState({ openedAt: opened, paidUntil: null, now: at(9999) })).toBe("LOCKED")
  })

  test("the periods are settings: change them and the machine moves", () => {
    const longer = { ...DEFAULT_BILLING_SETTINGS, trialDays: 60, graceDays: 14 }
    expect(billingState({ openedAt: opened, paidUntil: null, now: at(45) }, longer)).toBe("TRIAL")
    expect(billingState({ openedAt: opened, paidUntil: null, now: at(60 + 1 + 13) }, longer)).toBe("GRACE")
    expect(billingState({ openedAt: opened, paidUntil: null, now: at(60 + 1 + 14) }, longer)).toBe("LOCKED")
    expect(periodEnd(opened, null, longer).getTime()).toBe(at(60).getTime())
  })

  test("final download: only 90+ days past the period end", () => {
    expect(finalDownloadDue({ openedAt: opened, paidUntil: null, now: at(30 + 89) })).toBe(false)
    expect(finalDownloadDue({ openedAt: opened, paidUntil: null, now: at(30 + 90) })).toBe(true)
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

  test("everyone but the owner is told 'Payment pending. Please check with your admin.' and gets no pay link (owner, 2026-11-02)", () => {
    expect(PAYMENT_PENDING_FOR_STAFF).toBe("Payment pending. Please check with your admin.")
    const render = readFileSync(join(import.meta.dir, "..", "..", "..", "supabase", "functions", "dpdp-monday-email", "render.ts"), "utf8")
    // The e-mail carries the very same words, and the pay link sits only inside the owner branch.
    expect(render).toContain(`export const PAYMENT_PENDING_FOR_STAFF = "${PAYMENT_PENDING_FOR_STAFF}"`)
    const ownerBranch = render.indexOf('if (digest.level === "owner") {')
    const payLink = render.indexOf('const payLink = "https://dpdp.veridian-aios.com/app/"')
    const staffBranch = render.indexOf("} else {", ownerBranch)
    expect(ownerBranch).toBeGreaterThan(-1)
    expect(payLink).toBeGreaterThan(ownerBranch)
    expect(payLink).toBeLessThan(staffBranch)
    expect(render.slice(staffBranch, staffBranch + 700)).not.toContain("payLink")
    // The app's locked screen uses the constant, not a retyped line.
    const screen = readFileSync(join(import.meta.dir, "..", "components", "PaymentDue.tsx"), "utf8")
    expect(screen).toContain("PAYMENT_PENDING_FOR_STAFF")
    expect(screen).not.toContain("Please ask the owner of your organisation to complete the payment")
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
  // The numbers below are what dpdp_public_plans sends today (drizzle/0755); the functions under test are the rules, the numbers are fixtures.
  const pack = { packPricePaise: 9900, packDays: 90, packMaxClients: 10 }
  const plans: PlanWire[] = [
    { key: "institution", accountType: "institution", name: "Organisation", maxClients: 0, requiresDeclaration: false, listMonthlyPaise: 99900, monthlyPaise: 99900, offerLabel: null, yearlyMonthsCharged: 6, includedClients: 0, extraClientMonthlyPaise: 0, ...pack },
    { key: "firm", accountType: "firm", name: "Professional", maxClients: 10, requiresDeclaration: false, listMonthlyPaise: 99900, monthlyPaise: 99900, offerLabel: null, yearlyMonthsCharged: 6, includedClients: 10, extraClientMonthlyPaise: 5000, ...pack },
  ]
  const firm = plans[1]

  test("a year is six months: half price", () => {
    expect(yearlyChargePaise(99900, 6)).toBe(599400)
    expect(yearlyChargePaise(179900, 6)).toBe(1079400)
    expect(yearOffLabel(6)).toBe("50% off")
    expect(yearOffLabel(12)).toBeNull() // a year that saves nothing says nothing
    expect(yearOffLabel(10)).toBe("17% off")
  })

  test("the owner's price examples to the paisa: the base price covers ten clients, each client beyond adds Rs 50 a month (Rs 300 a year), counted on the real number", () => {
    const month = (clients: number) => monthlyTotalPaise(firm.monthlyPaise, firm.includedClients, firm.extraClientMonthlyPaise, clients)
    const year = (clients: number) => yearlyChargePaise(month(clients), firm.yearlyMonthsCharged)
    expect([0, 1, 10].map(month)).toEqual([99900, 99900, 99900])
    const examples: Array<[number, number, number]> = [[10, 99900, 599400], [50, 299900, 1799400], [100, 549900, 3299400], [500, 2549900, 15299400], [1000, 5049900, 30299400]]
    for (const [clients, m, y] of examples) expect([month(clients), year(clients)], `${clients} clients`).toEqual([m, y])
    // no tiers: 11 clients is one client more than 10, not a jump to a bigger plan
    expect(month(11) - month(10)).toBe(5000)
    expect(month(101) - month(100)).toBe(5000)
    expect(year(11) - year(10)).toBe(30000) // Rs 300 a year for each client beyond ten
    // an Organisation has no clients to count
    const org = plans[0]
    expect(monthlyTotalPaise(org.monthlyPaise, org.includedClients, org.extraClientMonthlyPaise, 7)).toBe(99900)
    // bad input counts as none
    expect(monthlyTotalPaise(99900, 10, 5000, Number.NaN)).toBe(99900)
    expect(monthlyTotalPaise(99900, 10, 5000, -5)).toBe(99900)
  })

  test("the ladder is said in one calm line before anyone pays the pack, from the plan's own numbers", () => {
    expect(packLength(90)).toBe("3 months")
    expect(packLength(30)).toBe("1 month")
    expect(packLength(45)).toBe("45 days")
    expect(packLength(60)).toBe("2 months")
    expect(ladderLine(firm)).toBe("Rs 99 for 3 months, then Rs 999 a month or Rs 5,994 a year (50% off, effectively about Rs 499 a month).")
    expect(ladderLine(plans[0])).toBe("Rs 99 for 3 months, then Rs 999 a month or Rs 5,994 a year (50% off, effectively about Rs 499 a month).")
    expect(clientsLine(firm)).toBe("Includes 10 clients, then Rs 50 a month (Rs 300 a year) for each further client.")
    // without the year's months (an older caller) it says the month only
    expect(clientsLine({ includedClients: 10, extraClientMonthlyPaise: 5000 })).toBe("Includes 10 clients, then Rs 50 a month for each further client.")
    expect(clientsLine(plans[0])).toBeNull()
    // the ladder follows the database: change the pack, the price or the year and the words move with it
    expect(ladderLine({ ...firm, packPricePaise: 19900, packDays: 45, monthlyPaise: 149900, yearlyMonthsCharged: 8 })).toBe("Rs 199 for 45 days, then Rs 1,499 a month or Rs 11,992 a year (33% off, effectively about Rs 999 a month).")
    // a year that saves nothing says nothing about a monthly equivalent
    expect(ladderLine({ ...firm, yearlyMonthsCharged: 12 })).toBe("Rs 99 for 3 months, then Rs 999 a month or Rs 11,988 a year.")
  })

  test("a year is said as 'effectively about Rs 499 a month' (Rs 499.50, never rounded up), and the ten-client yearly plan as 'under Rs 50 per client per month' (Rs 49.95, never Rs 49)", () => {
    expect(yearAsMonthlyPhrase(99900, 6)).toBe("effectively about Rs 499 a month")
    expect(yearAsMonthlyPhrase(299900, 6)).toBe("effectively about Rs 1,499 a month") // Rs 17,994 a year = Rs 1,499.50
    expect(yearAsMonthlyPhrase(100000, 6)).toBe("effectively Rs 500 a month") // an exact figure carries no "about"
    expect(yearAsMonthlyPhrase(99900, 12)).toBeNull() // no saving, nothing to say
    expect(yearlyPerClientPhrase(firm)).toBe("under Rs 50 per client per month")
    expect(yearlyPerClientPhrase({ ...firm, monthlyPaise: 100000 })).toBe("Rs 50 per client per month") // exactly Rs 50 each: not "under"
    expect(yearlyPerClientPhrase(plans[0])).toBeNull() // an Organisation has no clients to divide by
    expect(yearlyPerClientLine(firm)).toBe("On the yearly plan, 10 clients come to under Rs 50 per client per month.")
    expect(yearlyPerClientLine(plans[0])).toBeNull()
    // never the wrong figure, and the monthly plan is not claimed to be under Rs 50 (it is Rs 99.90 a client)
    for (const t of [yearAsMonthlyPhrase(99900, 6), yearlyPerClientPhrase(firm), yearlyPerClientLine(firm), ladderLine(firm)]) {
      expect(t).not.toMatch(/Rs 49\b/) // "Rs 499" is the intended figure; "Rs 49" alone would be the wrong one
      expect(t).not.toContain("Rs 500 a month")
    }
    expect(ladderLine(firm)).not.toMatch(/per client/)
  })

  test("the soft ask at the first-e-mail step says the pack and what follows it, from the account's numbers; nothing when the pack is gone", () => {
    const money = { monthPaise: 99900, yearlyMonthsCharged: 6, pack: { available: true, pricePaise: 9900, days: 90, maxClients: 10 }, perClient: { includedClients: 10, extraMonthlyPaise: 5000 } }
    expect(packNudgeLines(money, "firm")).toEqual([
      "Rs 99 for 3 months, then Rs 999 a month or Rs 5,994 a year (50% off, effectively about Rs 499 a month).",
      "Includes 10 clients, then Rs 50 a month (Rs 300 a year) for each further client.",
      "On the yearly plan, 10 clients come to under Rs 50 per client per month.",
      "The trial pack covers up to 10 clients.",
    ])
    // an Organisation has no clients to count, so it hears the ladder only
    expect(packNudgeLines({ ...money, perClient: { includedClients: 0, extraMonthlyPaise: 0 } }, "institution")).toEqual(["Rs 99 for 3 months, then Rs 999 a month or Rs 5,994 a year (50% off, effectively about Rs 499 a month)."])
    expect(packNudgeLines({ ...money, pack: { ...money.pack, available: false } }, "firm")).toBeNull()
    // the wizard shows it above the send button, and the button is not disabled by it
    const wizard = readFileSync(join(import.meta.dir, "..", "components", "onepage", "FirstVisitWizard.tsx"), "utf8")
    expect(wizard.indexOf("{payNote}")).toBeGreaterThan(-1)
    expect(wizard.indexOf("{payNote}")).toBeLessThan(wizard.indexOf("Save and send the first emails"))
    expect(wizard).toContain("disabled={pending}")
  })

  test("the offer wording is 'Festive offer: N% off' and never 'discount'", () => {
    expect(offerLabel(80100, 39900)).toBe("Festive offer: 50% off")
    expect(offerLabel(200100, 99900)).toBe("Festive offer: 50% off")
    expect(offerLabel(80100, 80100)).toBeNull()
    expect(offerLabel(0, 0)).toBeNull()
    expect(String(offerLabel(80100, 39900)).toLowerCase()).not.toContain("discount")
  })

  test("the cap is only the trial pack's: allowed below it, refused at it, never for a firm on a monthly or yearly plan; the message is calm and names the cap and the extra price", () => {
    expect(canAddClient(9, 10)).toBe(true)
    expect(canAddClient(10, 10)).toBe(false)
    expect(canAddClient(0, 0)).toBe(false)
    expect(canAddClient(5000, null)).toBe(true) // null = no limit
    expect(capMessage(10, 10, 5000)).toBe(
      "Your trial pack covers up to 10 client organisations. To add more, start the monthly or yearly plan: it covers any number of clients (Rs 50 a month for each client beyond 10).",
    )
  })

  test("the one Professional plan is found by its type (there are no tiers and no free plan any more)", () => {
    expect(firmPlan(plans)!.key).toBe("firm")
    expect(firmPlan([plans[0]])).toBeUndefined()
    expect(firmPlan([])).toBeUndefined()
  })

  test("the earnings example: clients x fee, minus what the firm pays for that many clients; bad input is treated as zero; it is labelled an example", () => {
    // 20 clients at Rs 500: income 10,000; the firm pays Rs 999 + 10 x Rs 50 = Rs 1,499
    const cost = monthlyTotalPaise(firm.monthlyPaise, firm.includedClients, firm.extraClientMonthlyPaise, 20)
    expect(cost).toBe(149900)
    expect(earningsExample(20, 500, cost)).toEqual({ clients: 20, feePerClientRupees: 500, monthlyIncomeRupees: 10000, planPriceRupees: 1499, netRupees: 8501 })
    expect(earningsExample(-4, 500, 99900).monthlyIncomeRupees).toBe(0)
    expect(earningsExample(Number.NaN, Number.NaN, 0)).toMatchObject({ clients: 0, feePerClientRupees: 0, netRupees: 0 })
    expect(earningsExample(2.9, 100, 0).clients).toBe(2)
    expect(EARNINGS_DISCLAIMER).toBe("Example, not a guarantee.")
    expect(formatRupees(99900)).toBe("Rs 999")
    expect(formatRupees(599400)).toBe("Rs 5,994")
  })

  test("no price is typed into a screen: none of the account screens contains a rupee figure or the old plan tiers", () => {
    const figure = /\b(99|399|499|801|999|1999|2001|2999|4001|5994|6001|9900|9999|10794|17994|99900|599400)\b/
    for (const f of ["PaymentDue.tsx", "EarningsCalculator.tsx", "OwnerAccountsAdmin.tsx"]) {
      const t = readFileSync(join(import.meta.dir, "..", "components", f), "utf8").replace(/borderRadius: 999/g, "") // a pill's radius is not a price
      expect(t, f).not.toMatch(figure)
      expect(t, `${f}: a typed rupee amount`).not.toMatch(/\bRs\.? ?\d/)
    }
    // BillingPanel holds exactly two typed numbers, the fallback for an organisation with no account (dpdp-pay-logic.test.ts pins them to the plan table)
    const panel = readFileSync(join(import.meta.dir, "..", "components", "BillingPanel.tsx"), "utf8").split("\n")
      .filter((l) => !/^\s*\/\//.test(l) && !/^const (MONTHLY|YEARLY)_PAISE = /.test(l)).join("\n").replace(/borderRadius: 999/g, "")
    expect(panel, "BillingPanel.tsx").not.toMatch(figure)
    expect(panel, "BillingPanel.tsx: a typed rupee amount").not.toMatch(/\bRs\.? ?\d/)
    const screens = readFileSync(join(import.meta.dir, "..", "components", "Screens.tsx"), "utf8").replace(/borderRadius: 999/g, "")
    expect(screens).not.toMatch(figure)
    expect(screens, "Screens.tsx: a typed rupee amount").not.toMatch(/\bRs\.? ?\d/)
  })
})
