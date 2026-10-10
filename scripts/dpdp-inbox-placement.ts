/// <reference types="bun-types" />
// WO-DPDP-014 §5 "protect the main inbox" -- the placement test, run by the
// PM: render the REAL Monday digest (supabase/functions/dpdp-monday-email/
// render.ts, pure TS) three ways and send each to a real Gmail inbox through
// the real sending domain, so Gmail's own category decision can be read
// back (INBOX vs CATEGORY_PROMOTIONS):
//   A  as shipped: brand-line footer + share ask (a decision-maker's digest)
//   B  brand-line footer only (share ask stripped)
//   C  no footer at all (the pre-WO-014 email)
// Usage: bun run scripts/dpdp-inbox-placement.ts <to-address>
// Needs RESEND_API_KEY in the environment (root .env.local). Sends exactly
// three emails, all marked [placement A|B|C] in the subject. Nothing is
// written to the database.
//
// THE TEST MAIL MUST LOOK LIKE THE REAL MAIL (single-mailbox, 2026-09-29).
// Gmail decides Inbox vs Promotions from the whole message, not just the body,
// so a placement result only means something if the envelope matches what the
// Monday digest really sends. Everything below therefore comes from the same
// helpers the product uses (supabase/functions/_shared/mail-taxonomy.ts and
// dpdp-monday-email/render.ts), never from a copy of their output:
//   From      "VERIDIAN AI DPDP <dpdp@veridian-aios.com>" (MAILBOX)
//   Reply-To  replyToAddress("monday", ref)        dpdp+mon.<ref>@veridian-aios.com
//   Subject   withSubjectPrefix("monday", ...)     "[VERIDIAN DPDP · Monday] ..."
//   Headers   outboundHeaders("monday", ref)       X-Veridian-Class / X-Veridian-Ref
//             listUnsubscribeHeaders(url, unsubscribeMailto(ref))  https + mailto
//                                                   (the data_request mailto)
// A fresh ref is made per variant, as the real send makes one per message.
// src/lib/services/dpdp-mail-edge-functions.test.ts (repo root) checks the
// payload built here against mail-outbound.ts's buildOutbound/resendPayload, so
// if the real envelope changes and this script is not updated, that test fails.
//
// NON-EXECUTING WHEN IMPORTED. The sending part runs only when this file is
// the entry point (import.meta.main); importing it -- as that test does --
// reads no argument and no environment variable, makes no request, and exits
// nothing. Only the pure builders below are exported.
import {
  listUnsubscribeHeaders, renderDigest, unsubscribeMailto, type Digest, type DigestJob, type RenderLinks,
} from "../supabase/functions/dpdp-monday-email/render"
import {
  MAILBOX, newRef, outboundHeaders, replyToAddress, withSubjectPrefix, type MailClass,
} from "../supabase/functions/_shared/mail-taxonomy"

/** The class of the mail being imitated: the Monday digest. */
export const PLACEMENT_CLASS: MailClass = "monday"
/** The visible sender of every DPDP mail. Equal to mail-outbound.ts's DEFAULT_FROM (a test checks). */
export const PLACEMENT_FROM = `VERIDIAN AI DPDP <${MAILBOX}>`

export type Variant = "A" | "B" | "C"
export type Rendered = { subject: string; html: string; text: string }

const BRAND = "VERIDIAN · VERy INDIAN — Built for India's DPDP Act. For India, by India."
const ASK = "Know a firm that needs this? Share VERIDIAN"
/** The https half of List-Unsubscribe, as the real digest carries it. */
export const PLACEMENT_UNSUBSCRIBE_URL = "https://dpdp.veridian-aios.com/unsubscribe/"
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const job = (today: string, o: Partial<DigestJob>): DigestJob => ({
  obligationId: "j", key: "k", what: "Put up a notice wherever there is a camera", part: 3, dueOn: today, daysLate: 0, late: false,
  requiredToday: false, isGroup: false, groupLabel: null, assigneeEmail: null, isMine: true, stuck: false, outsideParty: false, ...o,
})

/** The digest a decision-maker (an owner) gets, addressed to `to`. */
export function sampleDigest(to: string, today: string): Digest {
  return {
    membershipId: "m", identityId: "i", orgId: "o", orgName: "Sharma & Associates", orgProduct: "firm", email: to,
    level: "owner", roleKind: "owner", weekKey: "2026-W39", today, unsubscribed: false, statutoryOnly: false, alreadySentThisWeek: false,
    owners: [{ membershipId: "m", email: to }], coordinators: [],
    jobs: [
      job(today, { obligationId: "j1", key: "k1", what: "Put up a notice wherever there is a camera", part: 3 }),
      job(today, { obligationId: "j2", key: "k2", what: "Mask Aadhaar copies", part: 4, requiredToday: true }),
    ],
    escalatedToMe: [],
  }
}

/** The links a signed-in owner's digest carries (no action tokens: this is a look-alike, not a live send). */
export const SAMPLE_LINKS: RenderLinks = {
  signIn: "https://dpdp.veridian-aios.com/app/", actions: null, unsubscribeUrl: PLACEMENT_UNSUBSCRIBE_URL, appHome: "https://dpdp.veridian-aios.com/app/",
}

/**
 * A = the digest as rendered, B = share ask stripped, C = brand line stripped
 * as well. Throws if a variant kept something it should have lost (or lost
 * something it should have kept), so a changed template cannot silently turn
 * the experiment into three copies of the same mail.
 */
export function makeVariants(a: Rendered): Record<Variant, Rendered> {
  const b: Rendered = {
    subject: a.subject,
    html: a.html.replace(/<p[^>]*>[^<]*Know a firm that needs this\? Share VERIDIAN[\s\S]*?<\/p>/, ""),
    text: a.text.split("\n").filter((l) => !l.startsWith(ASK)).join("\n"),
  }
  const c: Rendered = {
    subject: a.subject,
    html: b.html.replace(new RegExp(`<p[^>]*>${escHtml(BRAND).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/p>`), ""),
    text: b.text.split("\n").filter((l) => l !== BRAND).join("\n"),
  }
  for (const [tag, r, must, mustNot] of [["A", a, [BRAND, ASK], []], ["B", b, [BRAND], [ASK]], ["C", c, [], [BRAND, ASK]]] as const) {
    for (const s of must) if (!r.html.includes(escHtml(s)) || !r.text.includes(s)) throw new Error(`variant ${tag} lost "${s}"`)
    for (const s of mustNot) if (r.html.includes(escHtml(s)) || r.text.includes(s)) throw new Error(`variant ${tag} still has "${s}"`)
  }
  return { A: a, B: b, C: c }
}

/** The subject the recipient sees for variant `tag`: the placement marker inside the real "[VERIDIAN DPDP · Monday]" prefix. */
export function placementSubject(tag: Variant, stamp: string, subject: string): string {
  return withSubjectPrefix(PLACEMENT_CLASS, `[placement ${tag} ${stamp}] ${subject}`)
}

/** The Resend REST body for one variant: the same shape mail-outbound.ts's resendPayload gives the real Monday send. */
export function buildPlacementPayload(o: { to: string; tag: Variant; stamp: string; ref: string; rendered: Rendered }): Record<string, unknown> {
  return {
    from: PLACEMENT_FROM,
    to: [o.to],
    reply_to: replyToAddress(PLACEMENT_CLASS, o.ref),
    subject: placementSubject(o.tag, o.stamp, o.rendered.subject),
    html: o.rendered.html,
    text: o.rendered.text,
    headers: { ...listUnsubscribeHeaders(PLACEMENT_UNSUBSCRIBE_URL, unsubscribeMailto(o.ref)), ...outboundHeaders(PLACEMENT_CLASS, o.ref) },
  }
}

async function main(): Promise<void> {
  const to = process.argv[2]
  if (!to || !to.includes("@")) { console.error("usage: bun run scripts/dpdp-inbox-placement.ts <to-address>"); process.exit(2) }
  const key = process.env.RESEND_API_KEY
  if (!key) { console.error("RESEND_API_KEY not set"); process.exit(2) }

  const today = new Date().toISOString().slice(0, 10)
  const variants = makeVariants(renderDigest(sampleDigest(to, today), SAMPLE_LINKS))
  const stamp = new Date().toISOString().slice(11, 16)
  for (const tag of ["A", "B", "C"] as const) {
    const payload = buildPlacementPayload({ to, tag, stamp, ref: newRef(), rendered: variants[tag] })
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({}))
    console.log(`variant ${tag}: ${res.status} id=${(body as { id?: string }).id ?? "?"} subject="${payload.subject as string}"`)
  }
}

if (import.meta.main) await main()
