// The AI work link inside the Monday email -- the parts that talk to the database, kept out of index.ts so they can be tested
// without Deno (drizzle/0663 + 0664; owner, 2026-09-30: READ / EDIT / WORK, the link goes IN the email).
//
// PURE MODULE: no Deno global, no network of its own, no supabase-js import. `rpc` is whatever calls a Postgres function by
// name (index.ts passes its service-role client); tests pass a fake. Every function here is FAIL-SOFT: a failure returns null /
// [] / false and increments a counter, and the email still goes out (with the older wording when the link is missing). The
// counters are how a whole week of "the link silently broke" becomes visible in the run summary.
import { type AiChange, type AiLinkInfo, istYmd } from "./render.ts"

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>

export type AiLinkConfig = {
  /** Put an AI work link in the digest. */
  linkEnabled: boolean
  /** List what the person's AI changed (and send the changes-only email). */
  changesEnabled: boolean
  /** 1 = read + small edits + drafts (READ / EDIT / WORK), 0 = read only. */
  level: 0 | 1
  days: 1 | 7 | 30
  /** Values that were set but not understood. Logged once at start-up. */
  warnings: string[]
}

export type AiStats = { minted: number; mintFailed: number; changesListed: number; changesFailed: number; aiOnlySent: number }
export const newAiStats = (): AiStats => ({ minted: 0, mintFailed: 0, changesListed: 0, changesFailed: 0, aiOnlySent: 0 })

/**
 * FAIL CLOSED. This is a switch on a credential that goes out by email, so a typo must not leave it on with more authority than
 * intended: a switch is on only when unset or exactly "1"; the level is 1 only when unset or exactly "1" (anything else is
 * read-only); days is 1, 7 or 30 exactly, else 7. Any other value is reported in `warnings`.
 */
export function parseAiLinkConfig(get: (key: string) => string): AiLinkConfig {
  const warnings: string[] = []
  const flag = (key: string): boolean => {
    const v = get(key)
    if (v === "" || v === "1") return true
    if (v !== "0") warnings.push(`${key}=${JSON.stringify(v)} is not "1" or "0"; treated as OFF`)
    return false
  }
  const levelRaw = get("DPDP_EMAIL_AI_LINK_LEVEL")
  const level: 0 | 1 = levelRaw === "" || levelRaw === "1" ? 1 : 0
  if (levelRaw !== "" && levelRaw !== "0" && levelRaw !== "1") warnings.push(`DPDP_EMAIL_AI_LINK_LEVEL=${JSON.stringify(levelRaw)} is not "1" or "0"; treated as 0 (read only)`)
  const daysRaw = get("DPDP_EMAIL_AI_LINK_DAYS")
  const days: 1 | 7 | 30 = daysRaw === "1" ? 1 : daysRaw === "30" ? 30 : 7
  if (daysRaw !== "" && daysRaw !== "1" && daysRaw !== "7" && daysRaw !== "30") warnings.push(`DPDP_EMAIL_AI_LINK_DAYS=${JSON.stringify(daysRaw)} is not 1, 7 or 30; using 7`)
  return { linkEnabled: flag("DPDP_EMAIL_AI_LINK_ENABLED"), changesEnabled: flag("DPDP_EMAIL_AI_CHANGES_ENABLED"), level, days, warnings }
}

export type MintedLink = AiLinkInfo & { linkId: string }

const TOKEN_RE = /^[0-9a-f]{64}$/

/** The URL a person pastes into an AI: this host's /ai/<token> (dpdp-app/functions/ai forwards it to the dpdp-ai-link function). */
export const aiLinkUrl = (appOrigin: string, token: string): string => `${appOrigin}/ai/${token}`

/**
 * A new link for this person, for THIS email (dpdp_timer_mint_email_ai_link). It retires nothing: last week's link stays
 * valid until this email has really gone (finishEmailAiLink). Null when switched off or on any failure.
 */
export async function mintAiLink(rpc: Rpc, cfg: AiLinkConfig, appOrigin: string, membershipId: string, stats: AiStats, warn: (m: string) => void = () => {}): Promise<MintedLink | null> {
  if (!cfg.linkEnabled) return null
  try {
    const r = (await rpc("dpdp_timer_mint_email_ai_link", { p_membership_id: membershipId, p_level: cfg.level, p_days: cfg.days })) as
      { linkId?: string; token?: string; expiresAt?: string; level?: number; jobs?: number; people?: number } | null
    if (!r || typeof r.token !== "string" || !TOKEN_RE.test(r.token) || typeof r.expiresAt !== "string" || typeof r.linkId !== "string") {
      stats.mintFailed++
      warn(`mintAiLink: unexpected answer for ${membershipId}`)
      return null
    }
    stats.minted++
    return { linkId: r.linkId, url: aiLinkUrl(appOrigin, r.token), expiresOn: istYmd(r.expiresAt), level: r.level === 0 ? 0 : 1, jobs: r.jobs, people: r.people }
  } catch (e) {
    stats.mintFailed++
    warn(`mintAiLink failed for ${membershipId}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/** After the send. delivered = true: every OTHER emailed link of this person stops working. false: the link nobody received stops working. Best effort. */
export async function finishEmailAiLink(rpc: Rpc, membershipId: string, linkId: string, delivered: boolean, warn: (m: string) => void = () => {}): Promise<void> {
  try {
    await rpc("dpdp_timer_finish_email_ai_link", { p_membership_id: membershipId, p_link_id: linkId, p_delivered: delivered })
  } catch (e) {
    warn(`finishEmailAiLink failed for ${membershipId}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

type ActionRow = { actionId: string; verb: string; what: string | null; value: Record<string, unknown> | null; appliedAt: string; stillUndoable: boolean; undoneAt: string | null }

/** True when this person's AI changed something (not since undone) that no email has told them about yet. Never throws. */
export async function hasPendingAiChanges(rpc: Rpc, cfg: AiLinkConfig, membershipId: string, warn: (m: string) => void = () => {}): Promise<boolean> {
  if (!cfg.changesEnabled) return false
  try {
    const rows = (await rpc("dpdp_timer_ai_actions_for_digest", { p_membership_id: membershipId, p_mark: false })) as ActionRow[] | null
    return Array.isArray(rows) && rows.some((r) => !r.undoneAt)
  } catch (e) {
    warn(`hasPendingAiChanges failed for ${membershipId}: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

/**
 * What this person's AI changed since their last email, with a fresh one-time Undo link while one is still possible. `ids` is the
 * same list in the same order: exactly these are marked shown after the send. `failed` is true when the lookup itself failed (so the
 * caller does not treat "could not read" as "nothing changed").
 */
export async function loadAiChanges(rpc: Rpc, cfg: AiLinkConfig, appOrigin: string, membershipId: string, stats: AiStats, warn: (m: string) => void = () => {}): Promise<{ changes: AiChange[]; ids: string[]; failed: boolean }> {
  if (!cfg.changesEnabled) return { changes: [], ids: [], failed: false }
  try {
    const rows = (await rpc("dpdp_timer_ai_actions_for_digest", { p_membership_id: membershipId, p_mark: false })) as ActionRow[] | null
    const changes: AiChange[] = []
    const ids: string[] = []
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r.undoneAt) continue // put back already: not news
      let undoUrl: string | null = null
      if (r.stillUndoable) {
        try {
          const t = (await rpc("dpdp_timer_issue_undo_token", { p_action_id: r.actionId })) as { ok?: boolean; undoToken?: string } | null
          if (t?.ok && typeof t.undoToken === "string" && /^[0-9a-f]{64}$/.test(t.undoToken)) undoUrl = `${appOrigin}/app/#undo=${r.actionId}.${t.undoToken}`
        } catch (e) { warn(`undo token failed for ${r.actionId}: ${e instanceof Error ? e.message : String(e)}`) }
      }
      changes.push({ verb: r.verb, what: r.what, value: r.value, appliedAt: r.appliedAt, undoUrl })
      ids.push(r.actionId)
    }
    stats.changesListed += changes.length
    return { changes, ids, failed: false }
  } catch (e) {
    stats.changesFailed++
    warn(`loadAiChanges failed for ${membershipId}: ${e instanceof Error ? e.message : String(e)}`)
    return { changes: [], ids: [], failed: true }
  }
}

/**
 * For a person with nothing due: their changes, loaded ONCE, or null when there is nothing (or nothing readable) to tell them, so
 * an email with an empty list is never sent.
 */
export async function aiOnlyChanges(rpc: Rpc, cfg: AiLinkConfig, appOrigin: string, membershipId: string, stats: AiStats, warn: (m: string) => void = () => {}): Promise<{ changes: AiChange[]; ids: string[] } | null> {
  if (!cfg.changesEnabled) return null
  if (!(await hasPendingAiChanges(rpc, cfg, membershipId, warn))) return null
  const loaded = await loadAiChanges(rpc, cfg, appOrigin, membershipId, stats, warn)
  if (loaded.failed || loaded.changes.length === 0) return null
  return { changes: loaded.changes, ids: loaded.ids }
}

/** Mark exactly the changes that were listed in the email as shown. Best effort: a failure only means they are listed once more. */
export async function markChangesShown(rpc: Rpc, membershipId: string, ids: string[], warn: (m: string) => void = () => {}): Promise<void> {
  if (ids.length === 0) return
  try {
    await rpc("dpdp_timer_ai_actions_mark_shown", { p_membership_id: membershipId, p_action_ids: ids })
  } catch (e) {
    warn(`markChangesShown failed for ${membershipId}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
