/// <reference types="bun-types" />
// DPDP single mailbox -- CI coverage for the code that lives OUTSIDE src/.
//
// THE GAP THIS CLOSES. bunfig.toml sets the test root to src/, so the bare
// `bun test --isolate` that .github/workflows/ci.yml runs never discovers a
// *.test.ts under supabase/functions/. The three that guard the mailbox's
// contract (the taxonomy, the classifier, the request handler) therefore ran
// only when someone typed their path -- and a red one blocked nothing. This
// file makes them part of the bare run.
//
// HOW. The three `import "...test"` lines below load those files as modules.
// Each of them calls describe()/test() while it loads, and bun registers those
// calls in the file that is currently loading, which is THIS one -- so under
// `bun test --isolate src/lib/services/dpdp-mail-edge-functions.test.ts` the
// report lists every one of their tests as part of this file (35 taxonomy +
// 395 classifier + 92 handler = 522 at the time of writing, plus the 26 tests
// written below = 548; the numbers move as those files grow). A plain static
// import is enough; nothing needs to be called from inside a test case, and
// --isolate does not change that. Precedent for edge-function code tested from
// src/: dpdp-timer-render.test.ts. (The test files use only bun:test and
// relative imports of pure modules: no Deno global, no network.)
//
// A GUARD, so this cannot rot quietly: the first describe below scans
// supabase/functions for mail-related test files and fails if one exists that
// is not imported here. A new test file next to the classifier would otherwise
// be silently outside CI again, which is the bug this file exists to fix.
//
// THE REST OF THE FILE tests the CALLERS of that contract, which are the
// places a change in the taxonomy or the classifier would otherwise break
// without anyone noticing:
//   * the billing widget's payment-proof mail, run through the REAL classifier;
//   * scripts/dpdp-inbox-placement.ts, whose test mail must match the real
//     Monday send (mail-outbound.ts) and which must send nothing when imported;
//   * the Email Worker's recipient rules and its read-cap default (the Worker
//     package's own tests need postal-mime and run only from its directory,
//     so this is the part of it that CI can see);
//   * the operator's Gmail filter file, against the taxonomy's classes;
//   * dpdp-app/OPERATIONS.md's class table, against the taxonomy and the
//     migration's ticket letters;
//   * that no stale sending address is left in the docs and the spec.
import { describe, expect, spyOn, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

// --- the three test files, registered here (see the header) -------------------------------------------------
import "../../../supabase/functions/_shared/mail-taxonomy.test"
import "../../../supabase/functions/dpdp-inbound-mail/classify.test"
import "../../../supabase/functions/dpdp-inbound-mail/handler.test"

import { classify } from "../../../supabase/functions/dpdp-inbound-mail/classify"
import { DEFAULT_LEGAL_RESPONSE_DAYS } from "../../../supabase/functions/dpdp-inbound-mail/handler"
import { listUnsubscribeHeaders, renderDigest, unsubscribeMailto } from "../../../supabase/functions/dpdp-monday-email/render"
import { DEFAULT_FROM, buildOutbound, resendPayload } from "../../../supabase/functions/_shared/mail-outbound"
import {
  CLASS_LABEL, CLASS_TAG, LEGAL_CLOCK_CLASSES, MAILBOX, MAIL_CLASSES, NOTIFY_CLASSES, notificationSubject, parseRecipient,
  type MailClass,
} from "../../../supabase/functions/_shared/mail-taxonomy"
import { FORWARD_ONLY_ROLES, resolveRecipient } from "../../../workers/dpdp-inbound-mail/src/recipient"
import { PAY_EMAIL, paymentProofMailto } from "../../../dpdp-app/src/lib/payment-proof-mail"

const REPO = join(import.meta.dir, "..", "..", "..")
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8")

// ------------------------------------------------------------------------------------------------------------
describe("the mail edge-function tests are part of the bare CI run", () => {
  /** supabase/functions test files that belong to the mailbox. Other functions' tests (if any) are not this file's business. */
  function mailTestFiles(): string[] {
    const out: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules") continue
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name.endsWith(".test.ts")) out.push(relative(REPO, full).split(sep).join("/"))
      }
    }
    walk(join(REPO, "supabase", "functions"))
    return out.filter((f) => /^supabase\/functions\/(_shared\/mail-[^/]+|dpdp-inbound-mail\/[^/]+|dpdp-monday-email\/[^/]+|dpdp-invoice-email\/[^/]+)\.test\.ts$/.test(f)).sort()
  }

  function importedTestFiles(): string[] {
    const src = readFileSync(import.meta.path, "utf8")
    return [...src.matchAll(/^import "\.\.\/\.\.\/\.\.\/(supabase\/functions\/[^"]+)\.test"$/gm)].map((m) => `${m[1]}.test.ts`).sort()
  }

  test("every mail-related test file under supabase/functions is imported by this file", () => {
    const onDisk = mailTestFiles()
    expect(onDisk.length).toBeGreaterThanOrEqual(3)
    expect(importedTestFiles()).toEqual(onDisk)
  })

  test("each imported file exists (a typo in an import path would fail loudly, this names the file)", () => {
    for (const f of importedTestFiles()) expect(existsSync(join(REPO, f)), f).toBe(true)
  })
})

// ------------------------------------------------------------------------------------------------------------
describe("billing widget: the payment-proof mail is filed as an invoice by the real classifier", () => {
  const ORG = "0123456789abcdef0123456789abcdef"

  function decoded(over: Partial<Parameters<typeof paymentProofMailto>[0]> = {}) {
    const url = paymentProofMailto({ orgId: ORG, amountLabel: "Rs 9,999", interval: "year", reference: "", ...over })
    const m = /^mailto:([^?]+)\?subject=([^&]*)&body=(.*)$/s.exec(url)!
    return { to: decodeURIComponent(m[1]), subject: decodeURIComponent(m[2]), body: decodeURIComponent(m[3]) }
  }
  const asInbound = (subject: string, text: string) =>
    classify({ recipients: [MAILBOX], senders: ["customer@example.org"], subject, text, headers: {} })

  test("it is addressed to the one public mailbox the taxonomy names", () => {
    expect(PAY_EMAIL).toBe(MAILBOX)
    expect(decoded().to).toBe(MAILBOX)
    expect(decoded().subject.startsWith("Invoice payment proof")).toBe(true)
  })

  test.each([
    ["yearly, no reference", { interval: "year" as const, reference: "" }],
    ["monthly, with a UTR", { interval: "month" as const, reference: "412345678901" }],
    ["a UTR with a sentence around it", { interval: "year" as const, reference: "paid via UPI on 29 Sep, UTR 412345678901" }],
  ])("%s: classified `invoice` by keyword, never `review` or `auto`", (_name, over) => {
    const { subject, body } = decoded(over)
    const c = asInbound(subject, body)
    expect(c.cls).toBe("invoice")
    expect(c.rule).toBe("keyword")
  })

  test("the subject alone is enough (the body is a bonus, not what makes it an invoice)", () => {
    expect(asInbound(decoded().subject, "").cls).toBe("invoice")
  })
})

// ------------------------------------------------------------------------------------------------------------
describe("scripts/dpdp-inbox-placement.ts: the test mail is the real Monday mail, and importing it sends nothing", () => {
  const REF = "k3f9x2ab7q"
  const STAMP = "10:30"
  const TO = "owner@example.org"

  // The first test in this describe is the first import of the module anywhere in this file, so any top-level
  // effect it has (reading argv, exiting, calling fetch) happens while the spies are installed.
  test("importing the module reads no argument, exits nothing and makes no request", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => {
      throw new Error("the placement script called fetch on import")
    }) as unknown as typeof fetch)
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("the placement script called process.exit on import")
    }) as never)
    try {
      const mod = await import("../../../scripts/dpdp-inbox-placement")
      expect(typeof mod.buildPlacementPayload).toBe("function")
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      exitSpy.mockRestore()
    }
  })

  test("the visible sender is the single public identity, equal to the one the real sends default to", async () => {
    const { PLACEMENT_FROM } = await import("../../../scripts/dpdp-inbox-placement")
    expect(PLACEMENT_FROM).toBe("VERIDIAN AI DPDP <dpdp@veridian-aios.com>")
    expect(PLACEMENT_FROM).toBe(DEFAULT_FROM)
  })

  test("From, Reply-To, subject prefix and X-Veridian-* headers are the tagged Monday envelope", async () => {
    const m = await import("../../../scripts/dpdp-inbox-placement")
    const variants = m.makeVariants(renderDigest(m.sampleDigest(TO, "2026-09-29"), m.SAMPLE_LINKS))
    const p = m.buildPlacementPayload({ to: TO, tag: "A", stamp: STAMP, ref: REF, rendered: variants.A }) as {
      from: string; to: string[]; reply_to: string; subject: string; headers: Record<string, string>
    }
    expect(p.from).toBe("VERIDIAN AI DPDP <dpdp@veridian-aios.com>")
    expect(p.to).toEqual([TO])
    expect(p.reply_to).toBe(`dpdp+mon.${REF}@veridian-aios.com`)
    expect(parseRecipient(p.reply_to)).toEqual({ ours: true, cls: "monday", ref: REF })
    expect(p.subject.startsWith("[VERIDIAN DPDP · Monday] [placement A 10:30] ")).toBe(true)
    expect(p.headers["X-Veridian-Class"]).toBe("monday")
    expect(p.headers["X-Veridian-Ref"]).toBe(REF)
    expect(p.headers["List-Unsubscribe"]).toContain(`<mailto:dpdp+dsr.${REF}@veridian-aios.com?subject=unsubscribe>`)
    expect(p.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
  })

  test("the payload equals what mail-outbound.ts builds for the real send (a change there fails this until the script follows)", async () => {
    const m = await import("../../../scripts/dpdp-inbox-placement")
    const variants = m.makeVariants(renderDigest(m.sampleDigest(TO, "2026-09-29"), m.SAMPLE_LINKS))
    for (const tag of ["A", "B", "C"] as const) {
      const real = buildOutbound("monday", `[placement ${tag} ${STAMP}] ${variants[tag].subject}`, {
        from: m.PLACEMENT_FROM,
        ref: REF,
        headers: listUnsubscribeHeaders(m.PLACEMENT_UNSUBSCRIBE_URL, unsubscribeMailto(REF)),
      })
      const mine = m.buildPlacementPayload({ to: TO, tag, stamp: STAMP, ref: REF, rendered: variants[tag] })
      expect(mine, `variant ${tag}`).toEqual(resendPayload(TO, real, variants[tag]))
    }
  })

  test("the three variants really differ (the experiment is not three copies of one mail)", async () => {
    const m = await import("../../../scripts/dpdp-inbox-placement")
    const v = m.makeVariants(renderDigest(m.sampleDigest(TO, "2026-09-29"), m.SAMPLE_LINKS))
    expect(v.A.html).not.toBe(v.B.html)
    expect(v.B.html).not.toBe(v.C.html)
  })

  test("the old sending subdomain is gone from the script", () => {
    expect(read("scripts/dpdp-inbox-placement.ts")).not.toContain("send.veridian-aios.com")
  })
})

// ------------------------------------------------------------------------------------------------------------
describe("Email Worker: the parts of it CI can see (its own suite needs postal-mime and runs from its directory)", () => {
  test("postmaster@ and abuse@ are accepted and forwarded, not ticketed; lookalikes are refused", () => {
    expect([...FORWARD_ONLY_ROLES].sort()).toEqual(["abuse", "postmaster"])
    for (const local of ["postmaster", "abuse", "Postmaster", "ABUSE"]) {
      expect(resolveRecipient(`${local}@veridian-aios.com`)).toMatchObject({ accepted: true, route: "forward_only" })
    }
    for (const bad of ["postmaster+x@veridian-aios.com", "abuse@send.veridian-aios.com", "postmaster@evil.example", "abuses@veridian-aios.com"]) {
      expect(resolveRecipient(bad), bad).toEqual({ accepted: false })
    }
  })

  test("the published address, its tags and the two legacy aliases still go to the ticketing path", () => {
    expect(resolveRecipient(MAILBOX)).toMatchObject({ accepted: true, route: "ticket", legacyAlias: null })
    expect(resolveRecipient(`dpdp+${CLASS_TAG.grievance}.k3f9x2ab7q@veridian-aios.com`)).toMatchObject({ accepted: true, route: "ticket" })
    expect(resolveRecipient("grievance@veridian-aios.com")).toMatchObject({ route: "ticket", address: `dpdp+${CLASS_TAG.grievance}@veridian-aios.com` })
    expect(resolveRecipient("partners@veridian-aios.com")).toMatchObject({ route: "ticket", address: `dpdp+${CLASS_TAG.partner}@veridian-aios.com` })
    expect(resolveRecipient("sales@veridian-aios.com")).toEqual({ accepted: false })
  })

  test("the read cap is 131072 bytes in the code default and in wrangler.toml", () => {
    const code = read("workers/dpdp-inbound-mail/src/handler.ts")
    expect(/export const DEFAULT_MAX_RAW_BYTES = 128 \* 1024\b/.test(code)).toBe(true)
    const toml = read("workers/dpdp-inbound-mail/wrangler.toml")
    const line = toml.split(/\r?\n/).find((l) => /^\s*MAX_RAW_BYTES\s*=/.test(l))
    expect(line).toBeDefined()
    expect(/"(\d+)"/.exec(line!)?.[1]).toBe("131072")
  })
})

// ------------------------------------------------------------------------------------------------------------
describe("operator Gmail filters (workers/dpdp-inbound-mail/gmail-filters.xml) match the taxonomy", () => {
  const xml = read("workers/dpdp-inbound-mail/gmail-filters.xml")

  /** A small strict well-formedness check (this repo has no XML parser as a direct dependency). */
  function assertWellFormed(doc: string): void {
    let s = doc.replace(/^\s*<\?xml[^>]*\?>/, "")
    for (const c of s.match(/<!--[\s\S]*?-->/g) ?? []) expect(c.slice(4, -3), "an XML comment may not contain two hyphens").not.toContain("--")
    s = s.replace(/<!--[\s\S]*?-->/g, "")
    expect(s).not.toContain("<!--")
    const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:'[^'<]*'|"[^"<]*"))*)\s*(\/?)>/g
    const stack: string[] = []
    let last = 0
    let roots = 0
    for (const m of s.matchAll(tag)) {
      const between = s.slice(last, m.index)
      expect(between, `stray markup between tags near offset ${m.index}`).not.toMatch(/[<>]/)
      expect(between.replace(/&(amp|lt|gt|quot|apos);/g, ""), `bare ampersand near offset ${m.index}`).not.toContain("&")
      last = m.index! + m[0].length
      const [, closing, name, , selfClosing] = m
      if (closing) {
        expect(stack.pop(), `closing </${name}> does not match`).toBe(name)
      } else if (!selfClosing) {
        if (stack.length === 0) roots++
        stack.push(name)
      } else if (stack.length === 0) {
        roots++
      }
    }
    expect(s.slice(last).trim(), "text after the last tag").toBe("")
    expect(stack, "unclosed tags").toEqual([])
    expect(roots, "exactly one root element").toBe(1)
  }

  type Filter = { props: Record<string, string> }
  function filters(): Filter[] {
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((e) => {
      const props: Record<string, string> = {}
      for (const p of e[1].matchAll(/<apps:property name='([^']+)' value='([^']*)'\/>/g)) props[p[1]] = p[2]
      return { props }
    })
  }

  // The label a class gets. A class added to the taxonomy without a line here fails the first test below.
  const GMAIL_LABEL: Record<Exclude<MailClass, "auto">, string> = {
    grievance: "DPDP/Grievance", data_request: "DPDP/Data request", review: "DPDP/Review", clock: "DPDP/Statutory",
    monday: "DPDP/Monday replies", sales: "DPDP/Sales", sales_chain: "DPDP/Sales thread", invoice: "DPDP/Invoice",
    partner: "DPDP/Partner", support: "DPDP/Support",
  }
  const subjectWord = (f: Filter) => (f.props.subject ?? "").replace(/^"|"$/g, "")
  const filterFor = (cls: MailClass) => filters().find((f) => subjectWord(f) === CLASS_LABEL[cls] && f.props.label === (GMAIL_LABEL as Record<string, string>)[cls])

  test("the file is well-formed XML", () => {
    assertWellFormed(xml)
    expect(filters().length).toBeGreaterThanOrEqual(NOTIFY_CLASSES.length)
  })

  test("every class the operator is emailed about has a filter with its label, and `auto` (log only) has none", () => {
    for (const cls of NOTIFY_CLASSES) {
      expect(cls in GMAIL_LABEL, `class ${cls} has no Gmail label in this test: add it here AND to gmail-filters.xml`).toBe(true)
      expect(filterFor(cls), `no filter labels class ${cls} as ${(GMAIL_LABEL as Record<string, string>)[cls]}`).toBeDefined()
    }
    expect(filters().some((f) => subjectWord(f) === CLASS_LABEL.auto)).toBe(false)
  })

  test("the subject word is what the real notice subject starts with", () => {
    for (const cls of NOTIFY_CLASSES) {
      expect(notificationSubject(cls, "X-2026-0001", "hello").startsWith(`[${subjectWord(filterFor(cls)!)} `), `class ${cls}`).toBe(true)
    }
  })

  test("every filter requires the mailbox as sender and never sends the notice to Spam", () => {
    for (const f of filters()) {
      expect(f.props.from).toBe(MAILBOX)
      expect(f.props.shouldNeverSpam).toBe("true")
    }
  })

  test("the legal-clock classes are starred and marked Important", () => {
    for (const cls of LEGAL_CLOCK_CLASSES) {
      const f = filterFor(cls)!
      expect(f.props.shouldStar, cls).toBe("true")
      expect(f.props.shouldAlwaysMarkAsImportant, cls).toBe("true")
    }
    // the classifier-failure notice is filed as review, so it is treated as review
    const failed = filters().find((f) => subjectWord(f) === "CLASSIFIER FAILED")
    expect(failed?.props.label).toBe("DPDP/Review")
    expect(failed?.props.shouldStar).toBe("true")
  })

  test("nothing is ever archived, muted, deleted, marked read or forwarded: only these properties may appear", () => {
    const ALLOWED = new Set(["from", "subject", "doesNotHaveTheWord", "label", "shouldStar", "shouldAlwaysMarkAsImportant", "shouldNeverSpam"])
    for (const f of filters()) for (const name of Object.keys(f.props)) expect(ALLOWED.has(name), `property ${name}`).toBe(true)
    for (const banned of ["shouldArchive", "shouldMarkAsRead", "shouldTrash", "forwardTo", "shouldNeverMarkAsImportant"]) {
      expect(xml, banned).not.toMatch(new RegExp(`name='${banned}'`))
    }
  })
})

// ------------------------------------------------------------------------------------------------------------
describe("dpdp-app/OPERATIONS.md: the class table and the sending identity agree with the code", () => {
  const ops = read("dpdp-app/OPERATIONS.md")
  const sql = read("drizzle/0662_dpdp_single_mailbox_mail_log.sql")

  const ticketLetters = (() => {
    const start = sql.indexOf("function dpdp.mail_next_ticket")
    const body = sql.slice(start, sql.indexOf("end;", start))
    return Object.fromEntries([...body.matchAll(/when '([a-z_]+)' then '([A-Z])'/g)].map((m) => [m[1], m[2]]))
  })()

  const table = (() => {
    const rows = new Map<string, string[]>()
    for (const line of ops.split("\n")) {
      const m = /^\|\s*`([a-z_]+)`\s*\|(.*)\|\s*$/.exec(line)
      if (m) rows.set(m[1], m[2].split("|").map((c) => c.trim()))
    }
    return rows
  })()

  test("the migration gives every class a ticket letter", () => {
    for (const cls of MAIL_CLASSES) expect(ticketLetters[cls], `no ticket letter for ${cls} in drizzle/0662`).toMatch(/^[A-Z]$/)
  })

  test("the class table has one row per class with the real tag, label and ticket letter", () => {
    expect([...table.keys()].sort()).toEqual([...MAIL_CLASSES].sort())
    for (const cls of MAIL_CLASSES) {
      const [tag, label, letter, clock, told] = table.get(cls)!
      expect(tag, `${cls} tag`).toBe(`\`${CLASS_TAG[cls]}\``)
      expect(label, `${cls} label`).toBe(CLASS_LABEL[cls])
      expect(letter, `${cls} ticket letter`).toBe(ticketLetters[cls])
      expect(/^\*{0,2}yes/.test(clock), `${cls} legal clock column`).toBe(LEGAL_CLOCK_CLASSES.includes(cls))
      expect(/^\*{0,2}yes/.test(told), `${cls} operator-told column`).toBe(NOTIFY_CLASSES.includes(cls))
    }
  })

  test("the documented legal-response default is the handler's default, and is called the owner's and counsel's number", () => {
    expect(ops).toContain(`defaults to ${DEFAULT_LEGAL_RESPONSE_DAYS}`)
    expect(ops).toMatch(/owner's and counsel's to confirm/)
  })

  test("the sending identity is dpdp@veridian-aios.com everywhere; send.veridian-aios.com survives only as a historical note", () => {
    expect(ops).toContain("Resend sending domain `veridian-aios.com`")
    expect(ops).toMatch(/Historical note:[^\n]*send\.veridian-aios\.com/)
    for (const rel of ["dpdp-app/OPERATIONS.md", "dpdp-app/data/veridian-facts.yaml", "dpdp-app/spec/veridian-dpdp.html"]) {
      expect(read(rel), `${rel} still shows the old From address`).not.toContain("dpdp@send.veridian-aios.com")
    }
    const facts = read("dpdp-app/data/veridian-facts.yaml")
    expect(facts).toMatch(/source: Resend, sending identity dpdp@veridian-aios\.com/)
    expect(read("dpdp-app/spec/veridian-dpdp.html")).toContain("dpdp@veridian-aios.com&gt;")
  })
})
