/// <reference types="bun-types" />
// Sales Partner emails (supabase/functions/dpdp-partner-email) and the rule that payout details never
// leave the partner tables. Pure: no Deno, no network.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { flushNotices } from "../../../supabase/functions/dpdp-partner-email/flush"
import { type Notice, dateLabel, isDeliverableAddress, monthLabel, renderNotice, rupees } from "../../../supabase/functions/dpdp-partner-email/render"
import { parseRecipient } from "../../../supabase/functions/_shared/mail-taxonomy"

const notice = (kind: Notice["kind"], payload: Record<string, unknown> = {}, to = "ravi@gmail.com"): Notice => ({ id: `n-${kind}`, kind, to, name: "Ravi Kumar", payload })

describe("partner email text", () => {
  test("money and dates read plainly", () => {
    expect(rupees(199980)).toBe("Rs 1,999.80")
    expect(monthLabel("2026-09")).toBe("September 2026")
    expect(dateLabel("2026-10-10")).toBe("10 October 2026")
  })

  test("every kind renders, greets by name, and says the tax line only as the owner-approved sentence", () => {
    const all: Notice[] = [
      notice("welcome"), notice("referred_signup", { edition: "firm" }), notice("commission_earned", { amountPaise: 199980, basis: "yearly" }),
      notice("payout_sent", { period: "2026-09", grossPaise: 210025, tdsPaise: 21003, netPaise: 189022, method: "upi", reference: "UTR1234567", commissions: 3 }),
      notice("statement", { period: "2026-09", madePaise: 1, paidGrossPaise: 2, paidTdsPaise: 3, paidNetPaise: 4, waitingPaise: 5, payablePaise: 6, nextPayoutOn: "2026-10-10", minPayoutPaise: 50000 }),
      notice("details_changed", { at: "2026-10-01T00:00:00Z" }),
    ]
    for (const n of all) {
      const r = renderNotice(n)
      expect(r.subject.length, n.kind).toBeGreaterThan(10)
      expect(r.text, n.kind).toContain("Hello Ravi Kumar,")
      expect(r.html, n.kind).toContain("<p")
      // No tax rate and no tax advice: the only tax sentence allowed is the fixed one.
      expect(r.text, n.kind).not.toMatch(/\b\d+(\.\d+)?\s?%\s*(TDS|tax)|TDS (at|of) \d/i)
      expect(r.text, n.kind).not.toMatch(/\b(best|leading|guarantee|#1)\b/i)
    }
    expect(renderNotice(notice("welcome")).text).toContain("Tax (TDS) is deducted where the law requires it and shown on your statement.")
  })

  test("the payout email shows gross, TDS, net and the reference; the signup email never names the client", () => {
    const p = renderNotice(notice("payout_sent", { period: "2026-09", grossPaise: 210025, tdsPaise: 21003, netPaise: 189022, method: "bank", reference: "UTR1234567", commissions: 3 }))
    expect(p.text).toContain("Gross: Rs 2,100.25")
    expect(p.text).toContain("TDS: Rs 210.03")
    expect(p.text).toContain("Net sent to you: Rs 1,890.22")
    expect(p.text).toContain("Reference: UTR1234567")
    expect(p.subject).toContain("Rs 1,890.22")
    const s = renderNotice(notice("referred_signup", { edition: "institution", orgName: "Secret School" }))
    expect(s.text + s.subject).not.toContain("Secret School")
  })

  test("a reply to a partner email is filed as a Partner ticket", () => {
    expect(parseRecipient("dpdp+prt.k3f9x2ab7q@veridian-aios.com").cls).toBe("partner")
  })

  test("reserved test addresses are never sent to", () => {
    expect(isDeliverableAddress("a@partner-test.invalid")).toBe(false)
    expect(isDeliverableAddress("a@example.com")).toBe(false)
    expect(isDeliverableAddress("ravi@gmail.com")).toBe(true)
  })
})

describe("flushNotices", () => {
  const harness = (notices: Notice[], failFor: string[] = [], dryRun = false) => {
    const marks: string[] = []
    const sent: string[] = []
    return {
      marks, sent,
      deps: {
        from: "VERIDIAN AI DPDP <dpdp@veridian-aios.com>", dryRun,
        pending: async () => notices,
        mark: async (id: string, status: string) => void marks.push(`${id}:${status}`),
        send: async (to: string, _r: unknown, out: { subject: string; reply_to: string }) => {
          if (failFor.includes(to)) throw new Error("Resend 500")
          sent.push(`${to}|${out.subject}|${out.reply_to}`)
          return "re_1"
        },
        log: async () => {},
      },
    }
  }

  test("sends each notice from the one address with a Partner subject and Reply-To, marks it sent", async () => {
    const h = harness([notice("welcome")])
    const s = await flushNotices(h.deps)
    expect(s).toMatchObject({ found: 1, sent: 1, failed: 0, skipped: 0 })
    expect(h.marks).toEqual(["n-welcome:sent"])
    expect(h.sent[0]).toContain("[VERIDIAN DPDP · Partner] You are now a VERIDIAN Sales Partner")
    expect(h.sent[0]).toMatch(/dpdp\+prt\.[0-9a-z]{10}@veridian-aios\.com$/)
  })

  test("one failure does not stop the others; it is marked failed", async () => {
    const h = harness([notice("welcome", {}, "bad@gmail.com"), notice("details_changed", {}, "ok@gmail.com")], ["bad@gmail.com"])
    const s = await flushNotices(h.deps)
    expect(s).toMatchObject({ sent: 1, failed: 1 })
    expect(h.marks).toEqual(["n-welcome:failed", "n-details_changed:sent"])
  })

  test("a test-domain address is skipped, never sent", async () => {
    const h = harness([notice("welcome", {}, "x@partner-test.invalid")])
    expect(await flushNotices(h.deps)).toMatchObject({ sent: 0, skipped: 1 })
    expect(h.sent).toEqual([])
    expect(h.marks).toEqual(["n-welcome:skipped"])
  })

  test("a dry run sends and marks nothing", async () => {
    const h = harness([notice("welcome")], [], true)
    expect(await flushNotices(h.deps)).toMatchObject({ found: 1, sent: 0, dryRun: true })
    expect(h.marks).toEqual([])
  })
})

describe("payout details stay in the partner tables", () => {
  const root = join(import.meta.dir, "..", "..", "..")
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|mjs|sql)$/.test(f) ? [p] : []
    })

  test("no AI work link code, mail function or public script reads them", () => {
    const names = /partner_payout_detail|payout_detail|account_number|dpdp_admin_partner_payout_run/
    const files = [
      ...walk(join(root, "supabase", "functions", "dpdp-ai-link")),
      ...walk(join(root, "supabase", "functions", "ai-work-link")),
      ...walk(join(root, "supabase", "functions", "dpdp-partner-email")),
      ...walk(join(root, "supabase", "functions", "dpdp-monday-email")),
      ...walk(join(root, "supabase", "functions", "dpdp-invoice-email")),
    ].filter((f) => !f.endsWith(".test.ts"))
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(names)
  })

  test("the only SQL that reads the payout detail table is migration 0674, and 0723 (which encrypts it, plus its roll-back)", () => {
    const hits = walk(join(root, "drizzle")).filter((f) => (f.split(/[\\/]/).pop() ?? "") >= "0655" && readFileSync(f, "utf8").includes("partner_payout_detail"))
    expect(hits.map((f) => f.split(/[\\/]/).pop()).sort()).toEqual(["0674_dpdp_sales_partner_lifecycle.sql", "0723_dpdp_partner_payout_encrypted.down.sql", "0723_dpdp_partner_payout_encrypted.sql"])
  })
})
