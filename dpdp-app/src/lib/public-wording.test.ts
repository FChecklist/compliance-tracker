/// <reference types="bun-types" />
// What a visitor or a customer reads must read as a finished product from the company that sells it. This walks every public DPDP page (the
// sitemap's pages, the hidden /proof/ page, the llms text files) and every receipt/reminder e-mail text, and fails with the file name and the
// words if one of these shows up:
//   - the previous company's name, CIN or GSTIN
//   - "draft" used as a status ("draft", "DRAFT copy", "draft terms" ...)
//   - "legal review", "pending review", "lawyer to read"
//
// Two honest exceptions, both deliberate and both pinned below so they cannot grow by accident:
//   1. "draft" as a plain feature word. The AI assistant DRAFTS updates the person then confirms; that is what the product does, and the words
//      are listed one by one in FEATURE_DRAFT_WORDS. Any NEW use of the word fails until it is added there on purpose.
//   2. The product disclaimer on /disclaimer/ says the job library has not yet been reviewed or approved by a practising lawyer. That is a
//      true disclosure to customers, it contains none of the words above, and a test below fails if anyone removes or softens it.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { HIDDEN_PAGES, SITEMAP_PAGES } from "./public-surface.mjs"

const APP = join(import.meta.dir, "..", "..")
const read = (rel: string) => readFileSync(join(APP, rel), "utf8")

// The e-mail renderers live outside this app (supabase/functions/_shared) and import each other with ".ts" endings, which this app's own
// typecheck does not accept; loading them at run time by path keeps the typecheck clean and still runs the real renderers.
type Rendered = { subject: string; text: string; html: string }
const mail = (await import(pathToFileURL(join(APP, "..", "supabase", "functions", "_shared", "billing-mail.ts")).href)) as {
  renderReceipt: (d: Record<string, unknown>) => Rendered
  renderReminder: (d: Record<string, unknown>) => Rendered
  renderBillingDue: (d: Record<string, unknown>) => Rendered
  REMINDER_KINDS: readonly string[]
}
const { renderBillingDue, renderReceipt, renderReminder, REMINDER_KINDS } = mail

const OLD_ENTITY = /shobha\s*kamal|shobhakamal|U74999UP2017PTC098453|09AAZCS4477M1Z3/i
const BANNED: Array<[string, RegExp]> = [
  ["the previous company's name, CIN or GSTIN", OLD_ENTITY],
  ["legal review", /legal\s+review/i],
  ["pending review", /pending\s+review/i],
  ["lawyer to read", /lawyer\s+to\s+read/i],
]

/** "draft" as the AI assistant's plain verb/noun, exactly as the pages word it today. Lower case; matched against the whitespace-collapsed text. */
const FEATURE_DRAFT_WORDS = [
  "read and draft", // the AI link: "a limited, expiring link to read and draft"
  "lists, drafts, emails, summaries, ai output", // the disclaimer: output of the Service depends on your input
  "draft items on your behalf", // the terms: what an AI you connect may do within the level you allow
  "playbooks, drafts, software", // the terms: what the company owns
  "drafts the updates", // "It reads your jobs and drafts the updates. You confirm them."
  "drafts updates", // the AI assistant page's meta description
  "draft an update, such as marking a job done", // the AI assistant page's list
  "is a draft that you confirm", // "Anything with legal weight is a draft that you confirm."
  "draft ready for your review", // the sample chat on the home page
  "drafted. please confirm to record it", // the sample chat on the home page
]

function stripFeatureDraftWords(text: string): string {
  let out = text.toLowerCase().replace(/\s+/g, " ")
  for (const w of FEATURE_DRAFT_WORDS) out = out.split(w).join(" ")
  return out
}

function publicFiles(): string[] {
  const pages = [...SITEMAP_PAGES.map((p) => p.source), ...HIDDEN_PAGES.map((p) => p.source)].filter((s): s is string => typeof s === "string")
  return [...new Set([...pages, "public/llms.txt", "public/llms-full.txt", "public/404.html"])]
}

describe("the public pages read as a finished product from the company that sells it", () => {
  const files = publicFiles()

  test("the walk covers the home page, the legal pages and the llms text (so the check cannot pass by scanning nothing)", () => {
    expect(files.length).toBeGreaterThanOrEqual(15)
    for (const must of ["index.html", "public/terms/index.html", "public/refund/index.html", "public/privacy/index.html", "public/disclaimer/index.html", "public/llms-full.txt", "about/index.html"]) {
      expect(files, must).toContain(must)
    }
  })

  for (const [label, re] of BANNED) {
    test(`no public page contains ${label}`, () => {
      const hits = files.filter((f) => re.test(read(f)))
      expect(hits).toEqual([])
    })
  }

  test('no public page uses "draft" as anything but the AI assistant\'s plain feature word', () => {
    const hits: string[] = []
    for (const f of files) {
      const left = stripFeatureDraftWords(read(f))
      const m = /.{0,40}\bdraft.{0,40}/.exec(left)
      if (m) hits.push(`${f}: ...${m[0]}...`)
    }
    expect(hits).toEqual([])
  })

  test("every allowed feature use of the word is still on a page (a stale entry in the list would hide a later real one)", () => {
    const all = files.map((f) => read(f).toLowerCase().replace(/\s+/g, " ")).join("\n")
    for (const w of FEATURE_DRAFT_WORDS) expect(all, w).toContain(w)
  })
})

describe("receipt and reminder e-mail text", () => {
  const bodies: Array<[string, string]> = []
  const receipt = { orgName: "Mehta & Co", plan: "firm", interval: "year", amountPaise: 999_900, periodStart: "2026-10-13", confirmedAt: "2026-10-13T10:00:00Z" }
  const rendered: Array<readonly [string, Rendered]> = [
    ["receipt (bank transfer)", renderReceipt(receipt)],
    ["receipt (online)", renderReceipt({ ...receipt, razorpayPaymentId: "pay_Abc123" })],
    ...REMINDER_KINDS.map((kind) => [`reminder ${kind}`, renderReminder({ kind, orgName: "Mehta & Co", daysLeft: 3, dueDate: "2026-11-01", priceLabel: "Rs 9,999", appUrl: "https://dpdp.veridian-aios.com/app/" })] as const),
    ["billing note", renderBillingDue({ orgName: "Mehta & Co", state: "DUE", line: "Payment is due.", role: "owner", payUrl: "https://dpdp.veridian-aios.com/app/", unsubscribeUrl: "https://dpdp.veridian-aios.com/unsubscribe/#t", finalDownload: false, downloadUrl: "https://dpdp.veridian-aios.com/app/" })],
    ["billing note (final download)", renderBillingDue({ orgName: "Mehta & Co", state: "LOCKED", line: "Payment is overdue.", role: "owner", payUrl: "https://dpdp.veridian-aios.com/app/", unsubscribeUrl: "https://dpdp.veridian-aios.com/unsubscribe/#t", finalDownload: true, downloadUrl: "https://dpdp.veridian-aios.com/app/" })],
  ]
  for (const [name, r] of rendered) bodies.push([name, `${r.subject}\n${r.text}\n${r.html}`])

  test("every rendered e-mail was produced (the loop above ran)", () => {
    expect(bodies.length).toBe(2 + REMINDER_KINDS.length + 2)
  })

  for (const [label, re] of BANNED) {
    test(`no receipt or reminder contains ${label}`, () => {
      expect(bodies.filter(([, text]) => re.test(text)).map(([n]) => n)).toEqual([])
    })
  }

  test('no receipt or reminder contains "draft"', () => {
    expect(bodies.filter(([, text]) => /\bdraft/i.test(text)).map(([n]) => n)).toEqual([])
  })

  test("the receipt names the seller", () => {
    expect(renderReceipt(receipt).text).toContain("IT SERVICES BY RAJAT AGARWAL")
  })
})

describe("the product disclosure on /disclaimer/ is kept exactly as it is", () => {
  test("it still says the job library and playbooks have not yet been reviewed or approved by a practising lawyer", () => {
    const html = read("public/disclaimer/index.html")
    expect(html).toContain("<b>They have not yet been reviewed or approved by a practising lawyer</b>")
    expect(html).toContain("The job library and playbooks are general working aids written by the Company, with the help of AI, from public legal texts.")
  })

  test("that sentence is not one of the banned phrases (so the exception is not hiding a banned word)", () => {
    const sentence = "They have not yet been reviewed or approved by a practising lawyer"
    for (const [, re] of BANNED) expect(re.test(sentence)).toBe(false)
  })
})
