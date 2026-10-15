// DPDP audit trail -- the daily job (owner spec 2026-10-06, items 5 and 6). PURE apart from the injected `Deps`. Posted once a day by pg_cron (drizzle/0731,
// job `dpdp-audit-daily`, 00:20 UTC) with the Vault bearer, exactly like dpdp-operator-digest.
//
//   1. HEADS     record each organisation's chain head for yesterday (UTC) and e-mail it to that organisation's owner(s): the hash and counts only -- no event, no name,
//                no personal data. If the chain did not move since the last recorded head, it is recorded and nothing is sent.
//   2. NOTICES   day 335 of a row's life: the owner, the head(s) of department and each person who acted that day get ONE short e-mail with a link and nothing else (no
//                log content, no counts of what they did). The 30-day masked download window runs from there. A person is mailed at most once in 7 days (the database
//                leaves out anyone mailed more recently), however many day-batches of their log fall due, so a busy account is not mailed every day.
//   3. DELETION  day 365: for each organisation with no legal hold, the database writes anonymised statistics and a permanent deletion certificate, moves the chain's anchor,
//                and deletes the expired prefix. A day whose notice never went out waits (up to day 395) so a missed e-mail cannot shorten the window.
// Each step is independent: one failing never stops the others, and the JSON answer reports every count and failure.
import { sha256Hex } from "../_shared/audit/chain.ts"

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>
export type Deps = {
  rpc: Rpc
  /** Send one plain mail. Throws on failure. null = mail is not configured (dry run: nothing is marked as sent). */
  send: ((to: string, subject: string, text: string, html: string, idempotencyKey: string) => Promise<void>) | null
  appOrigin: string
  now: () => number
}

export type Head = { orgId: string; orgName: string | null; headDate: string; headHash: string; rowCount: number; lastSeq: number; ownerEmails: string[] }
export type NoticeItem = { orgId: string; orgName: string | null; rowDay: string; ageDays: number; purgeOn: string; rows: number; recipients: string[] }

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The daily head e-mail: the hash and nothing else about the log. */
export function headMail(h: Head): { subject: string; text: string; html: string } {
  const org = h.orgName ?? "your organisation"
  const text = [
    `Audit log chain hash for ${org}, end of ${h.headDate} (UTC).`,
    ``,
    `Chain hash: ${h.headHash}`,
    `Entries in the log up to that day: ${h.rowCount}`,
    ``,
    `Keep this e-mail. If the log is ever questioned, this hash is what the log must still add up to.`,
    `It contains no personal data and no log content.`,
  ].join("\n")
  const html = `<p>Audit log chain hash for <b>${esc(org)}</b>, end of ${esc(h.headDate)} (UTC).</p><p style="font-family:monospace;word-break:break-all">Chain hash: ${esc(h.headHash)}</p><p>Entries in the log up to that day: ${h.rowCount}</p><p>Keep this e-mail. If the log is ever questioned, this hash is what the log must still add up to. It contains no personal data and no log content.</p>`
  return { subject: `DPDP audit log: chain hash for ${h.headDate}`, text, html }
}

/** The day-335 notice: a link only. It deliberately says nothing about what is in the log, how many entries there are, or who did what. */
export function noticeMail(appOrigin: string, purgeOn: string): { subject: string; text: string; html: string } {
  const link = `${appOrigin.replace(/\/+$/, "")}/app/#audit-log`
  const text = `Some of your DPDP audit log will be deleted on ${purgeOn}. You can download a masked copy until then, signed in:\n\n${link}\n`
  const html = `<p>Some of your DPDP audit log will be deleted on ${esc(purgeOn)}. You can download a masked copy until then, signed in:</p><p><a href="${esc(link)}">${esc(link)}</a></p>`
  return { subject: "Your DPDP audit log: download before it is deleted", text, html }
}

/** One e-mail per person, however many day-batches fall due for them in this run (the earliest deletion date is the one that matters). */
export function groupNotices(items: ReadonlyArray<NoticeItem>): Map<string, { purgeOn: string; keys: Array<{ orgId: string; rowDay: string }> }> {
  const by = new Map<string, { purgeOn: string; keys: Array<{ orgId: string; rowDay: string }> }>()
  for (const it of items) {
    for (const raw of it.recipients) {
      const to = raw.trim().toLowerCase()
      if (!to) continue
      const cur = by.get(to) ?? { purgeOn: it.purgeOn, keys: [] }
      if (it.purgeOn < cur.purgeOn) cur.purgeOn = it.purgeOn
      cur.keys.push({ orgId: it.orgId, rowDay: it.rowDay })
      by.set(to, cur)
    }
  }
  return by
}

// reserved domains (RFC 2606): example, example.com / .org / .net, .test, .invalid, .localhost -- the same guard dpdp-monday-email and dpdp-lifecycle-email use
const reserved = /(^|\.)example(\.[a-z]+)?$|(^|\.)(test|invalid|localhost)$/i
export const isDeliverable = (a: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a) && !reserved.test(a.split("@")[1] ?? "")

export type Report = {
  dryRun: boolean
  day: string
  heads: { recorded: number; emailed: number; failed: number }
  notices: { dueBatches: number; emailsSent: number; emailsFailed: number; batchesMarked: number }
  purges: { orgs: number; purged: number; rows: number; failed: number }
  auditFaultsLastDay: number
  errors: string[]
}

export async function runDaily(d: Deps): Promise<Report> {
  const rep: Report = { dryRun: !d.send, day: new Date(d.now()).toISOString().slice(0, 10), heads: { recorded: 0, emailed: 0, failed: 0 }, notices: { dueBatches: 0, emailsSent: 0, emailsFailed: 0, batchesMarked: 0 }, purges: { orgs: 0, purged: 0, rows: 0, failed: 0 }, auditFaultsLastDay: 0, errors: [] }

  // 1. heads
  try {
    const r = await d.rpc("dpdp_audit_record_heads", { p_day: null })
    if (r.error) throw new Error(r.error.message)
    const data = r.data as { heads: Head[]; failures?: number }
    rep.auditFaultsLastDay = Number(data.failures ?? 0)
    for (const h of data.heads) {
      rep.heads.recorded++
      const to = h.ownerEmails.filter(isDeliverable)
      if (!d.send || to.length === 0) { if (d.send && to.length === 0) rep.errors.push(`no deliverable owner address for organisation ${h.orgId}`); continue }
      const m = headMail(h)
      let ok = 0
      for (const addr of to) {
        try { await d.send(addr, m.subject, m.text, m.html, `dpdp-audit-head/${h.orgId}/${h.headDate}/${addr}`); ok++ } catch { rep.heads.failed++ }
      }
      if (ok > 0) {
        rep.heads.emailed++
        await d.rpc("dpdp_audit_mark_head_emailed", { p_org: h.orgId, p_day: h.headDate })
      }
    }
  } catch (e) {
    rep.errors.push(`heads: ${e instanceof Error ? e.message : String(e)}`)
  }

  // 2 + 3. the lifecycle plan
  type Plan = { notices: NoticeItem[]; purges: Array<{ orgId: string; throughDay: string }> }
  let plan = null as Plan | null
  try {
    const r = await d.rpc("dpdp_audit_lifecycle_plan", { p_today: null })
    if (r.error) throw new Error(r.error.message)
    plan = r.data as Plan
  } catch (e) {
    rep.errors.push(`plan: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (plan) {
    rep.notices.dueBatches = plan.notices.length
    const grouped = groupNotices(plan.notices)
    const failedFor = new Set<string>()
    const sentKeys = new Set<string>()
    const sentEmails = new Map<string, string[]>() // batch key -> the people actually reached for it
    for (const [to, g] of grouped) {
      if (!d.send || !isDeliverable(to)) continue
      const m = noticeMail(d.appOrigin, g.purgeOn)
      try {
        const keyHash = (await sha256Hex(g.keys.map((k) => `${k.orgId}:${k.rowDay}`).sort().join(","))).slice(0, 24)
        await d.send(to, m.subject, m.text, m.html, `dpdp-audit-notice/${to}/${keyHash}`)
        rep.notices.emailsSent++
        for (const k of g.keys) {
          const key = `${k.orgId}|${k.rowDay}`
          sentKeys.add(key)
          sentEmails.set(key, [...(sentEmails.get(key) ?? []), to])
        }
      } catch {
        rep.notices.emailsFailed++
        for (const k of g.keys) failedFor.add(`${k.orgId}|${k.rowDay}`)
      }
    }
    // A batch is marked "noticed" once at least one recipient was reached and none of its notices failed to send; a failed one is offered again tomorrow.
    if (d.send) {
      for (const n of plan.notices) {
        const key = `${n.orgId}|${n.rowDay}`
        const reachable = n.recipients.some((r) => isDeliverable(r.trim().toLowerCase()))
        if (!failedFor.has(key) && (sentKeys.has(key) || !reachable)) {
          // Nobody reachable at all: mark it so the deletion rule (day 365, or day 395 at the latest) is not held up by an address that will never work.
          const m = await d.rpc("dpdp_audit_mark_notice_sent", { p_org: n.orgId, p_row_day: n.rowDay, p_recipients: sentEmails.get(key)?.length ?? 0, p_emails: sentEmails.get(key) ?? [] })
          if (!m.error) rep.notices.batchesMarked++
        }
      }
    }

    rep.purges.orgs = plan.purges.length
    for (const p of plan.purges) {
      const r = await d.rpc("dpdp_audit_purge", { p_org: p.orgId, p_through_day: p.throughDay })
      if (r.error) { rep.purges.failed++; rep.errors.push(`purge ${p.orgId}: ${r.error.message}`); continue }
      const out = r.data as { purged: boolean; rows?: number }
      if (out.purged) { rep.purges.purged++; rep.purges.rows += Number(out.rows ?? 0) }
    }
  }
  return rep
}
