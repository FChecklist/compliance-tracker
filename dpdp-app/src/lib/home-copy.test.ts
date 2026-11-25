/// <reference types="bun-types" />
// The firm-first home page (owner order, 24 Nov 2026): the copy module, the committed page and the plain-English rules.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { HOME_COPY, applyHome, renderHome } from "./home-copy.mjs"
import { ORG_DIRECT_ENABLED } from "./org-direct.mjs"

const APP = resolve(import.meta.dir, "../..")
const html = readFileSync(join(APP, "index.html"), "utf8")
const mainMatch = /<main class="chooser">([\s\S]*?)<\/main>/.exec(html)
if (!mainMatch || !mainMatch[1].trim()) throw new Error('index.html must contain a non-empty <main class="chooser"> ... </main>: the markers are missing or the body is empty')
const main = mainMatch[1]

// Text a person reads in the home page body, with the generated blocks (their copy is the owner-approved facts file) split off.
const GENERATED = /<!-- BEGIN generated: (?:ai-assistant|facts) -->[\s\S]*?<!-- END generated: (?:ai-assistant|facts) -->/g
const ownText = (s: string) => s.replace(GENERATED, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
// The three owner-approved points come from data/veridian-facts.yaml and say "your" in the owner's own words; they are allow-listed by exact text.
const ALLOWED_TECHNICAL = [
  "People change, but your liability does not. When people leave, what they knew about your data leaves with them.",
]
const words = (s: string) => ALLOWED_TECHNICAL.reduce((t, a) => t.replace(a, " "), s)

describe("the committed home page is generated from the copy module", () => {
  test("index.html equals applyHome(index.html): run `node scripts/generate-home.mjs` after editing src/lib/home-copy.mjs", () => {
    expect(applyHome(html)).toBe(html)
  })

  test("applyHome refuses a page without the markers", () => {
    expect(() => applyHome("<main></main>")).toThrow()
  })
})

describe("the standard sentences", () => {
  test("the owner's central message, word for word", () => {
    expect(HOME_COPY.h1).toBe("DPDP is not an IT problem. It is a data hygiene issue, and it has to be done every week.")
    expect(HOME_COPY.lead).toBe("DPDP is not a one-time job. It has to be done regularly. A firm and its clients need a simple system to Discover, Decide and Do. Data hygiene is not an IT or computer issue. It is regular audit and confirmation. The first step is to set up a process that stands apart from the IT team. VERIDIAN DPDP is that separate, third-party process.")
    expect(HOME_COPY.lead2).toBe("For a CA, CS, auditor or law firm, this is a real service line. The work comes back every week, so it is regular, billable work. The client keeps coming back. VERIDIAN does the heavy part: Discover, Decide, Do, with a dated record.")
    for (const s of [HOME_COPY.h1, HOME_COPY.lead, HOME_COPY.lead2]) expect(ownText(main)).toContain(s)
  })

  test("Discover, Decide, Do with their one-line meanings, in this order", () => {
    expect(HOME_COPY.words).toEqual([
      { word: "Discover", meaning: "What data there is, where it is, and with whom." },
      { word: "Decide", meaning: "What to do, when to do it, and who will do it." },
      { word: "Do", meaning: "Confirm that it is done." },
    ])
    const list = /<ol class="hm-words">([\s\S]*?)<\/ol>/.exec(main)![1]
    const items = [...list.matchAll(/<b>([^<]*)<\/b><span>([^<]*)<\/span>/g)].map((m) => ({ word: m[1], meaning: m[2] }))
    expect(items).toEqual(HOME_COPY.words)
  })

  test("the weekly-not-one-time message and the Accountant Partner line", () => {
    expect(ownText(main)).toContain("It is not a one-time job. It is weekly work.")
    expect(ownText(main)).toContain("Accountant Partners remind clients and follow up every week. A professional confirms every sign-off and every legal point.")
  })

  test("how it works in 3 steps, numbered 1 to 3 by an ordered list", () => {
    const list = /<ol class="hm-arrows">([\s\S]*?)<\/ol>/.exec(main)![1]
    expect([...list.matchAll(/<li>/g)]).toHaveLength(3)
    expect(ownText(main)).toContain("How it works in 3 steps")
  })

  test("one clear button, Become a Partner, to /partner/; and a plain notice line with the Terms link", () => {
    expect(main).toContain('<a class="btn hm-cta-btn" href="/partner/">Become a Partner</a>')
    expect(main).toContain('<p class="hm-notice">By continuing you accept the <a href="/terms/">Terms of Service</a>.</p>')
  })
})

describe("plain-English rules", () => {
  test("no 'my' or 'your' anywhere in the page body outside the allow-listed owner-approved fact text and the generated blocks", () => {
    const t = words(ownText(main))
    expect(t.match(/\b(my|your|yours)\b/gi) ?? []).toEqual([])
  })

  // The WHOLE page: header, nav, chat, footer, generated blocks. Only visible text counts (no tags, attributes, scripts, styles or comments).
  // Allow-listed by exact text: the owner-approved lines that come from data/veridian-facts.yaml and data/claims-register.yaml, not from this page.
  const WHOLE_PAGE_ALLOWED = [
    ...ALLOWED_TECHNICAL,
    "Your free DPDP AI assistant",
    "Open your personal link in your own AI. It reads your controls and drafts the updates. You confirm them.",
    "Get your free AI assistant",
    "It is not a law firm, does not certify (no DPDP certification exists in India), does not guarantee compliance, and does not keep your compliance documents (it keeps a fingerprint of each; payment proofs you upload are the one exception).",
    "Copy this link and paste in your AI to work.",
  ]
  const visibleText = (s: string) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ")
  const wholePageHits = (s: string) => WHOLE_PAGE_ALLOWED.reduce((t, a) => t.split(a).join(" "), visibleText(s)).match(/\b(my|mine|your|yours)\b/gi) ?? []

  test("no my, mine, your or yours anywhere in the visible text of the whole index.html (only the owner-approved facts lines are allowed)", () => {
    expect(wholePageHits(html)).toEqual([])
  })

  test("the whole-page rule is real: a planted word in the header, the footer or an attribute-free line is found, a tag attribute is not", () => {
    expect(wholePageHits("<header>Sign in to mine</header>")).toEqual(["mine"])
    expect(wholePageHits("<footer>Contact yours truly</footer>")).toEqual(["yours"])
    expect(wholePageHits('<a title="your" href="/x">Go</a>')).toEqual([])
  })

  test("the rule is real: a planted 'your' is found", () => {
    expect(words("Open your account").match(/\b(my|your|yours)\b/gi)).toEqual(["your"])
  })

  test("no tick box, no form control at all, in the generated copy or the page body", () => {
    expect(renderHome()).not.toMatch(/<input|type="checkbox"|role="checkbox"|<form|<select|<textarea/i)
    expect(main).not.toMatch(/type="checkbox"|role="checkbox"/i)
  })

  test("no penalty amount, section number or deadline is printed: the penalty claim is 'Penalties are high.' and nothing more", () => {
    const own = ownText(renderHome())
    expect(own).not.toMatch(/₹|\bRs\.?\s?\d|crore|\blakh\b|\bsection\s+\d|\b\d+\s*%/i)
    expect(own).not.toMatch(/deadline|within \d+ (days|hours)/i)
  })

  test("every sentence of the copy module is short (22 words or fewer)", () => {
    const strings: string[] = []
    const walk = (v: unknown) => { if (typeof v === "string") strings.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk) }
    walk(HOME_COPY)
    for (const str of strings) for (const sentence of str.split(/(?<=[.!?])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(22)
  })

  test("no banned claim word from the claims register in the generated copy", () => {
    for (const w of ["best", "only", "guarantee", "guaranteed", "certified", "leading", "unmatched", "fastest"]) {
      expect(new RegExp(`\\b${w}\\b`, "i").test(ownText(renderHome())), w).toBe(false)
    }
  })

  test("'host' is not used; the word is 'co-organizer'", () => {
    expect(ownText(main)).not.toMatch(/\bhost\b/i)
  })

  test("the removed commission promise is gone: no Moneypenny credits or weekly plan on the page or in the copy", () => {
    expect(JSON.stringify(HOME_COPY)).not.toMatch(/moneypenny|commission|weekly plan/i)
    expect(html).not.toMatch(/Moneypenny credits|weekly plan/i)
  })

  test("renderHome prints the organisation door only when the switch is passed in as true; applyHome follows it too", () => {
    const door = '<a class="choice" href="/dpdp-institution/"><span>For organisations</span> <strong>Company · School · NGO</strong> <i>Doing it for ourselves →</i></a>'
    expect(renderHome(HOME_COPY, true)).toContain(door)
    expect(renderHome(HOME_COPY, false)).not.toContain("dpdp-institution")
    expect(renderHome(HOME_COPY, false)).not.toContain("For organisations")
    expect(renderHome()).toBe(renderHome(HOME_COPY, ORG_DIRECT_ENABLED))
    expect(applyHome(html, HOME_COPY, true)).toContain(door)
    expect(applyHome(html, HOME_COPY, ORG_DIRECT_ENABLED)).toBe(html)
  })

  test("the organisation door is not on the home page while the switch is off", () => {
    expect(main).not.toContain("dpdp-institution")
    expect(ownText(main)).not.toContain("For organisations")
  })
})

describe("no exact date in the home copy", () => {
  const DATE = /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i
  const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [])
  test("the guard catches planted dates", () => {
    expect(DATE.test("until 13 May 2027")).toBe(true)
    expect(DATE.test("until 13/05/2027")).toBe(true)
    expect(DATE.test("until May 2027")).toBe(false)
  })
  test("HOME_COPY has no day-level date, and the strip prints no legal date at all", () => {
    for (const s of strings(HOME_COPY)) expect(DATE.test(s), s).toBe(false)
    expect(strings(HOME_COPY).join(" ")).not.toContain("SPDI Rules 2011 apply until")
    expect(ownText(main)).not.toContain("apply until")
  })
})
