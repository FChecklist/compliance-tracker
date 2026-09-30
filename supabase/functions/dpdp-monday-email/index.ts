// WO-DPDP-011 Step 4 -- the Supabase timer's worker. pg_cron (drizzle/0606)
// posts here twice: Monday 00:30 UTC (06:00 IST) with {"job":"monday"} and
// daily 03:30 UTC (09:00 IST) with {"job":"legal_clocks"}. Vercel is not in
// the path; no browser ever calls this with anything but an unsubscribe.
//
// SECURITY MODEL
//   * Deployed with --no-verify-jwt (the cron sends a Vault secret, not a
//     Supabase JWT). The bearer is checked here: against DPDP_TIMER_SECRET
//     (constant-time) when that function secret is set, otherwise through
//     public.dpdp_timer_check_bearer (drizzle/0608, service_role only),
//     which compares sha256 digests against the SAME Vault secret the cron
//     reads -- so the function works with only the platform-injected env
//     (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) plus Vault. A missing/short
//     bearer, or no secret anywhere, refuses everything (fail closed).
//   * The service-role client is used ONLY inside this function -- never
//     shipped to a browser (WO-011 §0 limit 2). It reaches the dpdp.*
//     logic through the public.dpdp_timer_* wrappers (PostgREST cannot
//     see the dpdp schema).
//   * A person's sign-in link and one-click tokens go ONLY to that
//     person. "Coordinator copied" / "owner told" is a section in the
//     coordinator's/owner's own email, never a CC (a CC would hand one
//     person another person's credentials).
//   * ?action=unsubscribe&t=<token> is the one public path: GET redirects a
//     human to the static page (opening a link changes nothing); POST is
//     the RFC 8058 one-click, which a mail client sends on the user's
//     explicit "unsubscribe" press.
//
// DRY RUN: with no RESEND_API_KEY (or {"dryRun":true}), every email is
// rendered with placeholders in place of the sign-in link and tokens,
// recorded in dpdp.email_send as status 'dry_run' with its subject and
// body, and nothing is minted or sent. One failed send never aborts the
// run; the row is marked 'failed' with the error and the next one
// proceeds. Idempotent per (membership, ISO week): a re-run skips anyone
// already recorded for this week.
//
// ONE PUBLIC MAILBOX (2026-09-29). Every email this function sends goes out
// From "VERIDIAN AI DPDP <dpdp@veridian-aios.com>" with a Reply-To of
// dpdp+mon.<ref>@veridian-aios.com, a "[VERIDIAN DPDP · Monday]" subject
// prefix and X-Veridian-Class/-Ref headers, so a person's reply reaches the
// one inbox already labelled (supabase/functions/_shared/mail-outbound.ts,
// mail-taxonomy.ts). Each sent message also gets one dpdp.mail_outbound row
// (public.dpdp_mail_log_outbound) so a reply can be traced to the membership
// it answers. That log write is best-effort: it can never fail or delay a
// send past a few seconds (see logOutbound).
//
// TWO CLASSES. The weekly digest (and its statutory-only view for someone who has
// stopped the weekly email) goes out as class "monday". The two notices of the
// legal_clocks job -- the 72-hour data-leak clock and the 90-day rights clock --
// go out as class "clock" ("[VERIDIAN DPDP · Statutory]", Reply-To
// dpdp+clk.<ref>@), so a reply to one is filed as a reply to a statutory notice
// (ticket K-...) and not mistaken for a reply to the weekly digest. A reply that
// itself carries a data request or a grievance is raised to that class by the
// inbound classifier whichever of the two it answers. mailClassOf() below is
// the one place that maps a delivery to its class.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import {
  type ActionLinks, type AiChange, type AiLinkInfo, type Digest, type LegalClocks, type LegalRecipient, type RenderLinks, type Rendered,
  PLACEHOLDER, isDeliverableAddress, isEmpty, istYmd, listUnsubscribeHeaders, renderDigest, renderLeakClock, renderRightsClock, statutorySubset, unsubscribeMailto,
} from "./render.ts"
import { type OutboundEnvelope, buildOutbound, foreignSenderWarning, logOutbound, resendPayload, resolveFrom } from "../_shared/mail-outbound.ts"
import { type MailClass, newRef, withSubjectPrefix } from "../_shared/mail-taxonomy.ts"

const env = (k: string): string => Deno.env.get(k) ?? ""
const SUPABASE_URL = env("SUPABASE_URL")
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const TIMER_SECRET = env("DPDP_TIMER_SECRET")
const RESEND_API_KEY = env("RESEND_API_KEY")
const EMAIL_FROM = resolveFrom(env("DPDP_EMAIL_FROM"))
// A stale DPDP_EMAIL_FROM secret naming the old send. subdomain would silently override the new default.
const SENDER_WARNING = foreignSenderWarning(EMAIL_FROM)
if (SENDER_WARNING) console.warn(SENDER_WARNING)
const APP_ORIGIN = (env("APP_ORIGIN") || "https://app.veridian-aios.com").replace(/\/+$/, "")
const FUNCTION_URL = (env("DPDP_FUNCTION_URL") || `${SUPABASE_URL}/functions/v1/dpdp-monday-email`).replace(/\/+$/, "")
const ACTION_PATH = env("DPDP_ACTION_PATH") || "/act/"
const UNSUBSCRIBE_PATH = env("DPDP_UNSUBSCRIBE_PATH") || "/unsubscribe/"
// The AI work link inside the Monday email (drizzle/0663). Owner, 2026-09-30: the emailed link is READ / EDIT / WORK, which is
// level 1 (read + small edits directly; anything with legal weight is a draft the person confirms). DPDP_EMAIL_AI_LINK_ENABLED=0
// takes the link out of the email; DPDP_EMAIL_AI_LINK_LEVEL=0 makes it read-only; DPDP_EMAIL_AI_LINK_DAYS is 1, 7 or 30.
const AI_LINK_ENABLED = env("DPDP_EMAIL_AI_LINK_ENABLED") !== "0"
const AI_LINK_LEVEL: 0 | 1 = env("DPDP_EMAIL_AI_LINK_LEVEL") === "0" ? 0 : 1
const AI_LINK_DAYS = [1, 7, 30].includes(Number(env("DPDP_EMAIL_AI_LINK_DAYS"))) ? Number(env("DPDP_EMAIL_AI_LINK_DAYS")) : 7

type Summary = {
  job: string
  dryRun: boolean
  digests: number
  sent: number
  dry_run: number
  failed: number
  skipped: number
  /** Organisations the run went through (monday only). */
  orgs: number
  /** True when the time budget ran out before every organisation was done: the retry job continues it. */
  partial: boolean
  details: Array<{ membershipId: string; to: string; kind: string; status: string; error?: string }>
}

/** Keep the response (and the pg_net row that stores it) small: every failure, at most this many other lines. */
const MAX_DETAIL_LINES = 150
/** Organisations built and delivered at once. Each build is one small call; none can run past the API statement limit. */
const ORG_CONCURRENCY = 4
/** Stop starting new organisations after this long; the request itself may run to 300 s (pg_cron timeout). */
const TIME_BUDGET_MS = 110_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Env secret if set; otherwise the Vault-backed RPC (0608). Never both, never neither. */
async function bearerOk(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? ""
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  const presented = m?.[1]?.trim() ?? ""
  if (presented.length < 24) return false
  if (TIMER_SECRET) return TIMER_SECRET.length >= 24 && constantTimeEqual(presented, TIMER_SECRET)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return false
  try {
    const { data, error } = await serviceClient().rpc("dpdp_timer_check_bearer", { p_bearer: presented })
    if (error) { console.error("dpdp_timer_check_bearer failed:", error.message); return false }
    return data === true
  } catch (e) {
    console.error("dpdp_timer_check_bearer threw:", e instanceof Error ? e.message : String(e))
    return false
  }
}

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as T
}

/** Supabase Auth magic link, generated server-side (WO-011 §2.2 A). Null on failure -- the email then points at "Send me a new link". */
async function mintSignInLink(sb: SupabaseClient, email: string): Promise<string | null> {
  try {
    const { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: `${APP_ORIGIN}/app/` } })
    if (error) { console.warn(`generateLink failed for ${email}: ${error.message}`); return null }
    return data?.properties?.action_link ?? null
  } catch (e) {
    console.warn(`generateLink threw for ${email}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/** The URL a person pastes into an AI: this host's /ai/<token> (dpdp-app/functions/ai forwards it to the dpdp-ai-link function). */
function aiLinkUrl(token: string): string {
  return `${APP_ORIGIN}/ai/${token}`
}

/**
 * This person's AI work link for THIS email (dpdp_timer_mint_email_ai_link, 0663): a new one every Monday, and it retires last
 * week's emailed one. Null on any failure or when switched off -- the email then points at the page instead; a failed link never
 * stops the email.
 */
async function mintAiLink(sb: SupabaseClient, membershipId: string): Promise<AiLinkInfo | null> {
  if (!AI_LINK_ENABLED) return null
  try {
    const r = await rpc<{ token?: string; expiresAt?: string; level?: number; jobs?: number; people?: number }>(
      sb, "dpdp_timer_mint_email_ai_link", { p_membership_id: membershipId, p_level: AI_LINK_LEVEL, p_days: AI_LINK_DAYS },
    )
    if (!r || typeof r.token !== "string" || !/^[0-9a-f]{64}$/.test(r.token) || typeof r.expiresAt !== "string") return null
    return { url: aiLinkUrl(r.token), expiresOn: istYmd(r.expiresAt), level: r.level === 0 ? 0 : 1, jobs: r.jobs, people: r.people }
  } catch (e) {
    console.warn(`mintAiLink failed for ${membershipId}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/** True when this person's AI changed something (not since undone) that no email has told them about yet. Never throws. */
async function hasPendingAiChanges(sb: SupabaseClient, membershipId: string): Promise<boolean> {
  try {
    const rows = await rpc<Array<{ undoneAt: string | null }>>(sb, "dpdp_timer_ai_actions_for_digest", { p_membership_id: membershipId, p_mark: false })
    return Array.isArray(rows) && rows.some((r) => !r.undoneAt)
  } catch (e) {
    console.warn(`hasPendingAiChanges failed for ${membershipId}: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

/** What this person's AI changed since their last email (WO-013 §1.2: "shown in your next Monday email"), with a fresh undo link while one is still possible. */
async function loadAiChanges(sb: SupabaseClient, membershipId: string): Promise<AiChange[]> {
  if (!AI_LINK_ENABLED) return []
  try {
    const rows = await rpc<Array<{ actionId: string; verb: string; what: string | null; value: Record<string, unknown> | null; appliedAt: string; stillUndoable: boolean; undoneAt: string | null }>>(
      sb, "dpdp_timer_ai_actions_for_digest", { p_membership_id: membershipId, p_mark: false },
    )
    const out: AiChange[] = []
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r.undoneAt) continue // put back already: not news
      let undoUrl: string | null = null
      if (r.stillUndoable) {
        try {
          const t = await rpc<{ ok?: boolean; undoToken?: string }>(sb, "dpdp_timer_issue_undo_token", { p_action_id: r.actionId })
          if (t?.ok && typeof t.undoToken === "string") undoUrl = `${APP_ORIGIN}/app/#undo=${r.actionId}.${t.undoToken}`
        } catch (e) { console.warn(`undo token failed for ${r.actionId}: ${e instanceof Error ? e.message : String(e)}`) }
      }
      out.push({ verb: r.verb, what: r.what, value: r.value, appliedAt: r.appliedAt, undoUrl })
    }
    return out
  } catch (e) {
    console.warn(`loadAiChanges failed for ${membershipId}: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

function actionUrl(token: string): string {
  return `${APP_ORIGIN}${ACTION_PATH}#${token}`
}

function unsubscribeUrl(token: string): string {
  return `${FUNCTION_URL}?action=unsubscribe&t=${encodeURIComponent(token)}`
}

async function sendViaResend(to: string, rendered: Rendered, out: OutboundEnvelope): Promise<string> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(resendPayload(to, out, rendered)),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return String((body as { id?: string }).id ?? "")
}

type RecordResult = { id: string | null; unsubscribeToken?: string; duplicate: boolean }

/**
 * The mail class a delivery goes out as. The legal-clock notices (kind leak_clock / rights_clock, which only the
 * legal_clocks job produces) are "clock"; everything else -- the weekly digest and its statutory-only subset -- is
 * "monday".
 */
function mailClassOf(kind: Deliverable["kind"]): MailClass {
  return kind === "leak_clock" || kind === "rights_clock" ? "clock" : "monday"
}

type Deliverable = {
  orgId: string
  membershipId: string
  identityId: string
  to: string
  kind: "monday_digest" | "statutory" | "leak_clock" | "rights_clock" | "escalation"
  periodKey: string
  obligationIds: string[]
  /** Obligations the recipient may act on from this email (tokens are minted for exactly these). */
  actionableIds: string[]
  /** Nothing is due; the email exists only to tell the person what their AI changed. No new AI work link is minted for it. */
  aiChangesOnly?: boolean
  render: (links: RenderLinks) => Rendered
}

/**
 * record -> (mint links, send) -> mark. Never throws: every failure is
 * marked on the row and reported in the summary so one bad address cannot
 * stop the rest of the run.
 */
async function deliver(sb: SupabaseClient, d: Deliverable, dryRun: boolean, summary: Summary): Promise<void> {
  const cls = mailClassOf(d.kind)
  const isDigest = d.kind === "monday_digest"
  const placeholders: RenderLinks = {
    signIn: null, actions: null, unsubscribeUrl: null, appHome: `${APP_ORIGIN}/app/`,
    // A dry run shows the placeholder, never a minted credential, and reads nothing about the person's AI changes.
    aiLink: isDigest && AI_LINK_ENABLED
      ? { url: PLACEHOLDER.aiLink, expiresOn: istYmd(new Date(Date.now() + AI_LINK_DAYS * 86_400_000).toISOString()), level: AI_LINK_LEVEL }
      : null,
  }
  const base = { p_org_id: d.orgId, p_membership_id: d.membershipId, p_identity_id: d.identityId, p_obligation_ids: d.obligationIds, p_kind: d.kind, p_period_key: d.periodKey, p_to_email: d.to }

  if (dryRun) {
    try {
      const preview = d.render(placeholders)
      // The recorded subject is the one the recipient would see, prefix included.
      const rec = await rpc<RecordResult>(sb, "dpdp_timer_record_email_send", { ...base, p_subject: withSubjectPrefix(cls, preview.subject), p_status: "dry_run", p_body_text: preview.text })
      if (rec.duplicate) { summary.skipped++; summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "skipped-duplicate" }); return }
      summary.dry_run++
      summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "dry_run" })
    } catch (e) {
      summary.failed++
      summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "failed", error: e instanceof Error ? e.message : String(e) })
    }
    return
  }

  // Real send: a reserved/test address is recorded as skipped, never handed
  // to Resend (see isDeliverableAddress in render.ts).
  if (!isDeliverableAddress(d.to)) {
    summary.skipped++
    summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "skipped-test-address" })
    return
  }

  let rowId: string | null = null
  try {
    const preview = d.render(placeholders)
    const rec = await rpc<RecordResult>(sb, "dpdp_timer_record_email_send", { ...base, p_subject: withSubjectPrefix(cls, preview.subject), p_status: "queued" })
    if (rec.duplicate || !rec.id) { summary.skipped++; summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "skipped-duplicate" }); return }
    rowId = rec.id

    const signIn = await mintSignInLink(sb, d.to)
    let actions: ActionLinks | null = null
    if (d.actionableIds.length) {
      const minted = await rpc<Array<{ obligationId: string; done: string; cannot: string; neverHadAny: string | null }>>(
        sb, "dpdp_timer_issue_action_tokens", { p_membership_id: d.membershipId, p_obligation_ids: d.actionableIds, p_email_send_id: rowId },
      )
      actions = {}
      for (const t of minted) actions[t.obligationId] = { done: actionUrl(t.done), cannot: actionUrl(t.cannot), neverHadAny: t.neverHadAny ? actionUrl(t.neverHadAny) : null }
    }
    const unsub = unsubscribeUrl(rec.unsubscribeToken ?? "")
    // The AI work link goes IN the email (owner, 2026-09-30), and so does what the person's AI changed since last time.
    const aiLink = isDigest && !d.aiChangesOnly ? await mintAiLink(sb, d.membershipId) : null
    const aiChanges = isDigest ? await loadAiChanges(sb, d.membershipId) : []
    const rendered = d.render({ aiLink, aiChanges, signIn, actions, unsubscribeUrl: unsub, appHome: `${APP_ORIGIN}/app/` })
    // One ref per message. It goes in BOTH the Reply-To (class monday, or clock for a
    // legal-clock notice) and the List-Unsubscribe mailto (class data_request), so
    // either reply finds this send. RFC 8058's https one-click POST stays as it was.
    const ref = newRef()
    const out = buildOutbound(cls, rendered.subject, {
      from: EMAIL_FROM,
      ref,
      headers: listUnsubscribeHeaders(unsub, unsubscribeMailto(ref)),
    })
    const messageId = await sendViaResend(d.to, rendered, out)
    // The message has left. Log it for reply-tracing BEFORE the bookkeeping below can
    // throw, and never let the log affect the send (best-effort, bounded wait, never throws).
    await logOutbound(sb, { ref, cls, to: d.to, subject: out.subject, providerMessageId: messageId || null, membershipId: d.membershipId, orgId: d.orgId })
    await rpc(sb, "dpdp_timer_mark_email_send_result", { p_id: rowId, p_status: "sent", p_resend_message_id: messageId || null, p_error: null })
    // They are in the sent email now: stop listing them. Best-effort; a failure only means they are listed once more next Monday.
    if (aiChanges.length) {
      try { await rpc(sb, "dpdp_timer_ai_actions_for_digest", { p_membership_id: d.membershipId, p_mark: true }) } catch (e) { console.warn(`mark AI changes shown failed: ${e instanceof Error ? e.message : String(e)}`) }
    }
    summary.sent++
    summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "sent" })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    summary.failed++
    summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "failed", error: message })
    if (rowId) {
      try { await rpc(sb, "dpdp_timer_mark_email_send_result", { p_id: rowId, p_status: "failed", p_resend_message_id: null, p_error: message.slice(0, 2000) }) } catch (markErr) { console.error("mark failed:", markErr) }
    }
  }
}

/**
 * One organisation at a time (2026-09-28): the all-organisation build ran past
 * the API role's 8 s statement limit and took the whole Monday run down with
 * it (HTTP 500, pg_cron still "succeeded"). Here a failure in one organisation
 * is counted and the others carry on; the caller marks the run not-ok and the
 * retry job (drizzle/0654) goes again -- safe, a digest is unique per week.
 */
async function runMonday(sb: SupabaseClient, now: Date, orgId: string | null, dryRun: boolean): Promise<Summary> {
  const summary: Summary = { job: "monday", dryRun, digests: 0, sent: 0, dry_run: 0, failed: 0, skipped: 0, orgs: 0, partial: false, details: [] }
  const orgIds = orgId ? [orgId] : await rpc<string[]>(sb, "dpdp_timer_org_ids", { p_now: now.toISOString() })
  summary.orgs = orgIds.length
  const deadline = Date.now() + TIME_BUDGET_MS
  const queue = [...orgIds]
  const worker = async () => {
    for (;;) {
      if (Date.now() > deadline) { if (queue.length) summary.partial = true; return }
      const id = queue.shift()
      if (!id) return
      try {
        // WO-DPDP-016 Step 2: issue any missing referral/invite codes for
        // this org's active members BEFORE building its digest, so the
        // ?ref=/?join= links in the email are never a dead end for a
        // recipient who has never pressed the in-app Share/Invite button.
        // Best-effort: a failure here must not stop the org's actual
        // digest -- the email still sends, just without a personal link
        // this once (dpdp_timer_ensure_link_codes tries again next Monday).
        try {
          await rpc(sb, "dpdp_timer_ensure_link_codes", { p_org_id: id })
        } catch (e) {
          console.warn(`dpdp_timer_ensure_link_codes failed for org ${id}: ${e instanceof Error ? e.message : String(e)}`)
        }
        const digests = await rpc<Digest[]>(sb, "dpdp_timer_build_monday_digests", { p_now: now.toISOString(), p_org_id: id })
        await deliverDigests(sb, digests, dryRun, summary)
      } catch (e) {
        summary.failed++
        summary.details.push({ membershipId: "", to: "", kind: "monday_digest", status: "failed", error: `org ${id}: ${e instanceof Error ? e.message : String(e)}` })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ORG_CONCURRENCY, Math.max(1, orgIds.length)) }, worker))
  if (summary.details.length > MAX_DETAIL_LINES) {
    const failures = summary.details.filter((d) => d.status === "failed")
    summary.details = [...failures, ...summary.details.filter((d) => d.status !== "failed")].slice(0, Math.max(MAX_DETAIL_LINES, failures.length))
  }
  return summary
}

async function deliverDigests(sb: SupabaseClient, digests: Digest[], dryRun: boolean, summary: Summary): Promise<void> {
  summary.digests += digests.length
  for (const raw of digests) {
    if (raw.alreadySentThisWeek) { summary.skipped++; summary.details.push({ membershipId: raw.membershipId, to: raw.email, kind: "monday_digest", status: "skipped-already-sent" }); continue }
    const kind: "monday_digest" | "statutory" = raw.statutoryOnly ? "statutory" : "monday_digest"
    const digest = raw.statutoryOnly ? statutorySubset(raw) : raw
    let aiChangesOnly = false
    if (isEmpty(digest)) {
      // Nothing is due -- but if the person's AI changed something since the last email, WO-013 promises they are told in
      // "their next Monday email", so an email goes out for that alone (a real send only, to a real address, never a dry run).
      aiChangesOnly = kind === "monday_digest" && !dryRun && AI_LINK_ENABLED && isDeliverableAddress(digest.email) && (await hasPendingAiChanges(sb, digest.membershipId))
      if (!aiChangesOnly) { summary.skipped++; summary.details.push({ membershipId: raw.membershipId, to: raw.email, kind, status: "skipped-nothing-to-say" }); continue }
    }
    await deliver(sb, {
      orgId: digest.orgId,
      membershipId: digest.membershipId,
      identityId: digest.identityId,
      to: digest.email,
      kind,
      periodKey: digest.weekKey,
      obligationIds: digest.jobs.map((j) => j.obligationId),
      actionableIds: digest.jobs.filter((j) => j.isMine).map((j) => j.obligationId),
      aiChangesOnly,
      render: (links) => renderDigest(aiChangesOnly ? { ...digest, aiChangesOnly: true } : digest, links, kind),
    }, dryRun, summary)
  }
}

async function runLegalClocks(sb: SupabaseClient, now: Date, orgId: string | null, dryRun: boolean): Promise<Summary> {
  const summary: Summary = { job: "legal_clocks", dryRun, digests: 0, sent: 0, dry_run: 0, failed: 0, skipped: 0, orgs: 0, partial: false, details: [] }
  const clocks = await rpc<LegalClocks>(sb, "dpdp_timer_legal_clocks", { p_now: now.toISOString(), p_org_id: orgId })
  for (const leak of clocks.leaks) {
    for (const r of leak.recipients as LegalRecipient[]) {
      summary.digests++
      await deliver(sb, {
        orgId: leak.orgId, membershipId: r.membershipId, identityId: r.identityId, to: r.email,
        kind: "leak_clock", periodKey: `${leak.periodKey}:${r.membershipId}`, obligationIds: [], actionableIds: [],
        render: (links) => renderLeakClock(leak, r, links),
      }, dryRun, summary)
    }
  }
  for (const req of clocks.rights) {
    for (const r of req.recipients as LegalRecipient[]) {
      summary.digests++
      await deliver(sb, {
        orgId: req.orgId, membershipId: r.membershipId, identityId: r.identityId, to: r.email,
        kind: "rights_clock", periodKey: `${req.periodKey}:${r.membershipId}`, obligationIds: [], actionableIds: [],
        render: (links) => renderRightsClock(req, r, links),
      }, dryRun, summary)
    }
  }
  return summary
}

/** ?action=unsubscribe&t=<token>: GET -> the static page (no change yet); POST -> RFC 8058 one-click. */
async function handleUnsubscribe(req: Request, url: URL): Promise<Response> {
  const token = url.searchParams.get("t") ?? ""
  if (!/^[0-9a-f]{32,128}$/i.test(token)) return json({ ok: false, reason: "This link is not valid." }, 400)
  if (req.method === "GET" || req.method === "HEAD") {
    return new Response(null, { status: 302, headers: { Location: `${APP_ORIGIN}${UNSUBSCRIBE_PATH}#${token}`, "Cache-Control": "no-store" } })
  }
  if (req.method !== "POST") return json({ ok: false, reason: "Method not allowed" }, 405)
  try {
    const sb = serviceClient()
    const result = await rpc<{ ok: boolean; reason?: string }>(sb, "dpdp_unsubscribe", { p_token: token })
    return json(result, result.ok ? 200 : 400)
  } catch (e) {
    console.error("unsubscribe failed:", e)
    return json({ ok: false, reason: "Could not process that right now." }, 500)
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  if (url.searchParams.get("action") === "unsubscribe") return handleUnsubscribe(req, url)
  if (req.method !== "POST") return json({ error: "POST only" }, 405)
  if (!(await bearerOk(req))) return json({ error: "unauthorised" }, 401)

  let body: { job?: string; now?: string; orgId?: string; dryRun?: boolean } = {}
  try { body = await req.json() } catch { body = {} }
  const now = body.now ? new Date(body.now) : new Date()
  if (Number.isNaN(now.getTime())) return json({ error: "bad now" }, 400)
  const orgId = typeof body.orgId === "string" && body.orgId ? body.orgId : null
  const dryRun = body.dryRun === true || !RESEND_API_KEY
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" }, 500)

  const sb = serviceClient()
  if (body.job !== "monday" && body.job !== "legal_clocks") return json({ error: "unknown job; expected 'monday' or 'legal_clocks'" }, 400)
  // A run for ONE organisation (a test, a manual re-send) is never logged: it must not mark the week done.
  // The log write is best-effort -- it can never stop the run itself.
  let runId: string | null = null
  if (!orgId) {
    try { runId = await rpc<string>(sb, "dpdp_timer_start_run", { p_job: body.job, p_now: now.toISOString() }) } catch (e) { console.error("start_run failed:", e) }
  }
  const finish = async (s: Summary | null, error: string | null) => {
    if (!runId) return
    try {
      await rpc(sb, "dpdp_timer_finish_run", {
        p_id: runId, p_ok: !error && !!s && s.failed === 0 && !s.partial, p_partial: !!s?.partial, p_orgs: s?.orgs ?? 0, p_digests: s?.digests ?? 0,
        p_sent: s?.sent ?? 0, p_dry_run: s?.dry_run ?? 0, p_failed: s?.failed ?? 0, p_skipped: s?.skipped ?? 0, p_error: error,
      })
    } catch (e) { console.error("finish_run failed:", e) }
  }
  try {
    const summary = body.job === "monday" ? await runMonday(sb, now, orgId, dryRun) : await runLegalClocks(sb, now, orgId, dryRun)
    await finish(summary, null)
    return json(summary)
  } catch (e) {
    console.error("run failed:", e)
    const message = e instanceof Error ? e.message : String(e)
    await finish(null, message)
    return json({ error: message }, 500)
  }
})
