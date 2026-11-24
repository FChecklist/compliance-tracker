/// <reference types="bun-types" />
// The firm-first home page (owner order, 24 Nov 2026): the copy module, the committed page and the plain-English rules.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { HOME_COPY, applyHome, renderHome } from "./home-copy.mjs"

const APP = resolve(import.meta.dir, "../..")
const html = readFileSync(join(APP, "index.html"), "utf8")
const main = /<main class="chooser">([\s\S]*?)<\/main>/.exec(html)![1]

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
    expect(HOME_COPY.h1).toBe("DPDP is coming. Penalties are high.")
    expect(HOME_COPY.lead).toBe("It is not an IT job. It is the job of the CA, CS or auditor to remind the client.")
    expect(HOME_COPY.lead2).toBe("The first step is Discover, with a regular independent follow-up every week: what data is there, where it is, and what has been done with it.")
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

  test("every sentence of the copy module is short (30 words or fewer; the owner's own 28-word sentence is the longest)", () => {
    const strings: string[] = []
    const walk = (v: unknown) => { if (typeof v === "string") strings.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk) }
    walk(HOME_COPY)
    for (const str of strings) for (const sentence of str.split(/(?<=[.!?])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(30)
  })

  test("no banned claim word from the claims register in the generated copy", () => {
    for (const w of ["best", "only", "guarantee", "guaranteed", "certified", "leading", "unmatched", "fastest"]) {
      expect(new RegExp(`\\b${w}\\b`, "i").test(ownText(renderHome())), w).toBe(false)
    }
  })

  test("'host' is not used; the word is 'co-organizer'", () => {
    expect(ownText(main)).not.toMatch(/\bhost\b/i)
  })

  test("the organisation door is not on the home page while the switch is off", () => {
    expect(main).not.toContain("dpdp-institution")
    expect(ownText(main)).not.toContain("For organisations")
  })
})
