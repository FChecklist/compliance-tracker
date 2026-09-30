// WO-DPDP-011 Step 4 -- the Monday email, rendered. Pure TypeScript: no
// Deno globals, no Supabase client, no fetch -- so `bun test` can run
// src/lib/services/dpdp-timer-render.test.ts against it and index.ts
// (Deno) can import it unchanged. Every decision about WHO is late, WHO
// is copied and WHO is told by name is made in SQL (drizzle/0606,
// dpdp.build_monday_digests) and arrives here as flags; this file only
// turns those flags into plain-English sentences. computeEscalation() is
// the TS mirror of the SQL thresholds, exported so the unit test pins the
// numbers (14/30 days, halved to 7/15 for a job required by today's law)
// and used as a fallback only when a job arrives without its `escalation`
// object.
//
// The only imports are the two PURE shared modules (no Deno, no network):
// mail-taxonomy.ts for the dpdp+<tag>.<ref>@ address grammar (used by
// unsubscribeMailto) and mail-outbound.ts for domainOfFrom, re-exported below
// so existing importers keep working and there is one implementation.
import { replyToAddress } from "../_shared/mail-taxonomy.ts"
import { domainOfFrom } from "../_shared/mail-outbound.ts"

export { domainOfFrom }

export type Escalation = {
  red: boolean
  ccCoordinator: boolean
  ownerNamed: boolean
  coordinatorNow: boolean
  relationshipOwner: boolean
  ccThresholdDays: number
  ownerThresholdDays: number
}

export type DigestJob = {
  obligationId: string
  key: string
  what: string
  part: number
  dueOn: string // YYYY-MM-DD
  daysLate: number
  late: boolean
  requiredToday: boolean
  isGroup: boolean
  groupLabel: string | null
  assigneeEmail: string | null
  isMine: boolean
  stuck: boolean
  outsideParty: boolean
  escalation?: Escalation
}

export type Contact = { membershipId: string; email: string }

export type EscalatedItem = {
  obligationId: string
  what: string
  assigneeEmail: string | null
  daysLate: number
  requiredToday: boolean
  stuck: boolean
  outsideParty: boolean
  reason: "stuck" | "late_owner" | "outside_party_silent" | "late_coordinator" | null
}

export type Digest = {
  membershipId: string
  identityId: string
  orgId: string
  orgName: string
  orgProduct: "firm" | "institution" | string
  email: string
  level: "owner" | "staff"
  roleKind: "owner" | "coord" | "staff"
  /**
   * WO-DPDP-014 §3/§4: a CA partner or manager is a decision-maker too.
   * dpdp.build_monday_digests (drizzle/0606) does not emit this today --
   * its roleKind is owner/coord/staff only -- so until a migration adds it
   * the share ask reaches owners alone. Optional so that migration needs
   * no change here.
   */
  caSub?: "partner" | "manager" | null
  /**
   * WO-DPDP-016 §9: 'trial' | 'awaiting_confirmation' | 'active', from
   * dpdp.subscription.state (drizzle/0655/0656) -- anything but 'active'
   * gets the "complete the billing" banner. Optional and treated as
   * 'active' when absent, so a caller/fixture built before this field
   * existed never starts showing the banner by surprise.
   */
  subscriptionState?: "trial" | "awaiting_confirmation" | "active"
  /**
   * WO-DPDP-016 Step 2: this person's own referral code / this org's own
   * invite code, from dpdp.build_monday_digests' new LEFT JOINs (drizzle/
   * 0657) -- null until dpdp_timer_ensure_link_codes has run for this org
   * at least once (index.ts calls it right before building the digest).
   * Optional so an older fixture/caller degrades to the bare, unpersonalised
   * public-site link rather than breaking.
   */
  referralCode?: string | null
  inviteCode?: string | null
  weekKey: string // IYYY-Wnn (IST)
  today: string // YYYY-MM-DD (IST)
  unsubscribed: boolean
  statutoryOnly: boolean
  alreadySentThisWeek: boolean
  /** Set by the sender, never by the database: nothing is due, but the person's AI changed things since the last email and they are told. */
  aiChangesOnly?: boolean
  owners: Contact[]
  coordinators: Contact[]
  jobs: DigestJob[]
  escalatedToMe: EscalatedItem[]
}

export type ActionLinks = Record<string, { done: string; cannot: string; neverHadAny: string | null }>

/**
 * The person's AI work link as it goes into THIS email (drizzle/0663). `url` is the whole link, or the {{AI_WORK_LINK}}
 * placeholder in a dry run; `level` is the authority it carries (1 = read + small edits + drafts, 0 = read only).
 */
export type AiLinkInfo = { url: string; expiresOn: string; level: 0 | 1; jobs?: number; people?: number }

/** One thing the person's AI changed since their last Monday email (dpdp_timer_ai_actions_for_digest). */
export type AiChange = {
  verb: string
  what: string | null
  value: Record<string, unknown> | null
  appliedAt: string
  /** Set only while the change can still be undone (a fresh one-time token in the URL). */
  undoUrl: string | null
}

export type RenderLinks = {
  /** The person's AI work link (Read / Edit / Work). Absent or null: none in this email, and the copy points at the page instead. */
  aiLink?: AiLinkInfo | null
  /** What their AI changed for them since the last email (Monday digest only). */
  aiChanges?: AiChange[] | null
  /** The Supabase Auth magic link (24h), or null when it could not be minted / dry run. */
  signIn: string | null
  /** Per obligationId, the one-click confirmation-page URLs; null in a dry run. */
  actions: ActionLinks | null
  /** The one-click unsubscribe URL (also used in the footer); null in a dry run. */
  unsubscribeUrl: string | null
  /** Where "Send me a new link" lives -- the app's own sign-in page. */
  appHome: string
}

export type Rendered = { subject: string; html: string; text: string }

export type EmailKind = "monday_digest" | "escalation" | "leak_clock" | "rights_clock" | "statutory"

// WO-DPDP-014 §1/§4/§5: the brand line, footer only, plain small text, on
// every email; the share ask only in a Monday digest to a decision-maker,
// never in a legal-clock email, never in the preview text. Byte-identical
// to dpdp-app/src/lib/brand.ts -- src/lib/services/dpdp-timer-render.test.ts
// imports both and asserts equality, so neither can drift.
export const BRAND_LINE_FULL = "VERIDIAN · VERy INDIAN — Built for India's DPDP Act. For India, by India."
export const BRAND_LINE_SHORT = "VERIDIAN · VERy INDIAN · For India, by India"
export const SHARE_ASK = "Know a firm that needs this? Share VERIDIAN"
export const INVITE_ASK = "Bring a colleague onto your team? Invite them to VERIDIAN"
export const PUBLIC_SITE = "https://veridian-aios.com/"

/** `?ref=`/`?join=` on the public site, or the bare site when there is no code yet (an older fixture, or dpdp_timer_ensure_link_codes hasn't reached this org). */
function personalLink(code: string | null | undefined, param: "ref" | "join"): string {
  return code ? `${PUBLIC_SITE}?${param}=${encodeURIComponent(code)}` : PUBLIC_SITE
}

function displayUrl(url: string): string {
  return url.replace(/^https:\/\//, "").replace(/\/$/, "")
}

/** WO-014 §3's table, for the email: owner/principal, CA partner, CA manager. */
export function isDecisionMaker(digest: Pick<Digest, "level" | "caSub">): boolean {
  return digest.level === "owner" || digest.caSub === "partner" || digest.caSub === "manager"
}

/** Placeholders a dry run leaves in the recorded body so no credential is ever stored. */
export const PLACEHOLDER = {
  signIn: "{{SIGN_IN_LINK}}",
  aiLink: "{{AI_WORK_LINK}}",
  done: "{{DONE_LINK}}",
  cannot: "{{CANNOT_LINK}}",
  neverHadAny: "{{NEVER_HAD_ANY_LINK}}",
  unsubscribe: "{{UNSUBSCRIBE_LINK}}",
} as const

/** WO-011 §2.5 thresholds, mirrored from dpdp.build_monday_digests. */
export function computeEscalation(input: { daysLate: number; requiredToday: boolean; stuck: boolean; outsideParty: boolean }): Escalation {
  const ccThresholdDays = input.requiredToday ? 7 : 14
  const ownerThresholdDays = input.requiredToday ? 15 : 30
  const late = input.daysLate > 0
  return {
    red: late,
    ccCoordinator: (late && input.daysLate >= ccThresholdDays) || input.stuck,
    ownerNamed: late && input.daysLate >= ownerThresholdDays,
    coordinatorNow: input.stuck,
    relationshipOwner: input.outsideParty && late,
    ccThresholdDays,
    ownerThresholdDays,
  }
}

export function escalationOf(job: DigestJob): Escalation {
  return job.escalation ?? computeEscalation(job)
}

/** Late first (most late at the top), then soonest due, then library order. */
export function sortJobs(jobs: DigestJob[]): DigestJob[] {
  return [...jobs].sort((a, b) => {
    if (b.daysLate !== a.daysLate) return b.daysLate - a.daysLate
    if (a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1
    return a.key.localeCompare(b.key)
  })
}

/**
 * An unsubscribed membership drops to statutory notices only (WO-011
 * §2.5): the jobs that today's law already requires, nothing else. The
 * legal clocks (72h leak / 90-day rights) are sent regardless and never
 * pass through here.
 */
export function statutorySubset(digest: Digest): Digest {
  return {
    ...digest,
    jobs: digest.jobs.filter((j) => j.requiredToday),
    escalatedToMe: digest.escalatedToMe.filter((e) => e.requiredToday),
  }
}

/** True when there is nothing to say -- the Edge Function skips the send. */
export function isEmpty(digest: Digest): boolean {
  return digest.jobs.length === 0 && digest.escalatedToMe.length === 0
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "22 September 2026" from "2026-09-22"; falls back to the raw string. */
export function longDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function subjectFor(digest: Digest, kind: EmailKind = "monday_digest"): string {
  const mine = digest.jobs.filter((j) => j.isMine)
  const late = digest.jobs.filter((j) => j.late)
  const escalated = digest.escalatedToMe.length
  if (kind === "statutory") {
    return `${digest.orgName}: ${plural(digest.jobs.length, "job")} required by today's law${late.length ? ` (${late.length} late)` : ""}`
  }
  if (digest.aiChangesOnly) return `${digest.orgName}: what your AI changed for you this week`
  if (digest.level === "owner") {
    const open = digest.jobs.length
    return `${digest.orgName}: DPDP this week — ${plural(open, "open job")}${late.length ? `, ${late.length} late` : ""}${escalated ? `, ${escalated} escalated to you` : ""}`
  }
  if (mine.length === 0 && escalated) {
    return `${digest.orgName}: ${plural(escalated, "job")} escalated to you as DPDP coordinator`
  }
  return `Your DPDP jobs this week — ${plural(mine.length, "job")} to do${late.length ? ` (${late.length} late)` : ""}`
}

/** The escalation sentences for one job, in the order they appear under it. */
export function escalationLines(job: DigestJob, digest: Digest): string[] {
  const e = escalationOf(job)
  const lines: string[] = []
  const coordinator = digest.coordinators[0]?.email
  const owner = digest.owners[0]?.email
  const fast = job.requiredToday ? " This job is required by today's law (SPDI Rules 2011 / Aadhaar Act), so it escalates twice as fast." : ""
  if (job.stuck && e.coordinatorNow) {
    lines.push(job.isGroup
      ? `Someone in ${job.groupLabel ?? "the group"} said they can't do this — ${coordinator ? `your DPDP coordinator (${coordinator})` : "the DPDP coordinator"} has been told.`
      : `You said you can't do this — ${coordinator ? `your DPDP coordinator (${coordinator})` : "the DPDP coordinator"} has been told.`)
  }
  if (e.red) {
    lines.push(`Late by ${plural(job.daysLate, "day")}.${fast}`)
  }
  if (e.ccCoordinator && !e.coordinatorNow) {
    lines.push(`Late ${e.ccThresholdDays} days or more — ${coordinator ? `your DPDP coordinator (${coordinator})` : "the DPDP coordinator"} has been copied.`)
  }
  if (e.ownerNamed) {
    lines.push(`Late ${e.ownerThresholdDays} days or more — ${owner ? `${digest.orgName}'s owner, ${owner},` : "the owner"} has been told.`)
  }
  if (e.relationshipOwner) {
    lines.push(`This is an outside firm's job and they have gone quiet — ${owner ? `${owner}, who looks after that relationship,` : "the owner of that relationship"} has been told.`)
  }
  return lines
}

export function reasonSentence(item: EscalatedItem, digest: Digest): string {
  const who = item.assigneeEmail ?? "nobody yet"
  const fast = item.requiredToday ? " (required by today's law — escalates twice as fast)" : ""
  switch (item.reason) {
    case "stuck":
      return `${who} said they can't do it — please help or reassign.`
    case "late_owner":
      return `${who} — late by ${plural(item.daysLate, "day")}${fast}. You are told by name because it has passed the owner threshold.`
    case "outside_party_silent":
      return `${who} (outside firm) has gone quiet — late by ${plural(item.daysLate, "day")}. You hold that relationship.`
    case "late_coordinator":
      return `${who} — late by ${plural(item.daysLate, "day")}${fast}. Copied to you as DPDP coordinator.`
    default:
      return `${who} — late by ${plural(item.daysLate, "day")}.`
  }
}

const SIGN_IN_COPY = "This link works for 24 hours — if it has stopped working, open the page and press 'Send me a new link'."

function button(href: string, label: string, style: "green" | "red" | "grey" | "navy"): string {
  const styles: Record<typeof style, string> = {
    green: "background:#059669;color:#fff;border:1.5px solid #059669;",
    red: "background:#fff;color:#BE123C;border:1.5px solid #FBC5CF;",
    grey: "background:#fff;color:#475569;border:1.5px solid #CBD5E1;",
    navy: "background:#1C2B3A;color:#fff;border:1.5px solid #1C2B3A;",
  }
  return `<a href="${esc(href)}" style="display:inline-block;margin:6px 8px 0 0;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;${styles[style]}">${esc(label)}</a>`
}

function jobHtml(job: DigestJob, digest: Digest, links: RenderLinks, withButtons: boolean): string {
  const e = escalationOf(job)
  const colour = e.red ? "#B91C1C" : "#1C2B3A"
  const border = e.red ? "#FCA5A5" : "#E2E8F0"
  const badge = e.red ? `<span style="color:#B91C1C;font-weight:700;">LATE</span> · ` : ""
  const who = job.isMine ? "" : ` · <span style="color:#64748B;">${esc(job.assigneeEmail ?? job.groupLabel ?? "nobody yet")}</span>`
  const lines = escalationLines(job, digest).map((l) => `<div style="color:${e.red ? "#991B1B" : "#475569"};font-size:13px;margin-top:4px;">${esc(l)}</div>`).join("")
  const a = links.actions?.[job.obligationId]
  const doneHref = a ? a.done : PLACEHOLDER.done
  const cannotHref = a ? a.cannot : PLACEHOLDER.cannot
  const neverHref = a ? a.neverHadAny : PLACEHOLDER.neverHadAny
  const buttons = withButtons && job.isMine
    ? `<div>${button(doneHref, job.isGroup ? "Done" : "Yes, it is done", "green")}${job.isGroup && neverHref ? button(neverHref, "Doesn't apply to me", "grey") : ""}${button(cannotHref, "I can't", "red")}</div>`
    : ""
  return `<div style="border:1px solid ${border};border-left:4px solid ${e.red ? "#B91C1C" : "#0E7C6E"};border-radius:8px;padding:12px 14px;margin:0 0 10px;">
  <div style="color:${colour};font-weight:600;font-size:15px;">${badge}${esc(job.what)}${who}</div>
  <div style="color:#64748B;font-size:13px;margin-top:2px;">Due ${esc(longDate(job.dueOn))}${job.isGroup ? ` · ${esc(job.groupLabel ?? "group job")}` : ""}${job.requiredToday ? " · required by today's law" : ""}</div>
  ${lines}${buttons}
</div>`
}

function jobText(job: DigestJob, digest: Digest, links: RenderLinks, withButtons: boolean): string {
  const e = escalationOf(job)
  const head = `${e.red ? "[LATE] " : ""}${job.what}${job.isMine ? "" : ` — ${job.assigneeEmail ?? job.groupLabel ?? "nobody yet"}`}`
  const meta = `  Due ${longDate(job.dueOn)}${job.isGroup ? ` · ${job.groupLabel ?? "group job"}` : ""}${job.requiredToday ? " · required by today's law" : ""}`
  const lines = escalationLines(job, digest).map((l) => `  ${l}`)
  const a = links.actions?.[job.obligationId]
  const buttons = withButtons && job.isMine
    ? [
        `  ${job.isGroup ? "Done" : "Yes, it is done"}: ${a ? a.done : PLACEHOLDER.done}`,
        ...(job.isGroup ? [`  Doesn't apply to me: ${a ? a.neverHadAny ?? "" : PLACEHOLDER.neverHadAny}`] : []),
        `  I can't: ${a ? a.cannot : PLACEHOLDER.cannot}`,
      ]
    : []
  return [head, meta, ...lines, ...buttons].join("\n")
}

// WO-014 §5: the preview text an inbox shows is the person's jobs (the
// subject line already IS that sentence), never the brand line -- a hidden
// preheader pins it, since without one Gmail/Outlook would show the first
// visible words of the body instead.
function preheader(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#fff;opacity:0;">${esc(text)}</div>`
}

/**
 * WO-014 §4/§5, widened by WO-016 §1 (every signed-in person, not just a
 * decision-maker) and by WO-016 Step 2 (invite a colleague, not just refer
 * a stranger firm): brand line always; the invite + refer asks only when
 * `shareAsk` (a Monday digest, never a statutory-only or legal-clock one).
 */
function brandFooterHtml(shareAsk: boolean, referralCode?: string | null, inviteCode?: string | null): string {
  if (!shareAsk) return `<p style="color:#94A3B8;font-size:12px;margin:0 0 4px;">${esc(BRAND_LINE_FULL)}</p>`
  const inviteUrl = personalLink(inviteCode, "join")
  const referUrl = personalLink(referralCode, "ref")
  return `<p style="color:#94A3B8;font-size:12px;margin:0 0 4px;">${esc(BRAND_LINE_FULL)}</p>
    <p style="color:#94A3B8;font-size:12px;margin:4px 0 0;">${esc(INVITE_ASK)}: <a href="${esc(inviteUrl)}" style="color:#94A3B8;">${esc(displayUrl(inviteUrl))}</a></p>
    <p style="color:#94A3B8;font-size:12px;margin:4px 0 0;">${esc(SHARE_ASK)}: <a href="${esc(referUrl)}" style="color:#94A3B8;">${esc(displayUrl(referUrl))}</a></p>`
}
function brandFooterText(shareAsk: boolean, referralCode?: string | null, inviteCode?: string | null): string[] {
  if (!shareAsk) return [BRAND_LINE_FULL]
  return [BRAND_LINE_FULL, `${INVITE_ASK}: ${personalLink(inviteCode, "join")}`, `${SHARE_ASK}: ${personalLink(referralCode, "ref")}`]
}

function shell(title: string, bodyHtml: string, links: RenderLinks, kind: EmailKind, preview: string, shareAsk = false, referralCode?: string | null, inviteCode?: string | null): string {
  const signIn = links.signIn ?? PLACEHOLDER.signIn
  const unsubscribe = links.unsubscribeUrl ?? PLACEHOLDER.unsubscribe
  const legal = kind === "leak_clock" || kind === "rights_clock"
  const footerUnsub = legal
    ? `This is a statutory notice; it is sent even if you have stopped the weekly email.`
    : `<a href="${esc(unsubscribe)}" style="color:#94A3B8;">Stop these weekly emails</a> — you will still get statutory notices.`
  return `<!DOCTYPE html><html lang="en"><body style="font-family:Inter,Arial,sans-serif;background:#FFFDF9;margin:0;padding:32px 16px;">
${preheader(preview)}
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #E2E8F0;overflow:hidden;">
  <div style="background:#1C2B3A;padding:20px 24px;"><span style="color:#F5820A;font-size:18px;font-weight:700;letter-spacing:-0.5px;">VERIDIAN AI</span> <span style="color:#CBD5E1;font-size:13px;margin-left:8px;">DPDP</span></div>
  <div style="padding:24px;">
    <h1 style="color:#1C2B3A;margin:0 0 12px;font-size:20px;">${esc(title)}</h1>
    ${bodyHtml}
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #E2E8F0;">
      ${button(signIn, "Open my page", "navy")}
      <div style="color:#64748B;font-size:12px;margin-top:8px;">${esc(SIGN_IN_COPY)}</div>
      <div style="color:#64748B;font-size:12px;margin-top:4px;">Or go to <a href="${esc(links.appHome)}" style="color:#0E7C6E;">${esc(links.appHome)}</a> and press "Send me a new link".</div>
    </div>
  </div>
  <div style="background:#F8FAFC;padding:14px 24px;border-top:1px solid #E2E8F0;">
    ${brandFooterHtml(shareAsk && !legal, referralCode, inviteCode)}
    <p style="color:#94A3B8;font-size:12px;margin:4px 0 0;">VERIDIAN AI — One Portal. One Truth. · ${footerUnsub}</p>
  </div>
</div>
</body></html>`
}

function textShell(title: string, bodyText: string, links: RenderLinks, kind: EmailKind, shareAsk = false, referralCode?: string | null, inviteCode?: string | null): string {
  const signIn = links.signIn ?? PLACEHOLDER.signIn
  const unsubscribe = links.unsubscribeUrl ?? PLACEHOLDER.unsubscribe
  const legal = kind === "leak_clock" || kind === "rights_clock"
  const footer = legal
    ? "This is a statutory notice; it is sent even if you have stopped the weekly email."
    : `Stop these weekly emails (statutory notices continue): ${unsubscribe}`
  return [
    `VERIDIAN AI — DPDP`,
    ``,
    title,
    ``,
    bodyText,
    ``,
    `Open my page: ${signIn}`,
    SIGN_IN_COPY,
    `Or go to ${links.appHome} and press "Send me a new link".`,
    ``,
    ...brandFooterText(shareAsk && !legal, referralCode, inviteCode),
    footer,
  ].join("\n")
}

// ---------------------------------------------------------------------------
// The three ways to do the week's jobs, led by the AI work link (owner, 2026-09-30).
// ---------------------------------------------------------------------------

const AI_NAMES = "ChatGPT, Claude, Gemini, Grok, DeepSeek"

/** Same line the in-app Copy-link screen shows (dpdp-app/src/lib/ai-work-link.ts aiWorkLinkWarningSentence, WO-013 §1.1). Keep the two in step. */
export function aiLinkWarningSentence(jobs: number, people: number): string {
  return `This link lets an AI assistant read your VERIDIAN view: ${jobs} jobs and the names and emails of ${people} people. When you paste it into an AI assistant, that information is sent to the company that runs it — for example, ChatGPT is run by a US company.`
}

function aiLinkWhatItCan(level: 0 | 1): string {
  return level === 1
    ? "It can read your jobs and make small changes for you directly — add a note, change a due date, give a job to someone already on your team, or mark a job not applicable. Each change is recorded as made by you via your AI assistant and listed in your next Monday email. Anything with legal weight, such as marking a job done, it only prepares as a draft: you confirm it with one tap."
    : "It can read your jobs and report on them. It cannot change anything."
}

/**
 * `hasButtons`: the person has jobs of their own, so there are "Yes, it is done" buttons under them. An owner or coordinator who
 * only oversees other people's jobs has none, and then there is no "do it right here" option to offer.
 */
function aiOptions(digest: Digest, links: RenderLinks, hasButtons = true): { html: string; text: string[] } {
  const ai = links.aiLink ?? null
  const heading = hasButtons ? "Three ways to do this" : "Two ways to do this"
  const opt = (label: string, rest: string, last = false) =>
    `<p style="margin:0 0 ${last ? 0 : 6}px;"><strong>${esc(label)}</strong> ${esc(rest)}</p>`
  if (!ai) {
    // No link could be minted (or none was asked for): point at the page.
    const l1 = "Option 1 — Relax, let an AI do it for you."
    const r1 = `Open your page below, copy your AI Work link, and paste it into any AI you use (${AI_NAMES}).`
    const rows: Array<[string, string]> = [[l1, r1]]
    if (hasButtons) rows.push(["Option 2 — Do it right here.", "Use the buttons under your jobs below, in this email."])
    rows.push([`Option ${rows.length + 1} — Do it yourself.`, "Open your page below and go through it by hand — most weeks, a couple of minutes."])
    return {
      html: `<h2 style="color:#1C2B3A;font-size:15px;margin:16px 0 8px;">${heading}</h2><div style="color:#475569;font-size:13px;line-height:1.6;margin:0 0 16px;">` +
        rows.map(([l, r], i) => opt(l, r, i === rows.length - 1)).join("") + `</div>`,
      text: [heading.toUpperCase(), ...rows.map(([l, r]) => `${l} ${r}`), ""],
    }
  }
  const jobs = ai.jobs ?? digest.jobs.length
  const people = ai.people ?? new Set(digest.jobs.map((j) => (j.assigneeEmail ?? "").toLowerCase()).filter(Boolean)).size + 1
  const expires = longDate(ai.expiresOn)
  const ask = "Please open this link and help me finish my DPDP jobs for this week:"
  const l1 = "Option 1 — Relax, let an AI do it for you."
  const r1 = `Copy the box below and paste it into any AI you use (${AI_NAMES}). It reads your DPDP jobs, does the small updates for you, and gets anything that needs your sign-off ready — so all you do is tap once to confirm.`
  const fine = `${aiLinkWarningSentence(jobs, people)} ${aiLinkWhatItCan(ai.level)} The link stops working on ${expires}; next Monday's email brings a fresh one. Keep it private, paste it only into an AI you trust, and do not forward this email.`
  const later: Array<[string, string]> = []
  if (hasButtons) later.push(["Option 2 — Do it right here.", "Press the button under a job when it is done, or “I can't” if you are stuck. One tap, no sign-in."])
  later.push([`Option ${later.length + 2} — Do it yourself.`, "Open your page (the button at the bottom) and go through everything by hand — most weeks, a couple of minutes."])
  const html =
    `<h2 style="color:#1C2B3A;font-size:15px;margin:16px 0 8px;">${heading}</h2>` +
    `<div style="color:#475569;font-size:13px;line-height:1.6;margin:0 0 16px;">` +
    `<p style="margin:0 0 8px;"><strong>${esc(l1)}</strong> ${esc(r1)}</p>` +
    `<div style="background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;padding:12px 14px;margin:0 0 8px;">` +
    `<div style="color:#64748B;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 6px;">Your AI Work link — copy and paste into your AI</div>` +
    `<div style="color:#1C2B3A;font-size:13px;line-height:1.5;word-break:break-all;-webkit-user-select:all;user-select:all;">${esc(ask)} ${esc(ai.url)}</div></div>` +
    `<p style="color:#64748B;font-size:12px;margin:0 0 10px;">${esc(fine)}</p>` +
    later.map(([l, r], i) => opt(l, r, i === later.length - 1)).join("") +
    `</div>`
  const text = [
    heading.toUpperCase(),
    `${l1} ${r1}`,
    "",
    "  YOUR AI WORK LINK -- copy everything on the next line and paste it into your AI:",
    `  ${ask} ${ai.url}`,
    "",
    fine,
    "",
    ...later.map(([l, r]) => `${l} ${r}`),
    "",
  ]
  return { html, text }
}

const oneLine = (v: unknown, max = 120): string => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** "Added a note to “Write down where…”: “called the vendor”" -- one plain sentence per change. */
export function aiChangeSentence(c: AiChange): string {
  const job = c.what ? `“${oneLine(c.what, 80)}”` : "a job"
  const v = c.value ?? {}
  switch (c.verb) {
    case "NOTE": return `Added a note to ${job}: “${oneLine(v.text)}”`
    case "SET_DUE": return `Moved the due date of ${job} to ${oneLine(v.dueOn, 20)}`
    case "ASSIGN": return `Gave ${job} to ${oneLine(v.email, 80)}`
    case "MARK_NA": return `Marked ${job} not applicable: “${oneLine(v.reason)}”`
    default: return `${oneLine(c.verb, 30)} on ${job}`
  }
}

function aiChangesSection(changes: AiChange[]): { html: string; text: string[] } | null {
  if (!changes.length) return null
  const title = `What your AI changed for you (${changes.length})`
  const note = "These were made through your AI Work link since your last email, and are recorded in your history as made by you via your AI assistant. If any is wrong, open your page to put it right."
  const rows = changes.slice(0, 20)
  const more = changes.length - rows.length
  const line = (c: AiChange) => `${aiChangeSentence(c)} — ${longDate(istYmd(c.appliedAt))}`
  const html =
    `<h2 style="color:#1C2B3A;font-size:15px;margin:20px 0 8px;">${esc(title)}</h2>` +
    `<p style="color:#64748B;font-size:12px;margin:0 0 8px;">${esc(note)}</p>` +
    rows.map((c) => `<div style="border-left:4px solid #0E7C6E;padding:6px 12px;margin:0 0 8px;color:#334155;font-size:13px;">${esc(line(c))}${c.undoUrl ? ` <a href="${esc(c.undoUrl)}" style="color:#0E7C6E;">Undo</a>` : ""}</div>`).join("") +
    (more > 0 ? `<p style="color:#64748B;font-size:12px;margin:0 0 8px;">…and ${more} more in your history.</p>` : "")
  const text = [
    title.toUpperCase(),
    note,
    ...rows.map((c) => `  ${line(c)}${c.undoUrl ? `\n    Undo: ${c.undoUrl}` : ""}`),
    ...(more > 0 ? [`  ...and ${more} more in your history.`] : []),
    "",
  ]
  return { html, text }
}

/** YYYY-MM-DD in India Standard Time for an ISO instant. */
export function istYmd(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "1970-01-01"
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10)
}

/**
 * The Monday email for ONE membership. `kind` is 'statutory' when the
 * digest has already been reduced by statutorySubset(); the copy says so.
 */
export function renderDigest(digest: Digest, links: RenderLinks, kind: "monday_digest" | "statutory" = "monday_digest"): Rendered {
  const jobs = sortJobs(digest.jobs)
  const mine = jobs.filter((j) => j.isMine)
  const others = jobs.filter((j) => !j.isMine)
  const subject = subjectFor(digest, kind)
  const weekOf = longDate(digest.today)
  // WO-DPDP-016 Step 2 (Owner feedback): lead every real Monday digest with
  // why this matters and how little it costs, before the per-audience
  // sentence -- never for the statutory-only view, which is already a bare,
  // must-do list and stays that way.
  const urgency = "DPDP is the law, and the penalties for getting it wrong are steep. The good news: most weeks, this takes under 5 minutes."
  const intro = kind === "statutory"
    ? `You have stopped the weekly email, so this only lists what today's law already requires of you at ${digest.orgName}.`
    : digest.aiChangesOnly
      ? `Nothing needs you at ${digest.orgName} this week. Your AI assistant made some changes for you since your last email, and they are listed below so nothing is a surprise.`
    : digest.level === "owner"
      ? `${urgency} Here is where ${digest.orgName} stands on DPDP for the week of ${weekOf}. Late jobs are at the top, in red. Everyone with a job has had their own email; nothing here needs you unless it is escalated to you below.`
      : `${urgency} Here are your DPDP jobs at ${digest.orgName} for the week of ${weekOf}. Late ones are at the top, in red. When a job is done, press the green button — that is all.`

  const htmlParts: string[] = []
  const textParts: string[] = []

  // WO-DPDP-016 §9: "DPDP is important -- complete the billing", ahead of
  // everything else, for as long as the org's subscription isn't
  // 'active' -- a nag, not a gate (§7-8: access never changes). Absent
  // subscriptionState (an older fixture, or a caller that predates
  // drizzle/0655/0656) is treated as active, i.e. no banner.
  if (digest.subscriptionState && digest.subscriptionState !== "active") {
    const banner = "DPDP is important — complete the billing."
    htmlParts.push(`<p style="background:#FEF3C7;color:#92400E;font-weight:700;font-size:14px;line-height:1.5;margin:0 0 16px;padding:10px 14px;border-radius:8px;">${esc(banner)}</p>`)
    textParts.push(banner.toUpperCase(), "")
  }

  htmlParts.push(`<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">${esc(intro)}</p>`)
  textParts.push(intro, "")

  // Owner (2026-09-30): the AI work link goes IN the email, so most people never
  // open the page at all -- they copy it, paste it into their AI, and the work
  // is done. Option 1 is that; Option 2 is the buttons under each job; Option 3
  // is the page, for the rare week they want to go through it by hand. Never for
  // the statutory-only view (nothing to "do" there but read the list).
  if (kind !== "statutory") {
    if (!digest.aiChangesOnly) {
      const opts = aiOptions(digest, links, mine.length > 0)
      htmlParts.push(opts.html)
      textParts.push(...opts.text)
    }
    const changes = aiChangesSection(links.aiChanges ?? [])
    if (changes) { htmlParts.push(changes.html); textParts.push(...changes.text) }
  }

  if (mine.length) {
    htmlParts.push(`<h2 style="color:#1C2B3A;font-size:15px;margin:16px 0 8px;">Your jobs (${mine.length})</h2>`)
    textParts.push(`YOUR JOBS (${mine.length})`)
    for (const j of mine) { htmlParts.push(jobHtml(j, digest, links, true)); textParts.push(jobText(j, digest, links, true), "") }
  } else if (digest.level !== "owner" && kind !== "statutory" && !digest.aiChangesOnly) {
    htmlParts.push(`<p style="color:#475569;font-size:14px;">Nothing for you this week. You will get an email if anything new comes up.</p>`)
    textParts.push("Nothing for you this week. You will get an email if anything new comes up.", "")
  }

  if (digest.escalatedToMe.length) {
    const role = digest.level === "owner" ? "owner" : "DPDP coordinator"
    htmlParts.push(`<h2 style="color:#B91C1C;font-size:15px;margin:20px 0 8px;">Escalated to you as ${esc(role)} (${digest.escalatedToMe.length})</h2>`)
    textParts.push(`ESCALATED TO YOU AS ${role.toUpperCase()} (${digest.escalatedToMe.length})`)
    for (const item of digest.escalatedToMe) {
      const line = `${item.what} — ${reasonSentence(item, digest)}`
      htmlParts.push(`<div style="border-left:4px solid #B91C1C;padding:6px 12px;margin:0 0 8px;color:#991B1B;font-size:13px;">${esc(line)}</div>`)
      textParts.push(`  ${line}`)
    }
    textParts.push("")
  }

  if (others.length) {
    htmlParts.push(`<h2 style="color:#1C2B3A;font-size:15px;margin:20px 0 8px;">Everyone else's open jobs (${others.length})</h2>`)
    textParts.push(`EVERYONE ELSE'S OPEN JOBS (${others.length})`)
    for (const j of others) { htmlParts.push(jobHtml(j, digest, links, false)); textParts.push(jobText(j, digest, links, false), "") }
  }

  const title = digest.aiChangesOnly ? "What your AI changed for you" : digest.level === "owner" ? `${digest.orgName} — DPDP this week` : "Your DPDP jobs this week"
  // WO-014 §4, widened by WO-016 §1: the invite + refer asks reach every
  // signed-in person in a real Monday digest now, not just a decision-maker
  // (isDecisionMaker is kept, exported, for callers that still care who a
  // "decision-maker" is -- it no longer gates this footer).
  const shareAsk = kind === "monday_digest"
  return {
    subject,
    html: shell(title, htmlParts.join("\n"), links, kind, subject, shareAsk, digest.referralCode, digest.inviteCode),
    text: textShell(title, textParts.join("\n"), links, kind, shareAsk, digest.referralCode, digest.inviteCode),
  }
}

export type LegalRecipient = { membershipId: string; identityId: string; email: string; role: "owner" | "coordinator" }

export type LeakClock = {
  breachId: string
  orgId: string
  orgName: string
  becameAwareAt: string
  deadlineAt: string
  hoursLeft: number
  boardNotified: boolean
  individualsNotified: boolean
  scopePersonCount: number | null
  periodKey: string
  recipients: LegalRecipient[]
}

export type RightsClock = {
  requestId: string
  ref: string
  kind: string
  orgId: string
  orgName: string
  receivedAt: string
  dueAt: string
  daysLeft: number
  periodKey: string
  recipients: LegalRecipient[]
}

export type LegalClocks = { day: string; leaks: LeakClock[]; rights: RightsClock[] }

export function renderLeakClock(item: LeakClock, recipient: LegalRecipient, links: RenderLinks): Rendered {
  const overdue = item.hoursLeft <= 0
  const left = overdue ? `The 72-hour clock ran out ${Math.abs(item.hoursLeft).toFixed(0)} hours ago.` : `${item.hoursLeft.toFixed(0)} hours left on the 72-hour clock.`
  const todo = [
    !item.boardNotified ? "tell the Data Protection Board" : null,
    !item.individualsNotified ? "tell the people affected" : null,
  ].filter(Boolean).join(" and ")
  const subject = `${overdue ? "OVERDUE" : "72-hour clock"}: data leak at ${item.orgName} — ${todo}`
  const body = `A data leak was recorded at ${item.orgName}${item.scopePersonCount ? ` (about ${item.scopePersonCount} people)` : ""}. ${left} Still to do: ${todo}. Open the page, do it, and mark it done there — this notice repeats daily until it is.`
  const title = overdue ? "The 72-hour leak clock has run out" : "A data leak is on its 72-hour clock"
  const html = `<p style="color:#991B1B;font-size:14px;line-height:1.6;margin:0 0 12px;">${esc(body)}</p><p style="color:#64748B;font-size:13px;">Sent to you as ${esc(recipient.role)}.</p>`
  return { subject, html: shell(title, html, links, "leak_clock", subject), text: textShell(title, `${body}\n\nSent to you as ${recipient.role}.`, links, "leak_clock") }
}

export function renderRightsClock(item: RightsClock, recipient: LegalRecipient, links: RenderLinks): Rendered {
  const overdue = item.daysLeft < 0
  const left = overdue ? `It passed its 90-day limit ${Math.abs(item.daysLeft)} day(s) ago.` : `${item.daysLeft} day(s) left of the 90-day limit.`
  const subject = `${overdue ? "OVERDUE" : "Rights request"} ${item.ref} at ${item.orgName} — ${overdue ? "past its 90-day limit" : `${item.daysLeft} day(s) left`}`
  const body = `A ${item.kind} request (${item.ref}) received on ${esc(item.receivedAt.slice(0, 10))} has not been answered. ${left} Open the page and answer it — this notice repeats daily until it is answered.`
  const title = overdue ? "A rights request is past its 90-day limit" : "A rights request is close to its 90-day limit"
  const html = `<p style="color:#991B1B;font-size:14px;line-height:1.6;margin:0 0 12px;">${esc(body)}</p><p style="color:#64748B;font-size:13px;">Sent to you as ${esc(recipient.role)}.</p>`
  return { subject, html: shell(title, html, links, "rights_clock", subject), text: textShell(title, `${body}\n\nSent to you as ${recipient.role}.`, links, "rights_clock") }
}

/**
 * True only for an address a real mailbox could sit behind. Refuses the
 * RFC 2606 / RFC 6761 reserved names (.test, .example, .invalid,
 * .localhost, example.com/net/org) so the seeded @example.test tenants this
 * repo's DB-gated tests create can never turn into real, bouncing sends the
 * moment RESEND_API_KEY is set. Such recipients are recorded as skipped,
 * never delivered.
 */
export function isDeliverableAddress(email: string): boolean {
  const at = email.trim().toLowerCase().lastIndexOf("@")
  if (at <= 0) return false
  const domain = email.trim().toLowerCase().slice(at + 1)
  if (!domain || !domain.includes(".")) return false
  if (/(^|\.)(test|example|invalid|localhost)$/.test(domain)) return false
  if (/^(example\.(com|net|org))$/.test(domain) || /\.example\.(com|net|org)$/.test(domain)) return false
  return true
}

/** Builds the RFC 8058 pair. The https URL must accept a POST, so it is the Edge Function's own unsubscribe path, which 302s a human GET to the static page. */
export function listUnsubscribeHeaders(httpsUrl: string, mailto: string | null): Record<string, string> {
  return {
    "List-Unsubscribe": mailto ? `<${httpsUrl}>, <mailto:${mailto}>` : `<${httpsUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  }
}

/**
 * The mailto half of List-Unsubscribe: a fresh message to the ONE public
 * mailbox, addressed dpdp+dsr.<ref>@veridian-aios.com so the inbound
 * classifier reads it as a data request (a legal-clock class -- ticketed and
 * acknowledged, never dropped) from the address alone, and `ref` (the SAME ref
 * as this email's Reply-To) finds the membership it came from. The old mailto
 * put the one-click token in the subject; that is deliberately gone -- the ref
 * does the finding, and a live credential has no business in a mail header.
 *
 * Honest limit: an unsubscribe BY EMAIL is answered by a person working the
 * ticket, not applied automatically. The RFC 8058 https POST in the same
 * header (listUnsubscribeHeaders) is the automatic path and is untouched.
 */
export function unsubscribeMailto(ref: string): string {
  return `${replyToAddress("data_request", ref)}?subject=unsubscribe`
}
