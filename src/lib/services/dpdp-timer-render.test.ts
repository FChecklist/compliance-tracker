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
  BRAND_LINE_FULL, BRAND_LINE_SHORT, INVITE_ASK, PUBLIC_SITE, SHARE_ASK, isDecisionMaker,
  computeEscalation, domainOfFrom, escalationLines, isDeliverableAddress, isEmpty, listUnsubscribeHeaders, longDate, PLACEHOLDER,
  renderDigest, renderLeakClock, renderRightsClock, sortJobs, statutorySubset, subjectFor, unsubscribeMailto,
  type Digest, type DigestJob, type RenderLinks,
} from "../../../supabase/functions/dpdp-monday-email/render"
// The single-mailbox address grammar the List-Unsubscribe mailto is built from.
import { parseRecipient } from "../../../supabase/functions/_shared/mail-taxonomy"
// WO-DPDP-014: the private app's own copy of the three lines -- plain TS,
// no imports, so it loads straight across the tree here.
import * as appBrand from "../../../dpdp-app/src/lib/brand"

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

const dry: RenderLinks = { signIn: null, actions: null, unsubscribeUrl: null, appHome: "https://dpdp.veridian-aios.com/app/" }
const live: RenderLinks = {
  signIn: "https://x.supabase.co/auth/v1/verify?token=abc",
  actions: { j1: { done: "https://dpdp.veridian-aios.com/act/#d1", cannot: "https://dpdp.veridian-aios.com/act/#c1", neverHadAny: null } },
  unsubscribeUrl: "https://x.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=u1",
  appHome: "https://dpdp.veridian-aios.com/app/",
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
    expect(out.html).toContain("https://dpdp.veridian-aios.com/act/#d1")
    expect(out.html).toContain("https://dpdp.veridian-aios.com/act/#c1")
    expect(out.html).toContain("Stop these weekly emails")
    expect(out.text).toContain("[LATE] Write down where <it> is kept")
    expect(out.text).toContain("Yes, it is done: https://dpdp.veridian-aios.com/act/#d1")
    expect(out.text).toContain("I can't: https://dpdp.veridian-aios.com/act/#c1")
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

// WO-DPDP-014 §4/§5 -- the brand line in every footer, the share ask only
// to decision-makers on the Monday digest, never in a legal clock, never in
// the preview text.
describe("WO-DPDP-014 -- the brand line in email footers", () => {
  const stripTags = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  const ownerDigest = () => digest({ level: "owner", roleKind: "owner", email: "owner@example.test", jobs: [job({ obligationId: "j1", isMine: false, assigneeEmail: "staff@example.test", what: "Mask Aadhaar copies" })] })
  const staffDigest = () => digest({ jobs: [job({ obligationId: "j1", what: "Put up a notice wherever there is a camera" }), job({ obligationId: "j2", what: "Mask Aadhaar copies" })] })

  test("the email's constants are byte-identical to dpdp-app/src/lib/brand.ts", () => {
    expect(BRAND_LINE_FULL).toBe(appBrand.BRAND_LINE_FULL)
    expect(BRAND_LINE_SHORT).toBe(appBrand.BRAND_LINE_SHORT)
    expect(SHARE_ASK).toBe(appBrand.SHARE_ASK)
    expect(PUBLIC_SITE).toBe(appBrand.PUBLIC_SITE)
    expect(BRAND_LINE_FULL).toBe("VERIDIAN · VERy INDIAN — Built for India's DPDP Act. For India, by India.")
  })

  test("decision-maker = owner, or a CA partner/manager when the digest carries caSub (0606 does not, yet) -- unchanged by WO-016's widening below, kept for callers that still care who counts as one", () => {
    expect(isDecisionMaker({ level: "owner" })).toBe(true)
    expect(isDecisionMaker({ level: "staff" })).toBe(false)
    expect(isDecisionMaker({ level: "staff", caSub: null })).toBe(false)
    expect(isDecisionMaker({ level: "staff", caSub: "partner" })).toBe(true)
    expect(isDecisionMaker({ level: "staff", caSub: "manager" })).toBe(true)
  })

  test("every digest carries the brand line once, in the footer, after the last job", () => {
    for (const d of [ownerDigest(), staffDigest()]) {
      const out = renderDigest(d, live)
      expect(out.html.split(BRAND_LINE_FULL)).toHaveLength(2)
      expect(out.text.split(BRAND_LINE_FULL)).toHaveLength(2)
      expect(out.html.indexOf(BRAND_LINE_FULL)).toBeGreaterThan(out.html.lastIndexOf("Mask Aadhaar copies"))
      expect(out.text.indexOf(BRAND_LINE_FULL)).toBeGreaterThan(out.text.lastIndexOf("Mask Aadhaar copies"))
      // Plain small text, no banner, no button, no image for it.
      const footerHtml = out.html.slice(out.html.indexOf(BRAND_LINE_FULL) - 120, out.html.indexOf(BRAND_LINE_FULL))
      expect(footerHtml).toContain("font-size:12px")
      expect(out.html).not.toMatch(/<img/i)
      expect(out.subject).not.toContain("VERy INDIAN")
    }
  })

  test("WO-016 §1/Step 2: the invite + refer asks reach EVERY signed-in person's Monday digest now, not just a decision-maker -- bare public site when there is no code yet", () => {
    const owner = renderDigest(ownerDigest(), live)
    expect(owner.html).toContain(SHARE_ASK)
    expect(owner.html).toContain(INVITE_ASK)
    expect(owner.html).toContain(`href="${PUBLIC_SITE}"`)
    expect(owner.text).toContain(`${SHARE_ASK}: ${PUBLIC_SITE}`)
    expect(owner.text).toContain(`${INVITE_ASK}: ${PUBLIC_SITE}`)
    expect(owner.html).not.toContain("?ref=")
    expect(owner.html).not.toContain("?join=")
    // Both asks sit under the brand line, in the footer.
    expect(owner.html.indexOf(INVITE_ASK)).toBeGreaterThan(owner.html.indexOf(BRAND_LINE_FULL))
    expect(owner.html.indexOf(SHARE_ASK)).toBeGreaterThan(owner.html.indexOf(INVITE_ASK))
    expect(owner.text.indexOf(SHARE_ASK)).toBeGreaterThan(owner.text.indexOf(BRAND_LINE_FULL))

    // Plain staff, a coordinator, and a CA partner all now get both asks too.
    const staff = renderDigest(staffDigest(), live)
    expect(staff.html).toContain(SHARE_ASK)
    expect(staff.html).toContain(INVITE_ASK)

    const coord = renderDigest(digest({ roleKind: "coord", email: "coord@example.test", jobs: [job({ obligationId: "j1" })] }), live)
    expect(coord.html).toContain(SHARE_ASK)
    expect(coord.html).toContain(INVITE_ASK)

    const partner = renderDigest(digest({ caSub: "partner", jobs: [job({ obligationId: "j1" })] }), live)
    expect(partner.html).toContain(SHARE_ASK)
    expect(partner.text).toContain(SHARE_ASK)

    // The statutory-only digest (after unsubscribe) carries the brand line but never either ask.
    const statutory = renderDigest(statutorySubset(digest({ level: "owner", roleKind: "owner", statutoryOnly: true, jobs: [job({ obligationId: "s", isMine: false, requiredToday: true })] })), live, "statutory")
    expect(statutory.html).toContain(BRAND_LINE_FULL)
    expect(statutory.html).not.toContain(SHARE_ASK)
    expect(statutory.html).not.toContain(INVITE_ASK)
    expect(statutory.text).not.toContain(SHARE_ASK)
  })

  test("WO-016 Step 2: when the digest carries a referralCode/inviteCode, the footer links are personalised", () => {
    const out = renderDigest(digest({
      level: "owner", roleKind: "owner", email: "owner@example.test", referralCode: "REFCODE1", inviteCode: "JOINCODE",
      jobs: [job({ obligationId: "j1", isMine: false, assigneeEmail: "staff@example.test" })],
    }), live)
    expect(out.html).toContain(`${PUBLIC_SITE}?ref=REFCODE1`)
    expect(out.html).toContain(`${PUBLIC_SITE}?join=JOINCODE`)
    expect(out.text).toContain(`${SHARE_ASK}: ${PUBLIC_SITE}?ref=REFCODE1`)
    expect(out.text).toContain(`${INVITE_ASK}: ${PUBLIC_SITE}?join=JOINCODE`)
  })

  test("legal-clock emails: brand line in the footer, share ask never", () => {
    const recipient = { membershipId: "mo", identityId: "io", email: "owner@example.test", role: "owner" as const }
    const leak = renderLeakClock({ breachId: "b1", orgId: "o1", orgName: "Acme & Co", becameAwareAt: "2026-09-21T08:00:00Z", deadlineAt: "2026-09-24T08:00:00Z", hoursLeft: 40, boardNotified: false, individualsNotified: true, scopePersonCount: 12, periodKey: "leak:b1:2026-09-22", recipients: [recipient] }, recipient, live)
    const rights = renderRightsClock({ requestId: "r1", ref: "RR-0007", kind: "erasure", orgId: "o1", orgName: "Acme & Co", receivedAt: "2026-06-30T00:00:00Z", dueAt: "2026-09-28T00:00:00Z", daysLeft: 6, periodKey: "rights:r1:2026-09-22", recipients: [recipient] }, recipient, live)
    for (const out of [leak, rights]) {
      expect(out.html).toContain(BRAND_LINE_FULL)
      expect(out.text).toContain(BRAND_LINE_FULL)
      expect(out.html).not.toContain(SHARE_ASK)
      expect(out.text).not.toContain(SHARE_ASK)
      expect(out.html).not.toContain(INVITE_ASK)
      expect(out.text).not.toContain(INVITE_ASK)
      expect(out.html).not.toContain(PUBLIC_SITE)
      expect(out.text).not.toContain(PUBLIC_SITE)
      expect(out.html.indexOf(BRAND_LINE_FULL)).toBeGreaterThan(out.html.indexOf("Sent to you as"))
    }
  })

  test("the preview text stays the person's jobs: neither line in the first 300 characters of html, visible text, or text", () => {
    for (const [d, kind] of [[ownerDigest(), "monday_digest"], [staffDigest(), "monday_digest"]] as const) {
      const out = renderDigest(d, live, kind)
      for (const s of [out.html.slice(0, 300), stripTags(out.html).slice(0, 300), out.text.slice(0, 300)]) {
        expect(s).not.toContain("VERy INDIAN")
        expect(s).not.toContain("For India, by India")
        expect(s).not.toContain(SHARE_ASK)
        expect(s).not.toContain(PUBLIC_SITE)
      }
      // The hidden preheader is the subject -- the jobs sentence -- and it is the first visible text.
      expect(stripTags(out.html).startsWith(out.subject)).toBe(true)
      expect(out.html.indexOf(out.subject)).toBeLessThan(out.html.indexOf("VERIDIAN AI"))
    }
  })

  test("no variant spelling ever leaves the renderer", () => {
    const outs = [renderDigest(ownerDigest(), live), renderDigest(staffDigest(), dry)]
    for (const out of outs) {
      for (const s of [out.subject, out.html, out.text]) {
        for (const m of s.matchAll(/\bver[a-z]*\s+indian\b/gi)) expect(m[0]).toBe("VERy INDIAN")
        expect(s).not.toMatch(/\bmade\s+in\s+india\b/i)
      }
    }
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
    // Single-mailbox era (2026-09-29): the mailto is a dpdp+dsr.<ref>@veridian-aios.com
    // address (see the unsubscribeMailto test below), never the old unsubscribe@send.… one.
    const mailto = "dpdp+dsr.k3f9x2ab7q@veridian-aios.com?subject=unsubscribe"
    expect(listUnsubscribeHeaders("https://f/u?t=1", mailto)).toEqual({
      "List-Unsubscribe": `<https://f/u?t=1>, <mailto:${mailto}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    })
    expect(listUnsubscribeHeaders("https://f/u?t=1", null)["List-Unsubscribe"]).toBe("<https://f/u?t=1>")
    expect(domainOfFrom("VERIDIAN AI DPDP <dpdp@veridian-aios.com>")).toBe("veridian-aios.com")
    expect(domainOfFrom("dpdp@veridian-aios.com")).toBe("veridian-aios.com")
    // Still generic: it reports whatever domain it is given, which is what lets the Edge
    // Function warn when a stale DPDP_EMAIL_FROM secret names the old subdomain.
    expect(domainOfFrom("VERIDIAN AI DPDP <dpdp@send.veridian-aios.com>")).toBe("send.veridian-aios.com")
    expect(domainOfFrom("nonsense")).toBeNull()
  })

  test("unsubscribeMailto: one address, classified as a data request, same ref, no token, no old subdomain", () => {
    const ref = "k3f9x2ab7q"
    const mailto = unsubscribeMailto(ref)
    expect(mailto).toBe("dpdp+dsr.k3f9x2ab7q@veridian-aios.com?subject=unsubscribe")
    expect(mailto).not.toContain("send.veridian-aios.com")
    expect(mailto).not.toMatch(/^unsubscribe@/)
    // The address part (before ?) reads back, through the shared grammar, as a data
    // request tied to this ref -- the inbound classifier's highest-confidence signal.
    const parsed = parseRecipient(mailto.split("?")[0])
    expect(parsed).toEqual({ ours: true, cls: "data_request", ref })
    // Composed into the real header it stays a valid mailto: URI inside angle brackets.
    const header = listUnsubscribeHeaders("https://f/u?t=1", mailto)["List-Unsubscribe"]
    expect(header).toBe(`<https://f/u?t=1>, <mailto:${mailto}>`)
    // A malformed ref is a programming error, not something to send out.
    expect(() => unsubscribeMailto("not-a-ref")).toThrow()
  })

  test("reserved/test addresses are never deliverable; real ones are", () => {
    for (const bad of ["owner@example.test", "x@sub.example.test", "a@foo.example", "b@bar.invalid", "c@localhost", "d@example.com", "e@mail.example.org", "nonsense", "@nowhere", "f@nodot"]) {
      expect(isDeliverableAddress(bad)).toBe(false)
    }
    for (const good of ["rajat@veridian-aios.com", "CA.Partner@Firm.co.in", " owner@client-org.in "]) {
      expect(isDeliverableAddress(good)).toBe(true)
    }
  })
})

describe("drizzle/0734: the calm 'payment is due' line, carried by every e-mail of a DUE / GRACE / LOCKED account", () => {
  const line = "A gentle note: payment for this account is due. Everything keeps working while you sort it out."
  test("shown above the intro with a pay link, in the owner's and a member's e-mail, and in the statutory-only one", () => {
    for (const kind of [undefined, "statutory"] as const) {
      const out = renderDigest(digest({ billingDueLine: line }), live, kind)
      expect(out.html).toContain(line)
      expect(out.html).toContain("Pay for this account")
      expect(out.text).toContain(line)
      expect(out.html.indexOf(line)).toBeLessThan(out.html.indexOf("Here are your DPDP jobs") === -1 ? Number.MAX_SAFE_INTEGER : out.html.indexOf("Here are your DPDP jobs"))
    }
  })
  test("absent or null: nothing is added, and the digest is otherwise the same", () => {
    const plain = renderDigest(digest({}), live)
    expect(renderDigest(digest({ billingDueLine: null }), live).html).toBe(plain.html)
    expect(plain.html).not.toContain("Pay for this account")
  })
  test("it never replaces the list: every job is still there with the line present", () => {
    const withLine = renderDigest(digest({ billingDueLine: line }), live)
    const without = renderDigest(digest({}), live)
    expect(withLine.html.length).toBeGreaterThan(without.html.length)
    expect(withLine.html).toContain(without.html.slice(without.html.indexOf("<h2")))
  })
})

describe("WO-DPDP-016 §9: the billing banner, before everything else", () => {
  test("trial and awaiting_confirmation both get the banner, ahead of the intro", () => {
    for (const state of ["trial", "awaiting_confirmation"] as const) {
      const out = renderDigest(digest({ subscriptionState: state }), live)
      expect(out.html).toContain("DPDP is important")
      expect(out.text).toContain("DPDP IS IMPORTANT")
      expect(out.html.indexOf("DPDP is important")).toBeLessThan(out.html.indexOf("Here are your DPDP jobs"))
      expect(out.text.indexOf("DPDP IS IMPORTANT")).toBeLessThan(out.text.indexOf("Here are your DPDP jobs"))
    }
  })

  test("active, and an older fixture with no subscriptionState at all, never show it", () => {
    expect(renderDigest(digest({ subscriptionState: "active" }), live).html).not.toContain("DPDP is important")
    expect(renderDigest(digest({}), live).html).not.toContain("DPDP is important")
  })

  test("the banner reaches every recipient, not just the owner -- and survives the statutory-only reduction", () => {
    const ownerOut = renderDigest(digest({ subscriptionState: "trial", level: "owner", roleKind: "owner" }), live)
    expect(ownerOut.html).toContain("DPDP is important")
    const statutoryOut = renderDigest(digest({ subscriptionState: "trial" }), live, "statutory")
    expect(statutoryOut.html).toContain("DPDP is important")
  })
})
