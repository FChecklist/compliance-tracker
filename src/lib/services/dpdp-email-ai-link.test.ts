/// <reference types="bun-types" />
// The AI work link inside the Monday email (owner, 2026-09-30: "in email itself give the AI WORK LINK ... user should in most
// cases never open the webpage ... READ / EDIT / WORK", then "THIS HAS TO BE A PROPER PROMPT SO THAT THE EXTERNAL AI DOESN'T HAVE TO
// THINK"). After an independent three-reviewer pass this pins:
//   * the copy: a warning BEFORE the link, a complete prompt with the link as its last line, and only claims the database makes true
//     (an owner can move a due date, a staff member cannot; confirming a draft needs a sign-in, so never "one tap");
//   * the prompt against the link's real API (every path it names exists in api-definition.ts);
//   * the database-facing helpers, with a fake database, including every failure path (ai-link-email.ts);
//   * the contract between the Edge Function, the helpers and migrations 0663/0664.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DO_NOT_FORWARD, PLACEHOLDER, aiChangeSentence, aiLinkWarningSentence, aiPasteText, istYmd, renderDigest, statutorySubset, computeEscalation,
  type AiChange, type Digest, type DigestJob, type RenderLinks,
} from "../../../supabase/functions/dpdp-monday-email/render"
import {
  aiOnlyChanges, finishEmailAiLink, hasPendingAiChanges, loadAiChanges, markChangesShown, mintAiLink, newAiStats, parseAiLinkConfig,
  type AiLinkConfig, type Rpc,
} from "../../../supabase/functions/dpdp-monday-email/ai-link-email"
import * as appLink from "../../../dpdp-app/src/lib/ai-work-link"

const REPO = join(import.meta.dir, "..", "..", "..")
const FN = join(REPO, "supabase", "functions", "dpdp-monday-email")
const TOKEN = "ab".repeat(32) // 64 hex characters, low entropy on purpose (gitleaks)
const URL_ = `https://dpdp.veridian-aios.com/ai/${TOKEN}`
const ORIGIN = "https://dpdp.veridian-aios.com"

function job(o: Partial<DigestJob> & { obligationId: string }): DigestJob {
  const b: DigestJob = {
    obligationId: o.obligationId, key: "firm-04", what: "Write down where customer data is kept", part: 2, dueOn: "2026-09-15",
    daysLate: 0, late: false, requiredToday: false, isGroup: false, groupLabel: null, assigneeEmail: "priya@acmeca.in",
    isMine: true, stuck: false, outsideParty: false,
  }
  const m = { ...b, ...o }
  m.late = m.daysLate > 0
  m.escalation = computeEscalation(m)
  return m
}
function digest(over: Partial<Digest> = {}): Digest {
  return {
    membershipId: "m1", identityId: "i1", orgId: "o1", orgName: "Acme & Co", orgProduct: "firm", email: "priya@acmeca.in", level: "staff", roleKind: "staff",
    weekKey: "2026-W40", today: "2026-09-28", unsubscribed: false, statutoryOnly: false, alreadySentThisWeek: false,
    owners: [{ membershipId: "mo", email: "owner@acmeca.in" }], coordinators: [], jobs: [job({ obligationId: "j1", daysLate: 3 })], escalatedToMe: [], ...over,
  }
}
const base: RenderLinks = {
  signIn: "https://example.invalid/signin", actions: null, unsubscribeUrl: "https://example.invalid/unsub", appHome: "https://dpdp.veridian-aios.com/app/",
}
const withLink = (level: 0 | 1 = 1, extra: Partial<RenderLinks> = {}): RenderLinks => ({
  ...base, aiLink: { url: URL_, expiresOn: "2026-10-05", level, jobs: 31, people: 4 }, ...extra,
})
const owner = (over: Partial<Digest> = {}) => digest({ level: "owner", roleKind: "owner", jobs: [job({ obligationId: "x", isMine: false })], ...over })

describe("the email: warning first, then a short prompt box, and only true claims", () => {
  test("Option 1 leads; a plain 'Before you paste' warning comes BEFORE the box that holds the link", () => {
    const out = renderDigest(digest(), withLink())
    expect(out.text).toContain("Option 1 — Let an AI do it.")
    const iWarn = out.text.indexOf("BEFORE YOU PASTE.")
    const iBox = out.text.indexOf("YOUR AI WORK LINK -- copy the lines between the rules")
    const iUrl = out.text.indexOf(URL_)
    expect(iWarn).toBeGreaterThan(-1)
    expect(iWarn).toBeLessThan(iBox)
    expect(iBox).toBeLessThan(iUrl)
    expect(out.html.indexOf("Before you paste.")).toBeGreaterThan(-1)
    expect(out.html.indexOf("Before you paste.")).toBeLessThan(out.html.indexOf("Your AI Work link — copy and paste this into your AI"))
    expect(out.html).toContain("font-size:13.5px")
    expect(out.html).toContain("user-select:all")
    expect(out.html).not.toContain(`href="${URL_}"`) // no anchor: a scanner or click tracker must not fetch or rewrite it
  })

  test("the warning is the app's WO-013 §1.1 sentence, verbatim, with the real counts, and says until when", () => {
    const out = renderDigest(digest(), withLink(1))
    expect(out.text).toContain(aiLinkWarningSentence(31, 4))
    expect(out.text).toContain("31 jobs and the names and emails of 4 people")
    expect(out.text).toContain("Anyone who holds this link can read all of that and make small changes as you until 5 October 2026.")
    for (const [jobs, people] of [[0, 0], [1, 1], [31, 4], [200, 57]]) {
      expect(aiLinkWarningSentence(jobs, people)).toBe(appLink.aiWorkLinkWarningSentence({ jobs, people }))
    }
  })

  test("the copy is short: one idea per sentence, no tips, no explanations of what the link can do", () => {
    const out = renderDigest(digest(), withLink(1)).text
    expect(out).toContain("Copy the box below into ChatGPT, Claude, Gemini, Grok, DeepSeek, z.ai or any AI chat. It reads what needs doing and helps you do it.")
    expect(out).not.toContain("press and hold")
    expect(out).not.toContain("Tip:")
    expect(out).not.toMatch(/one tap|tap once/i)
    const ai = out.slice(out.indexOf("WAYS TO DO THIS"), out.lastIndexOf("DO NOT FORWARD"))
    expect(ai.split(/\s+/).filter(Boolean).length).toBeLessThan(300)
  })

  test("Option 2 is one line; the link works 48 hours, says whose work, and the button always gives a current one", () => {
    const out = renderDigest(digest(), withLink(1)).text
    expect(out).toContain("Option 2 — Do it right here. Tap the button under a job when it is done.")
    expect(out).toContain("The AI works as priya@acmeca.in, a staff member at Acme & Co. This link works for 48 hours (until 5 October 2026). The button below always gives you a current one.")
  })

  test("level 0 never says the AI makes updates, and does not contradict itself", () => {
    const out = renderDigest(digest(), withLink(0)).text
    expect(out).toContain("It cannot change anything.")
    expect(out).not.toContain("make small changes")
    expect(out).toContain("read all of that until 5 October 2026.")
  })

  test("no link (a failed mint, or switched off): the page wording, no paste box; a caller that predates the field behaves the same", () => {
    for (const links of [{ ...base, aiLink: null }, base]) {
      const out = renderDigest(digest(), links)
      expect(out.text).toContain("Option 1 — Relax, let an AI do it for you. Open your page below, copy your AI work link and paste it into ChatGPT, Claude, Gemini, Grok, DeepSeek, z.ai or any AI chat.")
      expect(out.text).not.toContain("BEFORE YOU PASTE")
      expect(out.html).not.toContain("user-select:all")
    }
  })

  test("a dry run records the placeholder and never a credential", () => {
    const out = renderDigest(digest(), { ...base, signIn: null, aiLink: { url: PLACEHOLDER.aiLink, expiresOn: "2026-10-05", level: 1 } })
    expect(out.text).toContain(PLACEHOLDER.aiLink)
    expect(out.text).not.toMatch(/\/ai\/[0-9a-f]{64}/)
    expect(out.html).not.toMatch(/\/ai\/[0-9a-f]{64}/)
  })

  test("statutory-only: no options, no link, no warning; an owner with no jobs of their own gets 'Two ways'", () => {
    const d = digest({ statutoryOnly: true, jobs: [job({ obligationId: "s", requiredToday: true, daysLate: 2 })] })
    const st = renderDigest(statutorySubset(d), withLink(), "statutory")
    expect(st.text).not.toContain("Option 1")
    expect(st.text).not.toContain(URL_)
    expect(st.text).not.toContain("BEFORE YOU PASTE")
    const own = renderDigest(owner(), withLink()).text
    expect(own).toContain("TWO WAYS TO DO THIS")
    expect(own).toContain("Option 2 — Do it yourself.")
    expect(own).not.toContain("Option 3")
    expect(own).not.toContain("Do it right here")
  })

  test("the URL and the org name are HTML-escaped", () => {
    const out = renderDigest(digest({ orgName: "A<b>&Co" }), { ...base, aiLink: { url: `https://dpdp.veridian-aios.com/ai/${TOKEN}?a=1&b=<x>`, expiresOn: "2026-10-05", level: 1 } })
    expect(out.html).toContain("a=1&amp;b=&lt;x&gt;")
    expect(out.html).not.toContain("<x>")
    expect(out.html).not.toContain("A<b>&Co")
  })
})

describe("2026-10-05: no hyperlink carries the token; the button goes to the signed-in page; red do-not-forward at top and bottom", () => {
  const PAGE = "https://dpdp.veridian-aios.com/app/#ai-link-settings"
  const withPage = (level: 0 | 1 = 1) => ({ ...base, aiLink: { url: URL_, expiresOn: "2026-10-12", level, jobs: 31, people: 4, validHours: 48, aiPageUrl: PAGE } })
  test("a prominent Show my AI work link button to the AI Link page; the token is plain text in the box and in no href", () => {
    const out = renderDigest(digest(), withPage())
    expect(out.html).toContain(`<a href="${PAGE}"`)
    expect(out.html).toContain("Show my AI work link</a>")
    expect(out.text).toContain(`Show my AI work link: ${PAGE}`)
    for (const m of out.html.matchAll(/href="([^"]*)"/g)) expect(m[1], "an href that holds the token").not.toContain(TOKEN)
    expect(out.html).not.toContain("copy/#")
    expect(out.text).not.toContain("COPY IN ONE TAP")
    expect(out.html).toContain(URL_)
  })
  test("DO NOT FORWARD in red at the top and at the bottom, the three steps with the AI names, validity and whose work", () => {
    const out = renderDigest(digest(), withPage())
    const warn = DO_NOT_FORWARD
    expect(out.html.split(warn).length - 1).toBe(2)
    expect(out.html).toContain("color:#B91C1C")
    expect(out.html.indexOf(warn)).toBeLessThan(out.html.indexOf("Three ways to do this"))
    expect(out.html.lastIndexOf(warn)).toBeGreaterThan(out.html.indexOf("Your jobs ("))
    expect(out.text.indexOf(warn.toUpperCase())).toBeLessThan(out.text.indexOf("THREE WAYS TO DO THIS"))
    expect(warn.includes("\n")).toBe(false) // one line
    expect(out.text.lastIndexOf(warn.toUpperCase())).toBeGreaterThan(out.text.indexOf("YOUR JOBS ("))
    expect(out.text).toContain("ChatGPT, Claude, Gemini, Grok, DeepSeek, z.ai")
    expect(out.text).toContain("works for 48 hours")
    expect(out.text).toContain("The AI works as ")
  })
  test("a read-only link, a one-off 24-hour link and a link-less mail", () => {
    expect(renderDigest(digest(), withPage(0)).text).toContain("It cannot change anything")
    const day = renderDigest(digest(), { ...base, aiLink: { url: URL_, expiresOn: "2026-10-06", level: 1, validHours: 24, aiPageUrl: PAGE } }).text
    expect(day).toContain("works for 24 hours")
    const none = renderDigest(digest(), { ...base, aiLink: null })
    expect(none.html).not.toContain(DO_NOT_FORWARD)
  })
  test("a dry run carries the placeholder, never a token", () => {
    const out = renderDigest(digest(), { ...base, aiLink: { url: PLACEHOLDER.aiLink, expiresOn: "2026-10-12", level: 1, validHours: 48, aiPageUrl: PAGE } })
    expect(out.html + out.text).not.toMatch(/[0-9a-f]{64}/)
    expect(out.text).toContain(PLACEHOLDER.aiLink)
  })
})

describe("the paste: two lines, the link last; the instructions live on the page the link opens", () => {
  const p = aiPasteText(URL_)
  const lines = p.split(String.fromCharCode(10))
  test("two lines, the link is the LAST one, and nothing personal is in the paste", () => {
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe(URL_)
    expect(p).not.toContain("Acme")
    expect(p).not.toMatch(/<[a-z]/i)
    expect(p.length).toBeLessThan(640)
  })
  test("it sends the AI to the page and says what to do if it cannot go (pinned exactly: this is the product copy)", () => {
    // The owner's-own-API-documentation framing (a bare "follow this link" was refused as prompt injection about one run in three).
    expect(lines[0]).toBe("I use VERIDIAN, my organisation's DPDP data-protection software, and I want you to help me with my DPDP jobs. A plain GET on my personal access link to its API returns the API guide, documentation for you to read, written by my own organisation's software (it can only do what my own role may, and I confirm anything important myself). Please read the guide first, then help me; if you cannot open links, tell me so and stop. My link:")
    expect(lines[0]).toContain("my personal access link to its API")
    expect(lines[0]).toContain("if you cannot open links, tell me so and stop.")
  })
  test("in the email it sits in the paste box, the sentence and the link on separate lines, the link unbroken-safe", () => {
    const html = renderDigest(digest({ orgName: "Acme & Co" }), withLink(1)).html
    const box = html.slice(html.indexOf("Your AI Work link — copy and paste this into your AI"))
    expect(box).toContain("my personal access link to its API")
    expect(box).toContain(`<br><span style="word-break:break-all;">${URL_}</span>`)
    expect(box).not.toContain("<br><br>")
    expect(box.slice(0, box.indexOf("</div></div>"))).not.toContain("FIRST")
  })
  test("the lead sentence says what the AI does, in two short sentences; the page it opens has the rest", () => {
    const out = renderDigest(digest(), withLink(1)).text
    expect(out).toContain("It reads what needs doing and helps you do it.")
    expect(out).not.toContain("The page it opens tells your AI exactly")
    const ro = renderDigest(digest(), withLink(0)).text
    expect(ro).toContain("It cannot change anything.")
  })
})

describe("what your AI changed for you", () => {
  const changes: AiChange[] = [
    { verb: "NOTE", what: "Give a privacy notice", value: { text: "called the vendor <b>today</b>" }, appliedAt: "2026-09-27T20:30:00Z", undoUrl: null },
    { verb: "SET_DUE", what: "Give a privacy notice", value: { dueOn: "2026-10-10" }, appliedAt: "2026-09-27T20:31:00Z", undoUrl: "https://dpdp.veridian-aios.com/app/#undo=a1.b2" },
    { verb: "ASSIGN", what: "Check your laptop", value: { email: "asha@acmeca.in" }, appliedAt: "2026-09-28T01:00:00Z", undoUrl: null },
    { verb: "MARK_NA", what: "Write a policy", value: { reason: "We hold no such data" }, appliedAt: "2026-09-28T01:05:00Z", undoUrl: null },
  ]
  test("one plain sentence each, the date in India time, an undo link only where one exists, escaped", () => {
    expect(aiChangeSentence(changes[1])).toBe("Moved the due date of “Give a privacy notice” to 2026-10-10")
    expect(aiChangeSentence(changes[3])).toBe("Marked “Write a policy” not applicable: “We hold no such data”")
    const out = renderDigest(digest(), withLink(1, { aiChanges: changes }))
    expect(out.text).toContain("WHAT YOUR AI CHANGED FOR YOU (4)")
    expect(out.text).toContain("If you did not expect them, open your page and revoke your AI links.")
    expect(out.text.match(/Undo:/g)?.length).toBe(1)
    expect(out.text).toContain("Added a note to “Give a privacy notice”: “called the vendor <b>today</b>” — 28 September 2026")
    expect(out.html).toContain("called the vendor &lt;b&gt;today&lt;/b&gt;")
  })
  test("AI-written text cannot close the quote or plant a lookalike link (quotes become apostrophes, URLs are removed)", () => {
    const s = aiChangeSentence({ verb: "NOTE", what: "x", value: { text: 'fine” — 30 September 2026 Undo: https://evil.example/steal “ok' }, appliedAt: "2026-09-28T00:00:00Z", undoUrl: null })
    expect(s).not.toContain("evil.example")
    expect(s).toContain("[link removed]")
    // exactly the two framing curly quotes we add, none from the note
    expect((s.match(/[“”]/g) ?? []).length).toBe(4) // job name pair + note pair
    expect(s.match(/“/g)?.length).toBe(2)
    expect(aiChangeSentence({ verb: "NOTE", what: 'a "b" c', value: { text: 'say "hi"' }, appliedAt: "2026-09-28T00:00:00Z", undoUrl: null })).not.toContain('"')
  })
  test("nothing changed, nothing shown; more than 20 are capped with a count; a long multi-line value becomes one short line", () => {
    expect(renderDigest(digest(), withLink(1, { aiChanges: [] })).text).not.toContain("WHAT YOUR AI CHANGED")
    const many = Array.from({ length: 23 }, (_, i) => ({ ...changes[0], what: `Job ${i}` }))
    const out = renderDigest(digest(), withLink(1, { aiChanges: many }))
    expect(out.text).toContain("...and 3 more in your history.")
    expect(out.text).not.toContain("Job 20")
    const s = aiChangeSentence({ verb: "NOTE", what: "x", value: { text: `line one\nline two ${"z".repeat(400)}` }, appliedAt: "2026-09-28T00:00:00Z", undoUrl: null })
    expect(s).not.toContain("\n")
    expect(s.length).toBeLessThan(200)
  })
  test("it is also reported in the statutory-only view (which gets no link and no options)", () => {
    const d = digest({ statutoryOnly: true, jobs: [job({ obligationId: "s", requiredToday: true })] })
    const out = renderDigest(statutorySubset(d), withLink(1, { aiChanges: changes }), "statutory")
    expect(out.text).toContain("WHAT YOUR AI CHANGED FOR YOU (4)")
    expect(out.text).not.toContain("Option 1")
  })
  test("istYmd is India time", () => {
    expect(istYmd("2026-09-27T20:30:00Z")).toBe("2026-09-28")
    expect(istYmd("2026-10-05T00:30:00Z")).toBe("2026-10-05")
    expect(istYmd("not a date")).toBe("1970-01-01")
  })
})

describe("an email that exists only to tell the person what their AI changed", () => {
  const one: AiChange[] = [{ verb: "NOTE", what: "Name a DPDP coordinator", value: { text: "asked Priya" }, appliedAt: "2026-09-28T01:00:00Z", undoUrl: null }]
  const quiet = digest({ jobs: [], aiChangesOnly: true })
  test("its own subject, heading and first line; no options, no new link, no share asks; the first change is the preview text", () => {
    const out = renderDigest(quiet, { ...base, aiLink: null, aiChanges: one })
    expect(out.subject).toBe("Acme & Co: what your AI changed for you this week")
    expect(out.text).toContain("What your AI changed for you\n")
    expect(out.text).toContain("Nothing needs you at Acme & Co this week. Your AI assistant made some changes for you since your last email")
    expect(out.text).toContain("Added a note to “Name a DPDP coordinator”: “asked Priya”")
    expect(out.text).toContain("If you did not expect them, open your page and revoke your AI links.")
    for (const gone of ["Option 1", "TWO WAYS", "my personal access link to its API", "Nothing for you this week", "DPDP is the law", "Invite them to VERIDIAN", "Share VERIDIAN"]) expect(out.text).not.toContain(gone)
    // the preheader (hidden preview text) is the change, not the subject repeated
    expect(out.html).toContain("Added a note to “Name a DPDP coordinator”")
    expect(out.html.indexOf("display:none;max-height:0")).toBeGreaterThan(-1)
  })
  test("the same person, with jobs, gets the ordinary digest, with the share asks", () => {
    const out = renderDigest(digest({ aiChangesOnly: false }), withLink(1, { aiChanges: one }))
    expect(out.subject).toContain("Your DPDP jobs this week")
    expect(out.text).toContain("Option 1")
    expect(out.text).toContain("Invite them to VERIDIAN")
  })
})

// ---------------------------------------------------------------------------------------------------------------------------
// The database-facing helpers, with a fake database.
// ---------------------------------------------------------------------------------------------------------------------------
type Call = { fn: string; args: Record<string, unknown> }
function fakeDb(answers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>) {
  const calls: Call[] = []
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args })
    const a = answers[fn]
    if (a === undefined) throw new Error(`no fake answer for ${fn}`)
    const v = typeof a === "function" ? (a as (x: Record<string, unknown>) => unknown)(args) : a
    if (v instanceof Error) throw v
    return v
  }
  return { rpc, calls }
}
const ON: AiLinkConfig = { linkEnabled: true, changesEnabled: true, level: 1, days: 2, copyPageUrl: null, warnings: [] }
const minted = { linkId: "L1", token: TOKEN, level: 1, expiresAt: "2026-10-12T00:30:00Z", jobs: 31, people: 4 }

describe("parseAiLinkConfig: a switch on a credential fails CLOSED", () => {
  const cfg = (env: Record<string, string>) => parseAiLinkConfig((k) => env[k] ?? "")
  test("unset means the documented defaults: on, level 0 (read-only, owner 2026-10-06), 2 days (48 hours)", () => {
    expect(cfg({})).toEqual({ linkEnabled: true, changesEnabled: true, level: 0, days: 2, copyPageUrl: null, warnings: [] })
  })
  test("'1' is on and '0' is off, with no warning", () => {
    expect(cfg({ DPDP_EMAIL_AI_LINK_ENABLED: "1", DPDP_EMAIL_AI_CHANGES_ENABLED: "0" })).toMatchObject({ linkEnabled: true, changesEnabled: false, warnings: [] })
  })
  test("anything else is OFF and is reported: 'false', 'off', ' 0', 'no', 'true', 'yes'", () => {
    for (const v of ["false", "off", " 0", "no", "true", "yes", "2"]) {
      const c = cfg({ DPDP_EMAIL_AI_LINK_ENABLED: v, DPDP_EMAIL_AI_CHANGES_ENABLED: v })
      expect(c.linkEnabled).toBe(false)
      expect(c.changesEnabled).toBe(false)
      expect(c.warnings.length).toBe(2)
    }
  })
  test("the level is 1 only when exactly '1'; 'read', 'false', '0 ' and '2' are read-only, never edit rights", () => {
    expect(cfg({ DPDP_EMAIL_AI_LINK_LEVEL: "1" }).level).toBe(1)
    expect(cfg({ DPDP_EMAIL_AI_LINK_LEVEL: "0" })).toMatchObject({ level: 0, warnings: [] })
    for (const v of ["read", "false", "0 ", "2", "yes"]) {
      const c = cfg({ DPDP_EMAIL_AI_LINK_LEVEL: v })
      expect(c.level).toBe(0)
      expect(c.warnings.length).toBe(1)
    }
  })
  test("the Copy page address: an https URL ending in /copy/, else ignored and reported", () => {
    expect(cfg({ DPDP_COPY_PAGE_URL: "https://dpdp.veridian-aios.com/copy/" })).toMatchObject({ copyPageUrl: "https://dpdp.veridian-aios.com/copy/", warnings: [] })
    for (const v of ["http://dpdp.veridian-aios.com/copy/", "https://dpdp.veridian-aios.com/copy", "https://dpdp.veridian-aios.com/copy/?x=1", "https://dpdp.veridian-aios.com/copy/#t", "javascript:alert(1)", "https://evil.example/copy/x"]) {
      expect(cfg({ DPDP_COPY_PAGE_URL: v })).toMatchObject({ copyPageUrl: null, warnings: [expect.stringContaining("DPDP_COPY_PAGE_URL")] })
    }
  })
  test("days is exactly 1, 2, 7 or 30, else 2 (48 hours) with a warning", () => {
    expect(cfg({ DPDP_EMAIL_AI_LINK_DAYS: "1" }).days).toBe(1)
    expect(cfg({ DPDP_EMAIL_AI_LINK_DAYS: "7" }).days).toBe(7)
    expect(cfg({ DPDP_EMAIL_AI_LINK_DAYS: "30" }).days).toBe(30)
    for (const v of ["3", "365", "seven", "07"]) expect(cfg({ DPDP_EMAIL_AI_LINK_DAYS: v })).toMatchObject({ days: 2, warnings: [expect.stringContaining("DPDP_EMAIL_AI_LINK_DAYS")] })
  })
})

describe("mintAiLink: fail-soft, counted, and it returns the link only in the shape the database mints", () => {
  test("success: the URL, the India-time expiry, the level and the counts; it retires nothing", async () => {
    const db = fakeDb({ dpdp_timer_mint_email_ai_link: minted })
    const stats = newAiStats()
    const link = await mintAiLink(db.rpc, ON, ORIGIN, "m1", stats)
    expect(link).toEqual({ linkId: "L1", url: URL_, expiresOn: "2026-10-12", level: 1, jobs: 31, people: 4, copyUrl: null, validHours: 48, aiPageUrl: "https://dpdp.veridian-aios.com/app/#ai-link-settings" })
    expect(db.calls).toEqual([{ fn: "dpdp_timer_mint_email_ai_link", args: { p_membership_id: "m1", p_level: 1, p_days: 2 } }])
    expect(stats).toMatchObject({ minted: 1, mintFailed: 0 })
  })
  test("a configured Copy page is never used: no hyperlink in an e-mail carries the token", async () => {
    const db = fakeDb({ dpdp_timer_mint_email_ai_link: minted })
    const link = await mintAiLink(db.rpc, { ...ON, copyPageUrl: "https://dpdp.veridian-aios.com/copy/" }, ORIGIN, "m1", newAiStats())
    expect(link?.copyUrl).toBeNull()
  })
  test("a one-off mail asks for a 24-hour link, the weekly mail for 48 hours; the persistent link is a different row and untouched", async () => {
    const weekly = fakeDb({ dpdp_timer_mint_email_ai_link: minted })
    const w = await mintAiLink(weekly.rpc, ON, ORIGIN, "m1", newAiStats())
    expect(weekly.calls[0].args.p_days).toBe(2)
    expect(w?.validHours).toBe(48)
    const oneOff = fakeDb({ dpdp_timer_mint_email_ai_link: minted })
    const o = await mintAiLink(oneOff.rpc, ON, ORIGIN, "m1", newAiStats(), () => {}, 1)
    expect(oneOff.calls[0].args.p_days).toBe(1)
    expect(o?.validHours).toBe(24)
    // only the 'Monday email' label is ever retired by the finish step; a link made on the AI Link page has another label
    expect(weekly.calls.every((c) => c.fn === "dpdp_timer_mint_email_ai_link")).toBe(true)
  })
  test("the configured level and days are what is asked for", async () => {
    const db = fakeDb({ dpdp_timer_mint_email_ai_link: { ...minted, level: 0 } })
    const link = await mintAiLink(db.rpc, { ...ON, level: 0, days: 30 }, ORIGIN, "m1", newAiStats())
    expect(db.calls[0].args).toEqual({ p_membership_id: "m1", p_level: 0, p_days: 30 })
    expect(link?.level).toBe(0)
  })
  test("switched off: no call at all", async () => {
    const db = fakeDb({})
    expect(await mintAiLink(db.rpc, { ...ON, linkEnabled: false }, ORIGIN, "m1", newAiStats())).toBeNull()
    expect(db.calls).toEqual([])
  })
  test("a database error, a null answer, a malformed token, a missing expiry or a missing link id: null, counted, warned - never thrown", async () => {
    const bad: unknown[] = [new Error("boom"), null, { ...minted, token: "nothex" }, { ...minted, token: TOKEN + "0" }, { ...minted, expiresAt: undefined }, { ...minted, linkId: undefined }]
    for (const answer of bad) {
      const db = fakeDb({ dpdp_timer_mint_email_ai_link: answer })
      const stats = newAiStats()
      const warns: string[] = []
      expect(await mintAiLink(db.rpc, ON, ORIGIN, "m1", stats, (m) => warns.push(m))).toBeNull()
      expect(stats.mintFailed).toBe(1)
      expect(stats.minted).toBe(0)
      expect(warns.length).toBe(1)
      expect(warns[0]).not.toContain(TOKEN)
    }
  })
})

describe("finishEmailAiLink and markChangesShown", () => {
  test("finish passes the person, the link and whether the email really went; a failure is swallowed", async () => {
    const db = fakeDb({ dpdp_timer_finish_email_ai_link: { ok: true } })
    await finishEmailAiLink(db.rpc, "m1", "L1", true)
    await finishEmailAiLink(db.rpc, "m1", "L2", false)
    expect(db.calls).toEqual([
      { fn: "dpdp_timer_finish_email_ai_link", args: { p_membership_id: "m1", p_link_id: "L1", p_delivered: true } },
      { fn: "dpdp_timer_finish_email_ai_link", args: { p_membership_id: "m1", p_link_id: "L2", p_delivered: false } },
    ])
    const broken = fakeDb({ dpdp_timer_finish_email_ai_link: new Error("down") })
    const warns: string[] = []
    await finishEmailAiLink(broken.rpc, "m1", "L1", true, (m) => warns.push(m))
    expect(warns.length).toBe(1)
  })
  test("mark-shown sends exactly the listed ids, and nothing when none were listed", async () => {
    const db = fakeDb({ dpdp_timer_ai_actions_mark_shown: { ok: true } })
    await markChangesShown(db.rpc, "m1", [])
    expect(db.calls).toEqual([])
    await markChangesShown(db.rpc, "m1", ["a1", "a2"])
    expect(db.calls).toEqual([{ fn: "dpdp_timer_ai_actions_mark_shown", args: { p_membership_id: "m1", p_action_ids: ["a1", "a2"] } }])
    const broken = fakeDb({ dpdp_timer_ai_actions_mark_shown: new Error("down") })
    await markChangesShown(broken.rpc, "m1", ["a1"]) // must not throw
  })
})

describe("loadAiChanges, hasPendingAiChanges, aiOnlyChanges", () => {
  const rows = [
    { actionId: "a1", verb: "NOTE", what: "Job A", value: { text: "hi" }, appliedAt: "2026-09-28T01:00:00Z", stillUndoable: true, undoneAt: null },
    { actionId: "a2", verb: "SET_DUE", what: "Job B", value: { dueOn: "2026-10-10" }, appliedAt: "2026-09-27T01:00:00Z", stillUndoable: false, undoneAt: null },
    { actionId: "a3", verb: "MARK_NA", what: "Job C", value: { reason: "x" }, appliedAt: "2026-09-26T01:00:00Z", stillUndoable: false, undoneAt: "2026-09-26T02:00:00Z" },
  ]
  const answers = { dpdp_timer_ai_actions_for_digest: rows, dpdp_timer_issue_undo_token: { ok: true, undoToken: "cd".repeat(32) } }
  test("undone changes are skipped, ids match the listed changes in order, and only a still-undoable one gets an Undo link", async () => {
    const db = fakeDb(answers)
    const stats = newAiStats()
    const r = await loadAiChanges(db.rpc, ON, ORIGIN, "m1", stats)
    expect(r.failed).toBe(false)
    expect(r.ids).toEqual(["a1", "a2"])
    expect(r.changes.map((c) => c.verb)).toEqual(["NOTE", "SET_DUE"])
    expect(r.changes[0].undoUrl).toBe(`${ORIGIN}/app/#undo=a1.${"cd".repeat(32)}`)
    expect(r.changes[1].undoUrl).toBeNull()
    expect(db.calls.filter((c) => c.fn === "dpdp_timer_issue_undo_token").length).toBe(1)
    expect(db.calls[0].args).toEqual({ p_membership_id: "m1", p_mark: false }) // reading never marks
    expect(stats.changesListed).toBe(2)
  })
  test("a failed undo token still lists the change, just without a link; a malformed token is not used", async () => {
    for (const tokenAnswer of [new Error("x"), { ok: true, undoToken: "short" }, { ok: false }]) {
      const db = fakeDb({ ...answers, dpdp_timer_issue_undo_token: tokenAnswer })
      const r = await loadAiChanges(db.rpc, ON, ORIGIN, "m1", newAiStats())
      expect(r.ids).toEqual(["a1", "a2"])
      expect(r.changes[0].undoUrl).toBeNull()
    }
  })
  test("a lookup failure is reported as failed, not as 'nothing changed'", async () => {
    const db = fakeDb({ dpdp_timer_ai_actions_for_digest: new Error("timeout") })
    const stats = newAiStats()
    const r = await loadAiChanges(db.rpc, ON, ORIGIN, "m1", stats)
    expect(r).toEqual({ changes: [], ids: [], failed: true })
    expect(stats.changesFailed).toBe(1)
  })
  test("switched off: no call", async () => {
    const db = fakeDb({})
    expect(await loadAiChanges(db.rpc, { ...ON, changesEnabled: false }, ORIGIN, "m1", newAiStats())).toEqual({ changes: [], ids: [], failed: false })
    expect(await hasPendingAiChanges(db.rpc, { ...ON, changesEnabled: false }, "m1")).toBe(false)
    expect(db.calls).toEqual([])
  })
  test("hasPending is false for only-undone rows, an empty list, an error", async () => {
    expect(await hasPendingAiChanges(fakeDb({ dpdp_timer_ai_actions_for_digest: [rows[2]] }).rpc, ON, "m1")).toBe(false)
    expect(await hasPendingAiChanges(fakeDb({ dpdp_timer_ai_actions_for_digest: [] }).rpc, ON, "m1")).toBe(false)
    expect(await hasPendingAiChanges(fakeDb({ dpdp_timer_ai_actions_for_digest: new Error("x") }).rpc, ON, "m1")).toBe(false)
    expect(await hasPendingAiChanges(fakeDb(answers).rpc, ON, "m1")).toBe(true)
  })
  test("aiOnlyChanges loads once, and returns null when there is nothing to tell (so an empty email is never sent)", async () => {
    const db = fakeDb(answers)
    const r = await aiOnlyChanges(db.rpc, ON, ORIGIN, "m1", newAiStats())
    expect(r?.ids).toEqual(["a1", "a2"])
    // the pending check and the load are two reads of the same list; no undo token is minted for a person we then skip
    expect(db.calls.filter((c) => c.fn === "dpdp_timer_ai_actions_for_digest").length).toBe(2)
    expect(await aiOnlyChanges(fakeDb({ dpdp_timer_ai_actions_for_digest: [] }).rpc, ON, ORIGIN, "m1", newAiStats())).toBeNull()
    // pending at the check, gone (undone) or unreadable at the load: null, not an email with an empty list
    let n = 0
    const flaky = fakeDb({ dpdp_timer_ai_actions_for_digest: () => (++n === 1 ? [rows[0]] : new Error("timeout")) })
    expect(await aiOnlyChanges(flaky.rpc, ON, ORIGIN, "m1", newAiStats())).toBeNull()
    let m = 0
    const gone = fakeDb({ dpdp_timer_ai_actions_for_digest: () => (++m === 1 ? [rows[0]] : [{ ...rows[0], undoneAt: "2026-09-28T02:00:00Z" }]) })
    expect(await aiOnlyChanges(gone.rpc, ON, ORIGIN, "m1", newAiStats())).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------------------------------------
describe("the Edge Function, the helpers and the migrations agree", () => {
  const index = readFileSync(join(FN, "index.ts"), "utf8")
  const helper = readFileSync(join(FN, "ai-link-email.ts"), "utf8")
  const read = (f: string) => (existsSync(join(REPO, "drizzle", f)) ? readFileSync(join(REPO, "drizzle", f), "utf8") : "")
  const sql3 = read("0663_dpdp_email_ai_work_link.sql")
  const sql4 = read("0664_dpdp_email_ai_link_hardening.sql")

  test("both migrations exist, cite the owner's instruction, and are registered in the journal in order", () => {
    for (const s of [sql3, sql4]) {
      expect(s.startsWith("-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-09-30")).toBe(true)
      expect(s).toContain("READ / EDIT / WORK")
    }
    const journal = JSON.parse(readFileSync(join(REPO, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string; when: number; idx: number }> }
    const i3 = journal.entries.findIndex((e) => e.tag === "0663_dpdp_email_ai_work_link")
    const i4 = journal.entries.findIndex((e) => e.tag === "0664_dpdp_email_ai_link_hardening")
    expect(i3).toBeGreaterThan(0)
    expect(i4).toBe(i3 + 1)
    expect(journal.entries[i3].when).toBeGreaterThan(journal.entries[i3 - 1].when)
    expect(journal.entries[i4].when).toBeGreaterThan(journal.entries[i3].when)
    expect(journal.entries[i4].idx).toBe(journal.entries[i3].idx + 1)
  })
  test("the helpers call the functions by the parameter names 0664 declares (a wrong name is 'function not found')", () => {
    expect(sql4).toContain("p_membership_id text,\n  p_level integer default 1,\n  p_days integer default 7")
    expect(sql4).toContain("p_membership_id text,\n  p_link_id text,\n  p_delivered boolean")
    expect(sql4).toContain("p_membership_id text,\n  p_action_ids text[]")
    expect(helper).toContain('"dpdp_timer_mint_email_ai_link", { p_membership_id: membershipId, p_level: cfg.level, p_days: daysOverride ?? cfg.days }')
    expect(helper).toContain('"dpdp_timer_finish_email_ai_link", { p_membership_id: membershipId, p_link_id: linkId, p_delivered: delivered }')
    expect(helper).toContain('"dpdp_timer_ai_actions_mark_shown", { p_membership_id: membershipId, p_action_ids: ids }')
    expect(helper).toContain('"dpdp_timer_ai_actions_for_digest", { p_membership_id: membershipId, p_mark: false }')
    expect(helper).toContain('"dpdp_timer_issue_undo_token", { p_action_id: r.actionId }')
  })
  test("0664: service_role only; mint retires nothing and writes no event; finish retires by the flag; the emailed link gets two extra limits", () => {
    for (const f of ["dpdp_timer_mint_email_ai_link(text, integer, integer)", "dpdp_timer_finish_email_ai_link(text, text, boolean)", "dpdp_timer_ai_actions_mark_shown(text, text[])"]) {
      expect(sql4).toContain(`revoke all on function public.${f} from public, anon, authenticated;`)
      expect(sql4).toContain(`grant execute on function public.${f} to service_role;`)
    }
    expect(sql4).not.toMatch(/to (anon|authenticated|public)\b/)
    const mint = sql4.slice(sql4.indexOf("create or replace function public.dpdp_timer_mint_email_ai_link"), sql4.indexOf("create or replace function public.dpdp_timer_finish_email_ai_link"))
    expect(mint).not.toContain("revoked_at")
    expect(mint).not.toContain("dpdp__append_event")
    expect(mint).toContain("if v_level not in (0, 1) then")
    expect(mint).toContain("if v_days not in (1, 7, 30) then")
    expect(sql4).toContain("and id <> p_link_id;")
    expect(sql4).toContain("and id = p_link_id;")
    expect(sql4).toContain("if v_l.label = 'Monday email'\n         and ((v_value ->> 'dueOn')::date < (v_now::date - 30) or (v_value ->> 'dueOn')::date > (v_now::date + 400)) then")
    expect(sql4).toContain(`if v_l.label = 'Monday email' and v_row."requiredToday" then`)
    expect(sql4).toContain("create index if not exists dpdp_event_org_occurred_idx on dpdp.event (org_id, occurred_at desc);")
  })
  test("index.ts: the link is made before the send, last week's link is retired only after it, a failed send retires the unsent link, and bookkeeping after an accepted send cannot cause a second email", () => {
    const iMint = index.indexOf("minted = isDigest && !d.aiChangesOnly ? await mintAiLink(")
    const iSend = index.indexOf("const messageId = await sendViaResend(d.to, rendered, out)")
    const iDelivered = index.indexOf("delivered = true")
    const iFinishOk = index.indexOf("await finishEmailAiLink(aiRpc(sb), d.membershipId, minted.linkId, true, aiWarn)")
    const iMarkShown = index.indexOf("await markChangesShown(aiRpc(sb), d.membershipId, shown.ids, aiWarn)")
    const iCatch = index.indexOf("  } catch (e) {\n    const message = e instanceof Error")
    expect(iMint).toBeGreaterThan(-1)
    expect(iMint).toBeLessThan(iSend)
    expect(iSend).toBeLessThan(iDelivered)
    expect(iDelivered).toBeLessThan(iFinishOk)
    expect(iFinishOk).toBeLessThan(iMarkShown)
    expect(iMarkShown).toBeLessThan(iCatch)
    expect(index).toContain("if (minted && !delivered) await finishEmailAiLink(aiRpc(sb), d.membershipId, minted.linkId, false, aiWarn)")
    // the 'sent' bookkeeping is wrapped on its own: the row stays 'queued' (which blocks a second send) instead of turning into 'failed'
    expect(index).toMatch(/try \{\s+await rpc\(sb, "dpdp_timer_mark_email_send_result", \{ p_id: rowId, p_status: "sent"[^}]*\}\)\s+\} catch \(markErr\)/)
  })
  test("index.ts: an AI-changes-only email loads its changes once, has its own period key, is never a dry run, and counts", () => {
    expect(index).toContain("if (!dryRun && isDeliverableAddress(digest.email)) only = await aiOnlyChanges(aiRpc(sb), AI, APP_ORIGIN, digest.membershipId, summary.ai, aiWarn)")
    expect(index).toContain("if (!only) { summary.skipped++;")
    expect(index).toContain("periodKey: aiChangesOnly ? `${digest.weekKey}:ai` : digest.weekKey,")
    expect(index).toContain("aiChanges: only?.changes,")
    expect(index).toContain("if (d.aiChangesOnly) summary.ai.aiOnlySent++")
    expect(index.match(/ai: newAiStats\(\)/g)?.length).toBe(2)
    expect(index).toContain("url: PLACEHOLDER.aiLink")
  })
  test("index.ts reads the switches through the strict parser and logs anything it did not understand", () => {
    expect(index).toContain("const AI = parseAiLinkConfig((k) => env(k).trim())")
    expect(index).toContain("for (const w of AI.warnings) console.warn(")
    expect(index).not.toMatch(/env\("DPDP_EMAIL_AI_LINK_[A-Z]+"\) !== "0"/)
  })
})
