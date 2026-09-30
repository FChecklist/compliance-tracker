/// <reference types="bun-types" />
// The owner's list, 2026-09-30, as a test. Verbatim (only the punctuation is added):
//
//   "USER USE FROM EMAIL - WILL JUST COPY THE AI WORK LINK AND/OR PROMPT, EITHER OF THE ONE AS USER WISHES OR BOTH. WE CANNOT CONTROL USER
//    BEHAVIOUR FULLY, AND USER WILL PASTE THAT IN THE EXTERNAL AI. REST EXTERNAL AI WILL DO. EXTERNAL AI SHOULD BE ABLE TO UNDERSTAND THE
//    WHOLE THING SO THAT EXTERNAL AI DOESN'T HAVE TO DO LOTS OF WORK. IT KNOWS WHAT TO DO - FOR THE EXTERNAL AI: WHY TO DO, HOW TO DO,
//    WHERE TO DO, FOR WHOM TO DO, HOW TO UPDATE, WHAT QUESTIONS THE EXTERNAL AI TO ASK THE USER, WHAT ANSWERS THE EXTERNAL AI TO GIVE TO
//    THE USER, FILE PATH, FILE PATH'S, EMAIL TO SEND, UPDATES TO MAKE, ROLE, RESPONSIBILITIES, LEVEL, COMPLETION, PENDING, DEFAULTERS"
//
// Each item is an assertion on the page the real code builds for a full owner view, so a future edit that drops one fails here, by name.
// The page is built from a realistic view: real library keys, so real playbooks.
import { describe, expect, test } from "bun:test"
import { aiPasteText } from "../../../supabase/functions/_shared/ai-link/prompt"
import { buildManual, renderManualHtml, renderManualMarkdown, type ContextPayload } from "../../../supabase/functions/dpdp-ai-link/manual"
import { PLAYBOOK_DATA } from "../../../supabase/functions/dpdp-ai-link/playbook-data"
import { summariseJobs, type JobRow } from "../../../supabase/functions/dpdp-ai-link/router"

const TOKEN = "cd".repeat(32)
const BASE = `https://app.veridian-aios.com/ai/${TOKEN}`
const NOW = new Date("2026-10-05T01:00:00Z")

const KEYS = ["firm-01", "firm-03", "firm-11", "firm-15", "firm-20", "firm-22", "firm-27", "firm-29"]
const job = (i: number, over: Partial<JobRow> = {}): JobRow => ({
  id: `obl-${i}`, part: [1, 1, 3, 3, 4, 5, 6, 7][i % 8], what: `Job number ${i}`, dataSet: null, dataTypes: null, lawCodes: ["d:§8(9)"], by: i % 3 === 0 ? "ravi@acmeca.in" : i % 3 === 1 ? "meena@acmeca.in" : null,
  byIsYou: false, isGroup: false, groupDone: null, groupTotal: null, due: "2026-10-01", yes: i === 7, na: false, status: "late", daysLate: 4 + i, late: i !== 7, requiredToday: i % 2 === 0,
  dependsOnObligationId: null, templateKey: KEYS[i % 8], ...over,
} as JobRow)
const rows = Array.from({ length: 8 }, (_, i) => job(i))

const ctx = (kind: string, level: 0 | 1): ContextPayload => ({
  org: { id: "o", name: "Acme & Co", product: "firm" },
  viewer: { email: "priya@acmeca.in", kind, level: kind },
  link: { id: "L", label: "Monday email", authorityLevel: level, hideEmails: false, createdAt: "2026-10-05T00:30:00Z", expiresAt: "2026-10-12T00:30:00Z", callCount: 0 },
  library: { version: "0.2-wo010", releasedOn: "2026-09-16", reviewer: null, reviewedOn: null },
  counts: { jobs: rows.length, people: 3 },
  verbs: { level1: ["NOTE", "SET_DUE", "ASSIGN", "MARK_NA"], level2: ["MARK_DONE"] },
})
const page = (kind = "owner", level: 0 | 1 = 1) => renderManualMarkdown(buildManual({ context: ctx(kind, level), base: BASE, now: NOW, summary: summariseJobs(rows) }))

describe("the owner's list: the page an AI reaches from the link tells it everything", () => {
  const md = page()

  test("the user pastes the link, or the prompt, or both: each reaches the same page, and the page needs nothing else to begin", () => {
    // the prompt carries the link as its last line; the link alone is what the page's own lead line is written for
    expect(aiPasteText(BASE).split("\n").pop()).toBe(BASE)
    expect(aiPasteText(BASE)).toContain("follow the instructions on that page exactly")
    expect(md).toContain("**AI assistant: this page is your complete briefing for the person named in the title.")
    expect(md).toContain("If the person pasted only the link and said nothing else, that is enough: begin now, as below.")
    expect(renderManualHtml(buildManual({ context: ctx("owner", 1), base: BASE, now: NOW, summary: summariseJobs(rows) }))).toContain('<p class="lead">')
  })

  test("WHY to do it: each job says why it matters, and the law behind it is fetched, never quoted from memory", () => {
    expect(md).toMatch(/- Why: \S/)
    expect(md).toContain("GET /law/{code}")
    expect(md).toContain("Never quote a section or rule from memory.")
  })

  test("HOW to do it: numbered steps, per job", () => {
    expect(md).toMatch(/- Step 1: \S/)
    expect(md).toMatch(/- Step 3: \S/)
  })

  test("WHERE to do it: the calls, the person's own page, and where proof is kept", () => {
    expect(md).toContain("## W · Where things are")
    expect(md).toContain("| GET /jobs/{id} |")
    expect(md).toContain("THE PERSON'S OWN PAGE is https://app.veridian-aios.com/app/")
    expect(md).toContain("DPDP proof/3 - Tell people & take consent/")
  })

  test("FOR WHOM to do it: the person this link is for, and whose each job is", () => {
    expect(md).toContain("you are working for priya@acmeca.in, the owner at Acme & Co")
    expect(md).toMatch(/JOB obl-\d · .* · for ravi@acmeca\.in/)
    expect(md).toMatch(/- Who: \S/)
  })

  test("HOW to UPDATE, and the UPDATES to make: the verbs with their bodies, the note to record, and the draft to finish", () => {
    for (const v of ["NOTE", "SET_DUE", "ASSIGN", "MARK_NA", "MARK_DONE", "OWNER_CONFIRM"]) expect(md).toContain(v)
    expect(md).toContain("POST /actions with NOTE")
    expect(md).toContain("POST /drafts with MARK_DONE")
    expect(md).toMatch(/- Note to record: \S/)
    expect(md).toContain("record the answers as a NOTE, then prepare MARK_DONE")
    expect(md).toContain("Never say a job is done until they have confirmed it.")
  })

  test("the QUESTIONS the AI asks the user: to open with, and per job", () => {
    expect(md).toContain("QUESTIONS TO OPEN WITH")
    expect(md).toContain("Is there a job you have already finished that is not marked done yet?")
    expect(md).toMatch(/- Ask 1: \S.*\?/)
    expect(md).toMatch(/- Ask 2: \S/)
  })

  test("the ANSWERS the AI gives the user: the first message with the real numbers, and the answers to what people ask", () => {
    expect(md).toContain("WHAT TO SAY FIRST.")
    expect(md).toContain("Hello. I have read your VERIDIAN DPDP page for Acme & Co.")
    expect(md).toContain("ANSWERS YOU CAN GIVE")
    expect(md).toContain("I am not a lawyer and this is not legal advice")
    expect(md).toContain("IF THE PERSON SAYS ... YOU DO ...")
  })

  test("FILE PATH(S): the files to hand over with fixed names, and the folder layout for proof", () => {
    expect(md).toContain("FILES YOU MAY HAND OVER")
    expect(md).toContain("DPDP-status-acme-and-co-2026-10-05.md")
    expect(md).toContain("DPDP-late-jobs-acme-and-co-2026-10-05.csv")
    expect(md).toContain("DPDP-by-person-acme-and-co-2026-10-05.md")
    expect(md).toContain("DPDP proof/1 - Basics/")
    expect(md).toContain("VERIDIAN records the dated answer and a fingerprint of a document, not the document itself")
  })

  test("EMAIL to send: reminders to defaulters, a status note, and an email inside the jobs that need an outside firm - all for the person to send", () => {
    expect(md).toContain("## M · Emails you can draft — the person sends them")
    expect(md).toContain("You cannot send email or messages.")
    expect(md).toContain("To: ravi@acmeca.in")
    expect(md).toContain("To: meena@acmeca.in")
    expect(md).toContain("Subject: DPDP status for Acme & Co as on 5 October 2026")
    expect(md).toContain("Email to send (the person sends it)")
  })

  test("ROLE and RESPONSIBILITIES", () => {
    expect(md).toContain("YOUR ROLE")
    expect(md).toContain("You are answerable for the organisation's DPDP work and the last to sign it off")
    expect(md).toContain("make sure every job has someone looking after it")
  })

  test("LEVEL: which of the two levels this link has, what it may change and what it may not", () => {
    expect(md).toContain("Level 1: this link may read everything in the view")
    expect(page("owner", 0)).toContain("Level 0: this link may read everything in the view and prepare drafts.")
    expect(md).toContain("## C · What you can do")
    expect(md).toContain("## D · What you cannot do")
  })

  test("COMPLETION, PENDING and DEFAULTERS, with numbers", () => {
    expect(md).toMatch(/COMPLETION: 1 of 8 jobs done, 13%\./)
    expect(md).toMatch(/PENDING: 7 open\. 7 late, 0 due today, 0 still on time\./)
    expect(md).toContain("WHO IS BEHIND (people or groups with at least one late job, worst first)")
    expect(md).toMatch(/\| ravi@acmeca\.in \| \d+ \| \d+ \| \d+ \| obl-/)
    expect(md).toContain("REQUIRED BY TODAY'S LAW")
  })

  test("a member who sees only their own jobs gets the same briefing, minus a team they cannot see", () => {
    const staff = page("staff", 1)
    expect(staff).toContain("You answer only your own jobs")
    expect(staff).not.toContain("WHO IS BEHIND")
    expect(staff).not.toContain("REMINDERS TO PEOPLE WITH LATE JOBS")
    // the briefing sections (before the reference) never offer a member the owner's sign-off
    expect(staff.slice(0, staff.indexOf("## A · "))).not.toContain("OWNER_CONFIRM")
    for (const must of ["## S", "## N · ", "## P · ", "## T · ", "## M · ", "## W · "]) expect(staff).toContain(must.replace("## S", "## Start here"))
  })

  test("the briefing holds together: no leftover placeholders in text meant to be handed over, and the size stays sensible", () => {
    const handedOver = md.slice(md.indexOf("## M · "), md.indexOf("## W · "))
    const drafts = [...handedOver.matchAll(/^To: [\s\S]*?(?=\n\n[A-Z]|$)/gm)].map((m) => m[0])
    expect(drafts.length).toBeGreaterThanOrEqual(3)
    for (const d of drafts.filter((x) => x.includes("Subject: DPDP jobs at") || x.includes("Subject: DPDP status"))) expect(d).not.toMatch(/\{[a-z_ ]+\}/)
    expect(md.length).toBeGreaterThan(20_000)
    expect(md.length).toBeLessThan(80_000)
  })

  test("it has real playbooks in it, not only general ones, once the library's words are in", () => {
    expect(Object.keys(PLAYBOOK_DATA).length).toBeGreaterThanOrEqual(59)
    expect(md).not.toContain("general playbook for this part of the list")
  })
})
