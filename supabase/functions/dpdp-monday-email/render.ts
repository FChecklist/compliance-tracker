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
  weekKey: string // IYYY-Wnn (IST)
  today: string // YYYY-MM-DD (IST)
  unsubscribed: boolean
  statutoryOnly: boolean
  alreadySentThisWeek: boolean
  owners: Contact[]
  coordinators: Contact[]
  jobs: DigestJob[]
  escalatedToMe: EscalatedItem[]
}

export type ActionLinks = Record<string, { done: string; cannot: string; neverHadAny: string | null }>

export type RenderLinks = {
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
export const PUBLIC_SITE = "https://veridian-aios.com/"

/** WO-014 §3's table, for the email: owner/principal, CA partner, CA manager. */
export function isDecisionMaker(digest: Pick<Digest, "level" | "caSub">): boolean {
  return digest.level === "owner" || digest.caSub === "partner" || digest.caSub === "manager"
}

/** Placeholders a dry run leaves in the recorded body so no credential is ever stored. */
export const PLACEHOLDER = {
  signIn: "{{SIGN_IN_LINK}}",
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

/** WO-014 §4/§5: the footer lines -- brand line always; share ask only when `shareAsk` (a Monday digest to a decision-maker). */
function brandFooterHtml(shareAsk: boolean): string {
  const ask = shareAsk
    ? `<p style="color:#94A3B8;font-size:12px;margin:4px 0 0;">${esc(SHARE_ASK)}: <a href="${esc(PUBLIC_SITE)}" style="color:#94A3B8;">${esc(PUBLIC_SITE.replace(/^https:\/\//, "").replace(/\/$/, ""))}</a></p>`
    : ""
  return `<p style="color:#94A3B8;font-size:12px;margin:0 0 4px;">${esc(BRAND_LINE_FULL)}</p>${ask}`
}
function brandFooterText(shareAsk: boolean): string[] {
  return shareAsk ? [BRAND_LINE_FULL, `${SHARE_ASK}: ${PUBLIC_SITE}`] : [BRAND_LINE_FULL]
}

function shell(title: string, bodyHtml: string, links: RenderLinks, kind: EmailKind, preview: string, shareAsk = false): string {
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
    ${brandFooterHtml(shareAsk && !legal)}
    <p style="color:#94A3B8;font-size:12px;margin:4px 0 0;">VERIDIAN AI — One Portal. One Truth. · ${footerUnsub}</p>
  </div>
</div>
</body></html>`
}

function textShell(title: string, bodyText: string, links: RenderLinks, kind: EmailKind, shareAsk = false): string {
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
    ...brandFooterText(shareAsk && !legal),
    footer,
  ].join("\n")
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
  const intro = kind === "statutory"
    ? `You have stopped the weekly email, so this only lists what today's law already requires of you at ${digest.orgName}.`
    : digest.level === "owner"
      ? `Here is where ${digest.orgName} stands on DPDP for the week of ${weekOf}. Late jobs are at the top, in red. Everyone with a job has had their own email; nothing here needs you unless it is escalated to you below.`
      : `Here are your DPDP jobs at ${digest.orgName} for the week of ${weekOf}. Late ones are at the top, in red. When a job is done, press the green button — that is all.`

  const htmlParts: string[] = [`<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">${esc(intro)}</p>`]
  const textParts: string[] = [intro, ""]

  if (mine.length) {
    htmlParts.push(`<h2 style="color:#1C2B3A;font-size:15px;margin:16px 0 8px;">Your jobs (${mine.length})</h2>`)
    textParts.push(`YOUR JOBS (${mine.length})`)
    for (const j of mine) { htmlParts.push(jobHtml(j, digest, links, true)); textParts.push(jobText(j, digest, links, true), "") }
  } else if (digest.level !== "owner" && kind !== "statutory") {
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

  const title = digest.level === "owner" ? `${digest.orgName} — DPDP this week` : "Your DPDP jobs this week"
  // WO-014 §4: the share ask only in the Monday digest (not the statutory-
  // only one an unsubscribed person gets) and only to a decision-maker.
  const shareAsk = kind === "monday_digest" && isDecisionMaker(digest)
  return {
    subject,
    html: shell(title, htmlParts.join("\n"), links, kind, subject, shareAsk),
    text: textShell(title, textParts.join("\n"), links, kind, shareAsk),
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

/** "dpdp@send.veridian-aios.com" or "Name <dpdp@send.veridian-aios.com>" -> "send.veridian-aios.com". */
export function domainOfFrom(from: string): string | null {
  const m = /<([^>]+)>/.exec(from)
  const addr = (m ? m[1] : from).trim()
  const at = addr.lastIndexOf("@")
  return at === -1 ? null : addr.slice(at + 1)
}
