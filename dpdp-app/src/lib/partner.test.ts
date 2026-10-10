/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { csvCell, payoutRunCsv, recentPeriods, rupees, rupeesPlain, statementCsv } from "./partner"
import type { AdminPayoutRun, PartnerStatementPayload } from "./rpc-types"

describe("partner helpers", () => {
  test("money reads with two decimals", () => {
    expect(rupees(199980)).toBe("Rs 1,999.80")
    expect(rupees(null)).toBe("--")
    expect(rupeesPlain(5)).toBe("0.05")
  })

  test("a CSV cell is quoted when needed and a formula is defused", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""')
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"")
    expect(csvCell("+91 98")).toBe("'+91 98")
    expect(csvCell(-5)).toBe("-5")
    expect(csvCell(null)).toBe("")
  })

  test("the statement CSV has gross, TDS and net, the payouts, the totals and the tax sentence", () => {
    const s: PartnerStatementPayload = {
      period: "2026-10", email: "p@x.com",
      lines: [{ madeOn: "2026-10-01", basis: "yearly", ratePercent: 20, grossPaise: 199980, tdsPaise: 19998, netPaise: 179982, status: "paid", payableOn: "2026-10-31", paidOn: "2026-11-10" }],
      payouts: [{ paidOn: "2026-11-10", period: "2026-10", method: "upi", reference: "UTR1234567", commissions: 1, grossPaise: 199980, tdsPaise: 19998, netPaise: 179982 }],
      totals: { madePaise: 199980, paidGrossPaise: 199980, paidTdsPaise: 19998, paidNetPaise: 179982, stillWaitingPaise: 0 },
    }
    const out = statementCsv(s)
    expect(out).toContain("Made on,Basis,Rate %,Gross (Rs),TDS (Rs),Net (Rs),Status,Payable on,Paid on")
    expect(out).toContain("2026-10-01,Yearly payment,20,1999.80,199.98,1799.82,Paid,2026-10-31,2026-11-10")
    expect(out).toContain("2026-11-10,2026-10,UPI,UTR1234567,1,1999.80,199.98,1799.82")
    expect(out).toContain("Tax (TDS) is deducted where the law requires it and shown on your statement.")
    expect(out.endsWith("\r\n")).toBe(true)
  })

  test("the payout CSV lists only partners who meet the minimum, with an empty reference column", () => {
    const base = { identityId: "i", status: "active" as const, upiId: null, accountName: "Ravi Kumar", accountNumber: "123456789012", ifsc: "HDFC0001234", pan: null, detailsUpdatedAt: "x", detailsChangedRecently: false }
    const run: AdminPayoutRun = {
      period: "2026-09", payableBefore: "2026-10-01", tdsPercentSet: true, tdsPercent: 10, minPayoutPaise: 50000, payoutDay: 10, held: [],
      partners: [
        { ...base, email: "a@x.com", name: "A", method: "bank", commissions: 2, grossPaise: 210025, tdsPaise: 21003, netPaise: 189022, meetsMinimum: true },
        { ...base, email: "b@x.com", name: "B", method: "bank", commissions: 1, grossPaise: 50, tdsPaise: 5, netPaise: 45, meetsMinimum: false },
      ],
    }
    const out = payoutRunCsv(run)
    expect(out).toContain("a@x.com,Ravi Kumar,Bank transfer,,123456789012,HDFC0001234,,2,2100.25,210.03,1890.22,2026-09,")
    expect(out).not.toContain("b@x.com")
  })

  test("recent periods run backwards across a year end", () => {
    expect(recentPeriods(new Date(Date.UTC(2026, 0, 15)), 3)).toEqual(["2026-01", "2025-12", "2025-11"])
  })
})
