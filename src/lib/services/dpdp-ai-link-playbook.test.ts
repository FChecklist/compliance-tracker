/// <reference types="bun-types" />
// The job playbook (supabase/functions/dpdp-ai-link/playbook.ts + playbook-data.ts): what an AI helping a busy non-lawyer reads for each of the
// library's 59 jobs. Pinned here:
//   * every library job has an entry, and no entry belongs to a job that does not exist;
//   * the shape is complete and lean (an AI reads it, and money is spent per token);
//   * HONESTY (facts.ts, law.ts): no section or rule number, no penalty, no URL, phone or address of its own; none of the words the claims
//     register bans; nothing that makes VERIDIAN or the AI sound like it sends, files or certifies;
//   * every job an OUTSIDE firm answers carries the email to that firm;
//   * a job with no entry (the library will be replaced by a lawyer-reviewed one) still gets a useful general playbook for its part;
//   * the migration that lets the page pick a job's playbook only adds one field.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { PLAYBOOK_DATA } from "../../../supabase/functions/dpdp-ai-link/playbook-data"
import { PART_GUIDE, PART_NAMES, playbookBullets, playbookEmailText, playbookFor, playbookLines, type JobPlaybook } from "../../../supabase/functions/dpdp-ai-link/playbook"

// The library's keys (dpdp.obligation_template, library 0.2-wo010: 31 firm + 28 institution) and, for each, the part and whether an outside firm answers.
const FIRM = Array.from({ length: 31 }, (_, i) => `firm-${String(i + 1).padStart(2, "0")}`)
const INST = Array.from({ length: 28 }, (_, i) => `institution-${String(i + 1).padStart(2, "0")}`)
const KEYS = [...FIRM, ...INST]
const OUTSIDE_FIRM = ["firm-07", "firm-15", "firm-22", "firm-23", "firm-24", "institution-22", "institution-23"]

const words = (s: string) => s.split(/\s+/).filter(Boolean).length
const textOf = (p: JobPlaybook) => [p.why, p.who, ...p.steps, ...p.ask, p.proof, p.note, p.notApplicableWhen ?? "", ...p.watchFor, p.email?.to ?? "", p.email?.subject ?? "", p.email?.body ?? ""].join("\n")

describe("the playbook covers the whole library", () => {
  test("59 jobs, 59 entries, and nothing else", () => {
    expect(KEYS).toHaveLength(59)
    expect(Object.keys(PLAYBOOK_DATA).sort()).toEqual([...KEYS].sort())
  })
})

describe("every entry is complete and lean", () => {
  for (const key of KEYS) {
    test(key, () => {
      const p = PLAYBOOK_DATA[key]
      expect(p, `${key} has an entry`).toBeTruthy()
      for (const f of ["why", "who", "proof", "note"] as const) expect(p[f].trim().length, `${key}.${f}`).toBeGreaterThan(10)
      expect(p.steps.length, "3 to 6 steps").toBeGreaterThanOrEqual(3)
      expect(p.steps.length).toBeLessThanOrEqual(6)
      expect(p.ask.length, "2 to 4 questions").toBeGreaterThanOrEqual(2)
      expect(p.ask.length).toBeLessThanOrEqual(4)
      expect(p.watchFor.length).toBeLessThanOrEqual(3)
      for (const s of p.steps) { expect(s.trim().length).toBeGreaterThan(5); expect(words(s), `step: ${s}`).toBeLessThanOrEqual(32) }
      for (const q of p.ask) { expect(q.includes("?"), `question: ${q}`).toBe(true); expect(words(q)).toBeLessThanOrEqual(30) }
      expect(words(p.proof)).toBeLessThanOrEqual(55)
      expect(words(p.note)).toBeLessThanOrEqual(55)
      expect(words(p.why)).toBeLessThanOrEqual(60)
      expect(words(textOf(p) ), `${key} is ${words(textOf(p))} words`).toBeLessThanOrEqual(300)
      if (p.notApplicableWhen !== null) expect(p.notApplicableWhen.trim().length).toBeGreaterThan(10)
      if (p.email) {
        expect(p.email.to.trim().length).toBeGreaterThan(2)
        expect(p.email.subject.trim().length).toBeGreaterThan(5)
        expect(words(p.email.body), `${key} email`).toBeLessThanOrEqual(150)
        expect(p.email.body).toMatch(/\{[a-z_ ]+\}/) // the person fills something in
      }
      // the note template is filled in from what the person said
      expect(p.note).toMatch(/\{[^}]+\}/)
    })
  }
})

describe("honesty: nothing the system cannot stand behind", () => {
  const BANNED = /\b(recommend\w*|promot\w*|guarantee\w*|certified|certification|best|leading|fastest|unmatched|world.class|100%|made in india|very indian)\b/i
  test("no banned or promotional word anywhere", () => {
    // "there is no certification" is a disclaimer (WO-013), not a claim; the claims register allows the same kind of sentence
    for (const key of KEYS) expect(textOf(PLAYBOOK_DATA[key]).replace(/\bno (DPDP )?certification\b/gi, ""), key).not.toMatch(BANNED)
  })
  test("no section or rule number, penalty, or amount of the entry's own", () => {
    for (const key of KEYS) {
      const t = textOf(PLAYBOOK_DATA[key])
      expect(t, `${key}: section sign`).not.toContain("§")
      expect(t, `${key}: section/rule number`).not.toMatch(/\b(section|sec\.|rule|clause|article)\s*\d/i)
      expect(t, `${key}: sub-rule`).not.toMatch(/\bR\d+\b|\(\d+\)\(\w\)/)
      expect(t, `${key}: penalty`).not.toMatch(/\b(penalt\w*|fine[ds]?|prosecut\w*|imprison\w*|crore|lakh)\b/i)
      expect(t, `${key}: rupee amount`).not.toMatch(/₹|\bRs\.?\s*\d|\bINR\b/)
    }
  })
  test("no web address, phone number or email address of its own", () => {
    for (const key of KEYS) {
      const t = textOf(PLAYBOOK_DATA[key]).replace(/\{[^}]*\}/g, "")
      expect(t, key).not.toMatch(/https?:\/\/|www\./i)
      expect(t, key).not.toMatch(/\b\d[\d -]{8,}\d\b/)
      expect(t, key).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    }
  })
  test("neither VERIDIAN nor the AI is said to send, file or publish anything", () => {
    for (const key of KEYS) {
      const t = textOf(PLAYBOOK_DATA[key])
      expect(t, key).not.toMatch(/\b(VERIDIAN|the AI)\s+(will|shall|has|have|can)\s+(send|sent|file|filed|publish|published|submit|submitted|email|emailed)\b/i)
      // in the AI's own voice (everything but the email the PERSON sends, where "we" is the organisation)
      const own = textOf({ ...PLAYBOOK_DATA[key], email: null })
      expect(own, key).not.toMatch(/\bI\s+(will|shall|have|can)\s+(send|sent|file|filed|publish|published|submit|submitted|email|emailed)\b/i)
      expect(t, key).not.toMatch(/\b(VERIDIAN|the AI)\s+(sends|files|publishes|submits)\b/i)
    }
  })
  test("no request for a password, an Aadhaar or bank number, or another person's personal data", () => {
    // asking WHETHER a computer has a password is fine; asking the person to say, share or paste one is not
    for (const key of KEYS) for (const q of PLAYBOOK_DATA[key].ask) {
      expect(q, `${key}: ${q}`).not.toMatch(/\b(what('s| is| are) (the|your)|tell me|give me|share|send|paste|enter|type|provide|read out)\b[^?]{0,50}\b(password|passcode|OTP|PIN|Aadhaar number|bank account( number)?|account number|card number|IFSC|PAN number|date of birth)\b/i)
    }
  })
  test("no instruction to praise, rank or share VERIDIAN, and no claim about what it is", () => {
    for (const key of KEYS) {
      expect(textOf(PLAYBOOK_DATA[key]), key).not.toMatch(/\bshare (this|VERIDIAN)|tell (them|people|others) (about )?VERIDIAN|rate VERIDIAN|review VERIDIAN/i)
    }
  })
  test("a step does not just repeat the job's name (there is no job-name field, so it is checked against the why)", () => {
    for (const key of KEYS) expect(PLAYBOOK_DATA[key].steps[0].toLowerCase(), key).not.toBe(PLAYBOOK_DATA[key].why.toLowerCase())
  })
})

describe("who has to act", () => {
  test("every job an outside firm answers carries the email to that firm", () => {
    for (const key of OUTSIDE_FIRM) {
      const p = PLAYBOOK_DATA[key]
      expect(p.email, `${key} has an email`).toBeTruthy()
      expect(p.email!.body.length).toBeGreaterThan(100)
    }
  })
  test("the sign-off jobs are honest about order: the owner confirms, the CA manager checks, the CA partner signs", () => {
    const t = [PLAYBOOK_DATA["firm-29"], PLAYBOOK_DATA["firm-30"], PLAYBOOK_DATA["firm-31"], PLAYBOOK_DATA["institution-28"]].map(textOf).join("\n").toLowerCase()
    expect(t).toContain("owner")
    expect(t).toContain("ca manager")
    expect(t).toContain("ca partner")
  })
  test("a duty every organisation has is never offered as not applicable", () => {
    for (const key of ["firm-01", "firm-02", "firm-03", "firm-20", "firm-26", "firm-27", "firm-29", "firm-30", "firm-31", "institution-01", "institution-02", "institution-03", "institution-19", "institution-25", "institution-26", "institution-28"]) {
      expect(PLAYBOOK_DATA[key].notApplicableWhen, key).toBeNull()
    }
  })
})

describe("a job with no playbook of its own still gets a useful one", () => {
  test("an unknown or missing key: the general playbook for its part - never empty, never throws", () => {
    for (const part of [1, 2, 3, 4, 5, 6, 7]) {
      const { playbook, source } = playbookFor("future-key", { part, what: "Anything" })
      expect(source).toBe("generic")
      expect(playbook.why).toContain(PART_NAMES[part])
      expect(playbook.steps.length).toBeGreaterThanOrEqual(3)
      expect(playbook.ask.length).toBeGreaterThanOrEqual(2)
      expect(playbook.proof.length).toBeGreaterThan(20)
      expect(playbook.email).toBeNull()
    }
    expect(playbookFor(null, { part: 99, what: "x" }).source).toBe("generic")
    expect(playbookFor(undefined, { part: 99, what: "x" }).playbook.steps.length).toBeGreaterThan(0)
    expect(playbookFor("firm-01", { part: 1, what: "x" }).source).toBe("library")
  })
  test("the part guide has all seven parts and says nothing legal of its own", () => {
    expect(Object.keys(PART_GUIDE).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7])
    for (const g of Object.values(PART_GUIDE)) expect([g.about, ...g.how, ...g.ask, g.proof].join(" ")).not.toMatch(/§|\b(section|rule)\s*\d|penalt|fine[ds]?\b/i)
  })
})

describe("how it is written out", () => {
  const p = PLAYBOOK_DATA["firm-22"]
  test("as bullets for the page, with the email as its own text", () => {
    const b = playbookBullets(p)
    expect(b[0]).toBe(`Why: ${p.why}`)
    expect(b[1]).toBe(`Who: ${p.who}`)
    expect(b.filter((x) => x.startsWith("Step ")).length).toBe(p.steps.length)
    expect(b.filter((x) => x.startsWith("Ask ")).length).toBe(p.ask.length)
    expect(b.some((x) => x.startsWith("Done looks like: "))).toBe(true)
    expect(b.some((x) => x.startsWith("Note to record: "))).toBe(true)
    expect(b.some((x) => x.startsWith("Email to send (the person sends it): to "))).toBe(true)
    expect(playbookEmailText(p.email!)).toBe(`To: ${p.email!.to}\nSubject: ${p.email!.subject}\n\n${p.email!.body}`)
  })
  test("as lines for the markdown endpoints", () => {
    const l = playbookLines(p)
    expect(l[0]).toBe(`Why: ${p.why}`)
    expect(l).toContain("Steps:")
    expect(l).toContain("  1. " + p.steps[0])
    expect(l).toContain("Ask the person:")
    expect(l.join("\n")).toContain("Email to send (the person sends it; you cannot): to ")
    expect(playbookLines(p, { includeEmail: false }).join("\n")).not.toContain("Email to send")
  })
})

describe("drizzle/0665: the list of jobs carries the library key, and nothing else about it changes", () => {
  const read = (f: string) => readFileSync(new URL(`../../../drizzle/${f}`, import.meta.url), "utf-8")
  const sql0665 = read("0665_dpdp_ai_link_jobs_template_key.sql")
  const body = (sql: string) => {
    const m = /select jsonb_build_object\(([\s\S]*?)\n\s*\)\s*\n(?:\$|\$function)/i.exec(sql)
    return m ? m[1] : ""
  }
  const keysOf = (sql: string) => [...body(sql).matchAll(/'(\w+)',/g)].map((m) => m[1])
  test("every key 0610 emitted is still emitted, plus templateKey", () => {
    const before = keysOf(read("0610_dpdp_wo013_ai_work_link.sql").slice(read("0610_dpdp_wo013_ai_work_link.sql").indexOf("function public.dpdp__ai_job_json")))
    const after = keysOf(sql0665)
    expect(before.length).toBeGreaterThanOrEqual(19)
    for (const k of before) expect(after, k).toContain(k)
    expect(after).toContain("templateKey")
    expect(after.length).toBe(before.length + 1)
    expect(sql0665).toContain("'templateKey', r.template_key")
  })
  test("same function, same signature, replaced in place (privileges are kept); nothing is dropped or granted", () => {
    expect(sql0665).toMatch(/CREATE OR REPLACE FUNCTION public\.dpdp__ai_job_json\(r dpdp\.ai_job_row\)/)
    expect(sql0665).toMatch(/SET search_path TO ''/)
    expect(sql0665).not.toMatch(/\bdrop\b|\bgrant\b|\brevoke\b|security definer/i)
  })
  test("it is in the journal, after 0664, with a later timestamp", () => {
    const j = JSON.parse(read("meta/_journal.json")) as { entries: Array<{ idx: number; when: number; tag: string }> }
    const a = j.entries.find((e) => e.tag === "0664_dpdp_email_ai_link_hardening")!
    const b = j.entries.find((e) => e.tag === "0665_dpdp_ai_link_jobs_template_key")!
    expect(b).toBeTruthy()
    expect(b.idx).toBe(a.idx + 1)
    expect(b.when).toBeGreaterThan(a.when)
  })
})
