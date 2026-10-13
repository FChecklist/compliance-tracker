// The seller of VERIDIAN DPDP and of the VERIDIAN AI website text is IT SERVICES BY RAJAT AGARWAL (a sole
// proprietorship, not registered for GST). No page text, receipt or e-mail may name any other legal entity,
// a CIN or a GSTIN.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { renderBillingDue, renderReceipt, renderReminder } from "../../../supabase/functions/_shared/billing-mail"

const ROOT = join(__dirname, "../../..")
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

const OLD_ENTITY = /shobha\s*kamal|shobhakamal|U74999UP2017PTC098453|09AAZCS4477M1Z3/i

describe("the website text and mail name only IT SERVICES BY RAJAT AGARWAL", () => {
  test("the shared legal shell, bar, home page, terms, privacy, data policy and disclaimer carry no old entity", () => {
    for (const f of ["src/components/LegalShell.tsx", "src/components/LegalBar.tsx", "src/app/page.tsx", "src/app/terms/page.tsx", "src/app/privacy/page.tsx", "src/app/data-policy/page.tsx", "src/app/disclaimer/page.tsx"]) {
      expect(read(f), f).not.toMatch(OLD_ENTITY)
    }
    expect(read("src/components/LegalShell.tsx")).toContain('legalName: "IT SERVICES BY RAJAT AGARWAL"')
    expect(read("src/components/LegalBar.tsx")).toContain("IT SERVICES BY RAJAT AGARWAL")
    expect(read("src/app/page.tsx")).toContain("IT SERVICES BY RAJAT AGARWAL")
  })

  test("the disclaimer carries no CIN and no placeholder tokens", () => {
    const d = read("src/app/disclaimer/page.tsx")
    expect(d).not.toMatch(/\bCIN\b/)
    expect(d).not.toMatch(/\[INSERT/)
  })

  test("the terms say we are a software company with nothing physical, and that Rajat Agarwal alone owns the software", () => {
    const t = read("src/app/terms/page.tsx")
    expect(t).toContain("We are a software company. We deliver no physical products or services")
    expect(t).toContain("owned by Rajat Agarwal alone")
  })

  test("no Edge Function or shared mail module names the old entity", () => {
    for (const f of ["supabase/functions/_shared/billing-mail.ts", "supabase/functions/_shared/brand-mail.ts", "supabase/functions/dpdp-pay/logic.ts", "supabase/functions/dpdp-pay/index.ts"]) {
      expect(read(f), f).not.toMatch(OLD_ENTITY)
    }
  })

  test("a receipt is issued by IT SERVICES BY RAJAT AGARWAL, says GST is not charged, and has no GSTIN, CIN or old entity", () => {
    const r = renderReceipt({ orgName: "Acme", plan: "firm", interval: "year", amountPaise: 399000, periodStart: "2026-10-01", confirmedAt: "2026-10-01T05:00:00Z" })
    for (const s of [r.text, r.html]) {
      expect(s).toContain("IT SERVICES BY RAJAT AGARWAL")
      expect(s).toContain("Not registered for GST. GST is not charged.")
      expect(s).not.toMatch(OLD_ENTITY)
      expect(s).not.toMatch(/GSTIN|\bCIN\b|Private Limited/i)
    }
    // The amount on the receipt is the whole amount: Rs 3,990 is shown as Rs 3,990, with nothing added.
    expect(r.text).toContain("Amount paid: Rs 3,990 (the whole amount; GST is not charged)")
  })

  test("reminders and billing notes name no old entity and add no GST", () => {
    const base = { orgName: "Acme", daysLeft: 3, dueDate: "2026-11-01", priceLabel: "Rs 3,990", appUrl: "https://app.veridian-aios.com/" }
    for (const kind of ["trial10", "trial3", "trial0", "renew30", "renew7"] as const) {
      const m = renderReminder({ ...base, kind })
      expect(m.text + m.html).not.toMatch(OLD_ENTITY)
      expect(m.text).not.toMatch(/plus GST|\+ GST|exclusive of GST/i)
    }
    const due = renderBillingDue({ orgName: "Acme", state: "DUE", line: "A gentle note.", role: "owner", payUrl: "https://x.example/pay", unsubscribeUrl: "https://x.example/u", finalDownload: false, downloadUrl: "https://x.example/d" })
    expect(due.text + due.html).not.toMatch(OLD_ENTITY)
  })
})
