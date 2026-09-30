/// <reference types="bun-types" />
// The AI work link inside the Monday email (owner, 2026-09-30: "in email itself give the AI WORK LINK ... user should in most
// cases never open the webpage ... READ / EDIT / WORK"). Pins:
//   * the email carries the whole link, ready to paste into an AI, with the same warning sentence the in-app Copy-link screen
//     shows and an honest account of what the link can do;
//   * level 1 (read + small edits + drafts) is what the emailed link is, level 0 stays available and says "cannot change anything";
//   * a dry run shows the placeholder, a failed mint falls back to the page wording, the statutory-only view never gets a link;
//   * what the AI changed is listed, escaped and capped;
//   * the Edge Function and the migration agree on the RPC names and parameter names (a wrong name is "function not found").
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  PLACEHOLDER, aiChangeSentence, aiLinkWarningSentence, istYmd, renderDigest, statutorySubset, computeEscalation,
  type AiChange, type Digest, type DigestJob, type RenderLinks,
} from "../../../supabase/functions/dpdp-monday-email/render"
import * as appLink from "../../../dpdp-app/src/lib/ai-work-link"

const REPO = join(import.meta.dir, "..", "..", "..")
const FN = join(REPO, "supabase", "functions", "dpdp-monday-email")
const TOKEN = "ab".repeat(32) // 64 hex characters, low entropy on purpose (gitleaks)
const URL_ = `https://app.veridian-aios.com/ai/${TOKEN}`

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
  signIn: "https://example.invalid/signin", actions: null, unsubscribeUrl: "https://example.invalid/unsub", appHome: "https://app.veridian-aios.com/app/",
}
const withLink = (level: 0 | 1 = 1, extra: Partial<RenderLinks> = {}): RenderLinks => ({
  ...base, aiLink: { url: URL_, expiresOn: "2026-10-05", level, jobs: 31, people: 4 }, ...extra,
})

describe("the AI work link in the Monday email", () => {
  test("Option 1 leads, the whole link is in a copy-and-paste box, and it is text, not a tracked anchor", () => {
    const out = renderDigest(digest(), withLink())
    expect(out.text).toContain("Option 1 — Relax, let an AI do it for you.")
    expect(out.text).toContain("ChatGPT, Claude, Gemini, Grok, DeepSeek")
    expect(out.text).toContain(`Please open this link and help me finish my DPDP jobs for this week: ${URL_}`)
    // Option 1 before Option 2 before Option 3, and the page is last.
    const i1 = out.text.indexOf("Option 1"), i2 = out.text.indexOf("Option 2"), i3 = out.text.indexOf("Option 3")
    expect(i1).toBeGreaterThan(-1); expect(i1).toBeLessThan(i2); expect(i2).toBeLessThan(i3)
    expect(out.text).toContain("Option 2 — Do it right here.")
    expect(out.text).toContain("Option 3 — Do it yourself.")
    // The user must not be told to open the page in order to get the link.
    expect(out.text).not.toContain("Open your page below, then copy")
    expect(out.html).toContain(URL_)
    expect(out.html).toContain("user-select:all")
    expect(out.html).not.toContain(`href="${URL_}"`) // no anchor: a scanner or click tracker must not fetch or rewrite it
    expect(out.html).toContain("Your AI Work link — copy and paste into your AI")
  })

  test("it says what the link is: the verbatim in-app warning with real counts, READ / EDIT / WORK, the expiry, keep it private", () => {
    const out = renderDigest(digest(), withLink(1))
    expect(out.text).toContain(aiLinkWarningSentence(31, 4))
    expect(out.text).toContain("It can read your jobs and make small changes for you directly")
    expect(out.text).toContain("add a note, change a due date, give a job to someone already on your team, or mark a job not applicable")
    expect(out.text).toContain("listed in your next Monday email")
    expect(out.text).toContain("Anything with legal weight, such as marking a job done, it only prepares as a draft: you confirm it with one tap.")
    expect(out.text).toContain("The link stops working on 5 October 2026; next Monday's email brings a fresh one.")
    expect(out.text).toContain("Keep it private, paste it only into an AI you trust, and do not forward this email.")
    expect(out.text).toContain("31 jobs and the names and emails of 4 people")
  })

  test("the warning sentence is byte-identical to the one the app shows before it makes a link (WO-013 §1.1)", () => {
    for (const [jobs, people] of [[0, 0], [1, 1], [31, 4], [200, 57]]) {
      expect(aiLinkWarningSentence(jobs, people)).toBe(appLink.aiWorkLinkWarningSentence({ jobs, people }))
    }
  })

  test("level 0 says it cannot change anything and does not offer small changes", () => {
    const out = renderDigest(digest(), withLink(0))
    expect(out.text).toContain("It can read your jobs and report on them. It cannot change anything.")
    expect(out.text).not.toContain("make small changes")
  })

  test("no link (a failed mint, or switched off): the page wording, and no paste box", () => {
    const out = renderDigest(digest(), { ...base, aiLink: null })
    expect(out.text).toContain("Option 1 — Relax, let an AI do it for you. Open your page below, copy your AI Work link, and paste it into any AI you use")
    expect(out.text).not.toContain("Please open this link")
    expect(out.html).not.toContain("user-select:all")
    // a caller that predates the field behaves the same
    expect(renderDigest(digest(), base).text).toContain("Open your page below, copy your AI Work link")
  })

  test("a dry run records the placeholder and never a credential", () => {
    const out = renderDigest(digest(), { ...base, signIn: null, aiLink: { url: PLACEHOLDER.aiLink, expiresOn: "2026-10-05", level: 1 } })
    expect(out.text).toContain(`help me finish my DPDP jobs for this week: ${PLACEHOLDER.aiLink}`)
    expect(out.text).not.toMatch(/\/ai\/[0-9a-f]{64}/)
    expect(out.html).not.toMatch(/\/ai\/[0-9a-f]{64}/)
  })

  test("the statutory-only view (someone who stopped the weekly email) gets no options and no link", () => {
    const d = digest({ statutoryOnly: true, jobs: [job({ obligationId: "s", requiredToday: true, daysLate: 2 })] })
    const out = renderDigest(statutorySubset(d), withLink(), "statutory")
    expect(out.text).not.toContain("Option 1")
    expect(out.text).not.toContain(URL_)
    expect(out.html).not.toContain(TOKEN)
  })

  test("an owner who only oversees other people's jobs has no buttons, so no 'do it right here' option is offered", () => {
    const out = renderDigest(digest({ level: "owner", roleKind: "owner", jobs: [job({ obligationId: "x", isMine: false })] }), withLink())
    expect(out.text).toContain(URL_)
    expect(out.text).toContain("TWO WAYS TO DO THIS")
    expect(out.text).toContain("Option 2 — Do it yourself.")
    expect(out.text).not.toContain("Option 3")
    expect(out.text).not.toContain("Do it right here")
    expect(out.text).not.toContain("I can't")
    // ...and the same for the fallback wording when no link could be minted
    const fallback = renderDigest(digest({ level: "owner", roleKind: "owner", jobs: [job({ obligationId: "x", isMine: false })] }), { ...base, aiLink: null })
    expect(fallback.text).toContain("TWO WAYS TO DO THIS")
    expect(fallback.text).toContain("Option 2 — Do it yourself.")
    expect(fallback.text).not.toContain("Do it right here")
  })

  test("a person with jobs of their own gets the three ways, in order", () => {
    const out = renderDigest(digest(), withLink())
    expect(out.text).toContain("THREE WAYS TO DO THIS")
    expect(out.text).toContain("Option 2 — Do it right here.")
    expect(out.text).toContain("Option 3 — Do it yourself.")
  })

  test("the link's URL is HTML-escaped in the email body", () => {
    const out = renderDigest(digest(), { ...base, aiLink: { url: `https://app.veridian-aios.com/ai/${TOKEN}?a=1&b=<x>`, expiresOn: "2026-10-05", level: 1 } })
    expect(out.html).toContain("a=1&amp;b=&lt;x&gt;")
    expect(out.html).not.toContain("<x>")
  })
})

describe("an email that exists only to tell the person what their AI changed", () => {
  const one: AiChange[] = [{ verb: "NOTE", what: "Name a DPDP coordinator", value: { text: "asked Priya" }, appliedAt: "2026-09-28T01:00:00Z", undoUrl: null }]
  const quiet = digest({ jobs: [], aiChangesOnly: true })
  test("its own subject, an honest first line, the changes, and nothing to do: no options, no new link", () => {
    const out = renderDigest(quiet, { ...base, aiLink: null, aiChanges: one })
    expect(out.subject).toBe("Acme & Co: what your AI changed for you this week")
    expect(out.text).toContain("What your AI changed for you\n")
    expect(out.text).toContain("Nothing needs you at Acme & Co this week. Your AI assistant made some changes for you since your last email")
    expect(out.text).toContain("WHAT YOUR AI CHANGED FOR YOU (1)")
    expect(out.text).toContain("Added a note to “Name a DPDP coordinator”: “asked Priya”")
    expect(out.text).not.toContain("Option 1")
    expect(out.text).not.toContain("TWO WAYS")
    expect(out.text).not.toContain("Please open this link")
    expect(out.text).not.toContain("Nothing for you this week")
    expect(out.text).not.toContain("DPDP is the law")
  })
  test("the same person, with jobs, gets the ordinary digest", () => {
    const out = renderDigest(digest({ aiChangesOnly: false }), withLink(1, { aiChanges: one }))
    expect(out.subject).toContain("Your DPDP jobs this week")
    expect(out.text).toContain("Option 1")
    expect(out.text).toContain("WHAT YOUR AI CHANGED FOR YOU (1)")
  })
})

describe("what your AI changed for you", () => {
  const changes: AiChange[] = [
    { verb: "NOTE", what: "Give a privacy notice", value: { text: "called the vendor <b>today</b>" }, appliedAt: "2026-09-27T20:30:00Z", undoUrl: null },
    { verb: "SET_DUE", what: "Give a privacy notice", value: { dueOn: "2026-10-10" }, appliedAt: "2026-09-27T20:31:00Z", undoUrl: "https://app.veridian-aios.com/app/#undo=a1.b2" },
    { verb: "ASSIGN", what: "Check your laptop", value: { email: "asha@acmeca.in" }, appliedAt: "2026-09-28T01:00:00Z", undoUrl: null },
    { verb: "MARK_NA", what: "Write a policy", value: { reason: "We hold no such data" }, appliedAt: "2026-09-28T01:05:00Z", undoUrl: null },
  ]
  test("one plain sentence each, the date in India time, an undo link only where one exists", () => {
    expect(aiChangeSentence(changes[1])).toBe("Moved the due date of “Give a privacy notice” to 2026-10-10")
    expect(aiChangeSentence(changes[2])).toBe("Gave “Check your laptop” to asha@acmeca.in")
    expect(aiChangeSentence(changes[3])).toBe("Marked “Write a policy” not applicable: “We hold no such data”")
    const out = renderDigest(digest(), withLink(1, { aiChanges: changes }))
    expect(out.text).toContain("WHAT YOUR AI CHANGED FOR YOU (4)")
    expect(out.text).toContain("recorded in your history as made by you via your AI assistant")
    expect(out.text).toContain("Undo: https://app.veridian-aios.com/app/#undo=a1.b2")
    expect(out.text.match(/Undo:/g)?.length).toBe(1)
    // 20:30Z on 27 Sep is 02:00 IST on 28 Sep
    expect(out.text).toContain("Added a note to “Give a privacy notice”: “called the vendor <b>today</b>” — 28 September 2026")
    expect(out.html).toContain("called the vendor &lt;b&gt;today&lt;/b&gt;")
    expect(out.html).not.toContain("<b>today</b>")
    expect(out.html).toContain(">Undo</a>")
  })
  test("nothing changed, nothing shown; more than 20 are capped with a count", () => {
    expect(renderDigest(digest(), withLink(1, { aiChanges: [] })).text).not.toContain("WHAT YOUR AI CHANGED")
    const many = Array.from({ length: 23 }, (_, i) => ({ ...changes[0], what: `Job ${i}` }))
    const out = renderDigest(digest(), withLink(1, { aiChanges: many }))
    expect(out.text).toContain("WHAT YOUR AI CHANGED FOR YOU (23)")
    expect(out.text).toContain("...and 3 more in your history.")
    expect(out.text).toContain("Job 19")
    expect(out.text).not.toContain("Job 20")
  })
  test("never in the statutory-only view", () => {
    const out = renderDigest(statutorySubset(digest({ statutoryOnly: true, jobs: [job({ obligationId: "s", requiredToday: true })] })), withLink(1, { aiChanges: changes }), "statutory")
    expect(out.text).not.toContain("WHAT YOUR AI CHANGED")
  })
  test("a long or multi-line value is cut to one short line", () => {
    const s = aiChangeSentence({ verb: "NOTE", what: "x", value: { text: `line one\nline two ${"z".repeat(400)}` }, appliedAt: "2026-09-28T00:00:00Z", undoUrl: null })
    expect(s).not.toContain("\n")
    expect(s.length).toBeLessThan(200)
    expect(s).toContain("…")
  })
  test("istYmd is India time", () => {
    expect(istYmd("2026-09-27T20:30:00Z")).toBe("2026-09-28")
    expect(istYmd("2026-10-05T00:30:00Z")).toBe("2026-10-05")
    expect(istYmd("not a date")).toBe("1970-01-01")
  })
})

describe("the Edge Function, the migration and the database agree", () => {
  const index = readFileSync(join(FN, "index.ts"), "utf8")
  const sqlPath = join(REPO, "drizzle", "0663_dpdp_email_ai_work_link.sql")
  const sql = existsSync(sqlPath) ? readFileSync(sqlPath, "utf8") : ""
  test("the migration exists, is registered in the journal, and cites the owner's instruction", () => {
    expect(sql).not.toBe("")
    expect(sql.startsWith("-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-09-30")).toBe(true)
    expect(sql).toContain("READ / EDIT / WORK")
    const journal = JSON.parse(readFileSync(join(REPO, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string; when: number }> }
    const at = journal.entries.findIndex((e) => e.tag === "0663_dpdp_email_ai_work_link")
    expect(at).toBeGreaterThan(0)
    expect(journal.entries[at].when).toBeGreaterThan(journal.entries[at - 1].when)
  })
  test("the function is called by the parameter names the SQL declares", () => {
    expect(sql).toContain("create or replace function public.dpdp_timer_mint_email_ai_link(")
    for (const p of ["p_membership_id text", "p_level integer default 1", "p_days integer default 7"]) expect(sql).toContain(p)
    expect(index).toContain('"dpdp_timer_mint_email_ai_link", { p_membership_id: membershipId, p_level: AI_LINK_LEVEL, p_days: AI_LINK_DAYS }')
    expect(index).toContain('"dpdp_timer_ai_actions_for_digest", { p_membership_id: membershipId, p_mark: false }')
    expect(index).toContain('"dpdp_timer_ai_actions_for_digest", { p_membership_id: d.membershipId, p_mark: true }')
    expect(index).toContain('"dpdp_timer_issue_undo_token", { p_action_id: r.actionId }')
  })
  test("service_role only; nobody else may execute it; it can only make level 0 or 1 and a 1, 7 or 30 day link", () => {
    expect(sql).toContain("revoke all on function public.dpdp_timer_mint_email_ai_link(text, integer, integer) from public, anon, authenticated;")
    expect(sql).toContain("grant execute on function public.dpdp_timer_mint_email_ai_link(text, integer, integer) to service_role;")
    expect(sql).toContain("if v_level not in (0, 1) then")
    expect(sql).toContain("if v_days not in (1, 7, 30) then")
    expect(sql).not.toMatch(/to (anon|authenticated|public)\b/)
  })
  test("it retires only earlier 'Monday email' links of the same person, and marks its own so", () => {
    expect(sql).toContain("where membership_id = v_m.id\n    and label = 'Monday email'\n    and revoked_at is null")
    expect(sql).toContain("v_level, false, v_m.id, 'Monday email', 0")
  })
  test("the link is minted only for the full digest, the dry run gets the placeholder, and the changes are marked shown only after the send", () => {
    expect(index).toContain('const isDigest = d.kind === "monday_digest"')
    expect(index).toContain("url: PLACEHOLDER.aiLink")
    expect(index.indexOf('p_status: "sent"')).toBeGreaterThan(-1)
    expect(index.indexOf("p_mark: true")).toBeGreaterThan(index.indexOf('p_status: "sent"'))
    expect(index).toContain('const aiLink = isDigest && !d.aiChangesOnly ? await mintAiLink(sb, d.membershipId) : null')
  })
  test("an AI-changes-only email is sent for a real address only, never in a dry run, and only when something is pending", () => {
    expect(index).toContain("aiChangesOnly = kind === \"monday_digest\" && !dryRun && AI_LINK_ENABLED && isDeliverableAddress(digest.email) && (await hasPendingAiChanges(sb, digest.membershipId))")
    expect(index).toContain("if (!aiChangesOnly) { summary.skipped++;")
    expect(index).toContain("renderDigest(aiChangesOnly ? { ...digest, aiChangesOnly: true } : digest, links, kind)")
  })
  test("the switches: on by default at level 1 for 7 days; ENABLED=0 removes it, LEVEL=0 makes it read-only", () => {
    expect(index).toContain('const AI_LINK_ENABLED = env("DPDP_EMAIL_AI_LINK_ENABLED") !== "0"')
    expect(index).toContain('const AI_LINK_LEVEL: 0 | 1 = env("DPDP_EMAIL_AI_LINK_LEVEL") === "0" ? 0 : 1')
    expect(index).toContain(': 7')
  })
  test("the token is only ever accepted in the shape the database mints (64 hex)", () => {
    expect(index).toContain("/^[0-9a-f]{64}$/.test(r.token)")
  })
})
