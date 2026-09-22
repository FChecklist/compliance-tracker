/// <reference types="bun-types" />
// WO-DPDP-011 Step 4: the Edge Function's pure rendering/escalation module
// (supabase/functions/dpdp-monday-email/render.ts), run under bun with no
// Deno globals. The DB-side decisions live in drizzle/0606's
// dpdp.build_monday_digests and are proven by dpdp-timer.test.ts; this
// file pins the thresholds' TS mirror and the plain-English copy the WO
// asks for (late in red at the top, coordinator copied at 14 days, owner
// named at 30, halved for jobs required by today's law, the 24-hour link
// sentence, statutory-only after unsubscribe).
import { describe, expect, test } from "bun:test"
import {
  computeEscalation, domainOfFrom, escalationLines, isEmpty, listUnsubscribeHeaders, longDate, PLACEHOLDER,
  renderDigest, renderLeakClock, renderRightsClock, sortJobs, statutorySubset, subjectFor,
  type Digest, type DigestJob, type RenderLinks,
} from "../../../supabase/functions/dpdp-monday-email/render"

function job(over: Partial<DigestJob> & { obligationId: string }): DigestJob {
  const base: DigestJob = {
    obligationId: over.obligationId, key: "firm-04", what: "Write down where it is kept", part: 2, dueOn: "2026-09-15",
    daysLate: 0, late: false, requiredToday: false, isGroup: false, groupLabel: null, assigneeEmail: "staff@example.test",
    isMine: true, stuck: false, outsideParty: false,
  }
  const merged = { ...base, ...over }
  merged.late = merged.daysLate > 0
  merged.escalation = over.escalation ?? computeEscalation(merged)
  return merged
}

function digest(over: Partial<Digest> = {}): Digest {
  return {
    membershipId: "m1", identityId: "i1", orgId: "o1", orgName: "Acme & Co", orgProduct: "firm", email: "staff@example.test",
    level: "staff", roleKind: "staff", weekKey: "2026-W39", today: "2026-09-21", unsubscribed: false, statutoryOnly: false,
    alreadySentThisWeek: false, owners: [{ membershipId: "mo", email: "owner@example.test" }],
    coordinators: [{ membershipId: "mc", email: "coord@example.test" }], jobs: [], escalatedToMe: [], ...over,
  }
}

const dry: RenderLinks = { signIn: null, actions: null, unsubscribeUrl: null, appHome: "https://app.veridian-aios.com/app/" }
const live: RenderLinks = {
  signIn: "https://x.supabase.co/auth/v1/verify?token=abc",
  actions: { j1: { done: "https://app.veridian-aios.com/act/#d1", cannot: "https://app.veridian-aios.com/act/#c1", neverHadAny: null } },
  unsubscribeUrl: "https://x.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=u1",
  appHome: "https://app.veridian-aios.com/app/",
}

describe("WO-DPDP-011 §2.5 escalation thresholds (TS mirror of dpdp.build_monday_digests)", () => {
  test("14/30 days for an ordinary job", () => {
    expect(computeEscalation({ daysLate: 0, requiredToday: false, stuck: false, outsideParty: false })).toMatchObject({ red: false, ccCoordinator: false, ownerNamed: false })
    expect(computeEscalation({ daysLate: 13, requiredToday: false, stuck: false, outsideParty: false })).toMatchObject({ red: true, ccCoordinator: false, ownerNamed: false })
    expect(computeEscalation({ daysLate: 14, requiredToday: false, stuck: false, outsideParty: false })).toMatchObject({ red: true, ccCoordinator: true, ownerNamed: false })
    expect(computeEscalation({ daysLate: 29, requiredToday: false, stuck: false, outsideParty: false })).toMatchObject({ ccCoordinator: true, ownerNamed: false })
    expect(computeEscalation({ daysLate: 30, requiredToday: false, stuck: false, outsideParty: false })).toMatchObject({ ccCoordinator: true, ownerNamed: true, ccThresholdDays: 14, ownerThresholdDays: 30 })
  })
  test("twice as fast (7/15) for a job required by today's law", () => {
    expect(computeEscalation({ daysLate: 6, requiredToday: true, stuck: false, outsideParty: false })).toMatchObject({ red: true, ccCoordinator: false })
    expect(computeEscalation({ daysLate: 7, requiredToday: true, stuck: false, outsideParty: false })).toMatchObject({ ccCoordinator: true, ownerNamed: false })
    expect(computeEscalation({ daysLate: 14, requiredToday: true, stuck: false, outsideParty: false })).toMatchObject({ ownerNamed: false })
    expect(computeEscalation({ daysLate: 15, requiredToday: true, stuck: false, outsideParty: false })).toMatchObject({ ownerNamed: true, ccThresholdDays: 7, ownerThresholdDays: 15 })
  })
  test("'I cannot' goes to the coordinator at once, even when not late; a silent outside party goes to the owner", () => {
    expect(computeEscalation({ daysLate: 0, requiredToday: false, stuck: true, outsideParty: false })).toMatchObject({ red: false, coordinatorNow: true, ccCoordinator: true, ownerNamed: false })
    expect(computeEscalation({ daysLate: 1, requiredToday: false, stuck: false, outsideParty: true })).toMatchObject({ relationshipOwner: true, ccCoordinator: false })
    expect(computeEscalation({ daysLate: 0, requiredToday: false, stuck: false, outsideParty: true })).toMatchObject({ relationshipOwner: false })
  })
})

describe("ordering, statutory subset, emptiness", () => {
  test("late jobs first, most late at the top, then soonest due, then library order", () => {
    const sorted = sortJobs([
      job({ obligationId: "a", key: "firm-12", daysLate: 0, dueOn: "2026-10-01" }),
      job({ obligationId: "b", key: "firm-04", daysLate: 3, dueOn: "2026-09-18" }),
      job({ obligationId: "c", key: "firm-11", daysLate: 20, dueOn: "2026-09-01" }),
      job({ obligationId: "d", key: "firm-05", daysLate: 0, dueOn: "2026-09-25" }),
    ])
    expect(sorted.map((j) => j.obligationId)).toEqual(["c", "b", "d", "a"])
  })
  test("an unsubscribed membership keeps only what today's law requires", () => {
    const d = digest({
      statutoryOnly: true,
      jobs: [job({ obligationId: "s", requiredToday: true }), job({ obligationId: "d" })],
      escalatedToMe: [{ obligationId: "e", what: "x", assigneeEmail: "a@b", daysLate: 9, requiredToday: false, stuck: false, outsideParty: false, reason: "late_coordinator" }],
    })
    const s = statutorySubset(d)
    expect(s.jobs.map((j) => j.obligationId)).toEqual(["s"])
    expect(s.escalatedToMe).toEqual([])
    expect(isEmpty(statutorySubset(digest({ jobs: [job({ obligationId: "d" })] })))).toBe(true)
    expect(isEmpty(d)).toBe(false)
  })
})

describe("the Monday email's copy", () => {
  test("late jobs at the top in red, coordinator copied at 14 days, owner named at 30, buttons only on my own jobs, 24-hour link sentence", () => {
    const d = digest({
      jobs: [
        job({ obligationId: "j0", key: "firm-12", what: "Take consent before marketing", daysLate: 0 }),
        job({ obligationId: "j1", key: "firm-04", what: "Write down where <it> is kept", daysLate: 31 }),
        job({ obligationId: "j2", key: "firm-11", what: "Give a privacy notice", daysLate: 14, requiredToday: true }),
      ],
    })
    const out = renderDigest(d, live)
    expect(out.subject).toBe("Your DPDP jobs this week — 3 jobs to do (2 late)")
    // Late first: the 31-day job is rendered before the 14-day one, which is before the on-time one.
    const i31 = out.html.indexOf("Write down where &lt;it&gt; is kept")
    const i14 = out.html.indexOf("Give a privacy notice")
    const i0 = out.html.indexOf("Take consent before marketing")
    expect(i31).toBeGreaterThan(-1)
    expect(i31).toBeLessThan(i14)
    expect(i14).toBeLessThan(i0)
    expect(out.html).toContain("LATE")
    expect(out.html).toContain("#B91C1C")
    expect(out.html).toContain("Late 14 days or more — your DPDP coordinator (coord@example.test) has been copied.")
    expect(out.html).toContain("Late 30 days or more — Acme &amp; Co's owner, owner@example.test, has been told.")
    expect(out.html).toContain("required by today's law")
    expect(out.html).toContain("This link works for 24 hours — if it has stopped working, open the page and press 'Send me a new link'.")
    expect(out.html).toContain("https://x.supabase.co/auth/v1/verify?token=abc")
    expect(out.html).toContain("https://app.veridian-aios.com/act/#d1")
    expect(out.html).toContain("https://app.veridian-aios.com/act/#c1")
    expect(out.html).toContain("Stop these weekly emails")
    expect(out.text).toContain("[LATE] Write down where <it> is kept")
    expect(out.text).toContain("Yes, it is done: https://app.veridian-aios.com/act/#d1")
    expect(out.text).toContain("I can't: https://app.veridian-aios.com/act/#c1")
    // Not my job -> no buttons at all.
    const other = renderDigest(digest({ level: "owner", roleKind: "owner", jobs: [job({ obligationId: "x", isMine: false, assigneeEmail: "someone@example.test" })] }), live)
    expect(other.html).not.toContain("/act/#")
    expect(other.html).toContain("Everyone else's open jobs (1)")
  })

  test("a dry run renders placeholders and never a real link", () => {
    const out = renderDigest(digest({ jobs: [job({ obligationId: "j1", daysLate: 2 })] }), dry)
    expect(out.text).toContain(PLACEHOLDER.signIn)
    expect(out.text).toContain(PLACEHOLDER.done)
    expect(out.text).toContain(PLACEHOLDER.cannot)
    expect(out.text).toContain(PLACEHOLDER.unsubscribe)
    expect(out.html).not.toContain("supabase.co/auth")
  })

  test("'I can't' names the coordinator immediately; a group job offers all three answers", () => {
    const g = job({ obligationId: "g1", key: "firm-21", what: "Check your own laptop", isGroup: true, groupLabel: "All staff", assigneeEmail: null, stuck: true, daysLate: 0 })
    const lines = escalationLines(g, digest())
    expect(lines[0]).toContain("said they can't do this — your DPDP coordinator (coord@example.test) has been told.")
    const links: RenderLinks = { ...live, actions: { g1: { done: "https://a/act/#d", cannot: "https://a/act/#c", neverHadAny: "https://a/act/#n" } } }
    const out = renderDigest(digest({ jobs: [g] }), links)
    expect(out.html).toContain("Doesn't apply to me")
    expect(out.html).toContain("https://a/act/#n")
    expect(out.html).toContain("All staff")
  })

  test("the owner's email carries what was escalated to them, by name and reason; the coordinator's too", () => {
    const owner = renderDigest(digest({
      level: "owner", roleKind: "owner", email: "owner@example.test",
      escalatedToMe: [
        { obligationId: "a", what: "Lock down PAN records", assigneeEmail: "staff@example.test", daysLate: 33, requiredToday: false, stuck: false, outsideParty: false, reason: "late_owner" },
        { obligationId: "b", what: "Website firm signs the data agreement", assigneeEmail: "web@vendor.test", daysLate: 4, requiredToday: false, stuck: false, outsideParty: true, reason: "outside_party_silent" },
      ],
    }), live)
    expect(owner.subject).toContain("2 escalated to you")
    expect(owner.html).toContain("Escalated to you as owner (2)")
    expect(owner.html).toContain("staff@example.test — late by 33 days. You are told by name because it has passed the owner threshold.")
    expect(owner.html).toContain("web@vendor.test (outside firm) has gone quiet — late by 4 days. You hold that relationship.")
    const coord = renderDigest(digest({
      roleKind: "coord", email: "coord@example.test",
      escalatedToMe: [{ obligationId: "c", what: "Check your own laptop", assigneeEmail: "All staff", daysLate: 0, requiredToday: false, stuck: true, outsideParty: false, reason: "stuck" }],
    }), live)
    expect(coord.subject).toBe("Acme & Co: 1 job escalated to you as DPDP coordinator")
    expect(coord.html).toContain("All staff said they can't do it — please help or reassign.")
  })

  test("subjects", () => {
    expect(subjectFor(digest({ jobs: [job({ obligationId: "a" })] }))).toBe("Your DPDP jobs this week — 1 job to do")
    expect(subjectFor(digest({ level: "owner", roleKind: "owner", jobs: [job({ obligationId: "a", isMine: false, daysLate: 2 }), job({ obligationId: "b", isMine: false })] }))).toBe("Acme & Co: DPDP this week — 2 open jobs, 1 late")
    expect(subjectFor(digest({ statutoryOnly: true, jobs: [job({ obligationId: "a", requiredToday: true, daysLate: 1 })] }), "statutory")).toBe("Acme & Co: 1 job required by today's law (1 late)")
    expect(longDate("2026-09-21")).toBe("21 September 2026")
  })
})

describe("legal clocks and RFC 8058 headers", () => {
  const recipient = { membershipId: "mo", identityId: "io", email: "owner@example.test", role: "owner" as const }
  test("72-hour leak clock, running and overdue", () => {
    const base = { breachId: "b1", orgId: "o1", orgName: "Acme & Co", becameAwareAt: "2026-09-21T08:00:00Z", deadlineAt: "2026-09-24T08:00:00Z", boardNotified: false, individualsNotified: true, scopePersonCount: 120, periodKey: "leak:b1:2026-09-22", recipients: [recipient] }
    const running = renderLeakClock({ ...base, hoursLeft: 40.2 }, recipient, live)
    expect(running.subject).toBe("72-hour clock: data leak at Acme & Co — tell the Data Protection Board")
    expect(running.text).toContain("40 hours left on the 72-hour clock.")
    expect(running.text).toContain("about 120 people")
    expect(running.text).toContain("statutory notice")
    const overdue = renderLeakClock({ ...base, hoursLeft: -5, boardNotified: true, individualsNotified: false }, recipient, live)
    expect(overdue.subject).toBe("OVERDUE: data leak at Acme & Co — tell the people affected")
    expect(overdue.text).toContain("ran out 5 hours ago")
  })
  test("90-day rights clock", () => {
    const item = { requestId: "r1", ref: "RR-0007", kind: "erasure", orgId: "o1", orgName: "Acme & Co", receivedAt: "2026-06-30T00:00:00Z", dueAt: "2026-09-28T00:00:00Z", daysLeft: 6, periodKey: "rights:r1:2026-09-22", recipients: [recipient] }
    const out = renderRightsClock(item, recipient, live)
    expect(out.subject).toBe("Rights request RR-0007 at Acme & Co — 6 day(s) left")
    expect(out.text).toContain("A erasure request (RR-0007) received on 2026-06-30 has not been answered. 6 day(s) left of the 90-day limit.")
    expect(renderRightsClock({ ...item, daysLeft: -2 }, recipient, live).subject).toContain("past its 90-day limit")
  })
  test("List-Unsubscribe pair and from-domain parsing", () => {
    expect(listUnsubscribeHeaders("https://f/u?t=1", "unsubscribe@send.veridian-aios.com?subject=unsubscribe%201")).toEqual({
      "List-Unsubscribe": "<https://f/u?t=1>, <mailto:unsubscribe@send.veridian-aios.com?subject=unsubscribe%201>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    })
    expect(listUnsubscribeHeaders("https://f/u?t=1", null)["List-Unsubscribe"]).toBe("<https://f/u?t=1>")
    expect(domainOfFrom("VERIDIAN AI DPDP <dpdp@send.veridian-aios.com>")).toBe("send.veridian-aios.com")
    expect(domainOfFrom("dpdp@send.veridian-aios.com")).toBe("send.veridian-aios.com")
    expect(domainOfFrom("nonsense")).toBeNull()
  })
})
