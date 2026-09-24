import type { AiLinkWarning } from "./rpc-types"

// WO-DPDP-013 v2 Part 1 §4 item 6 -- pure text/formatting the Copy-AI-link
// screen (AiWorkLink.tsx) needs, kept out of the component so it can be
// pinned byte-exact here without a DOM (bun has no window/localStorage; this
// file touches neither).

/**
 * WO-013 §1.1's warning sentence, VERBATIM, with the real counts from
 * dpdp_ai_link_warning. Shown before any link exists -- the person reads
 * this before pressing "Copy link".
 */
export function aiWorkLinkWarningSentence(w: Pick<AiLinkWarning, "jobs" | "people">): string {
  return `This link lets an AI assistant read your VERIDIAN view: ${w.jobs} jobs and the names and emails of ${w.people} people. When you paste it into an AI assistant, that information is sent to the company that runs it — for example, ChatGPT is run by a US company.`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

/**
 * en-IN "dd Mon yyyy" (e.g. "24 Sep 2026"), read in UTC -- every wire
 * timestamp here (createdAt/expiresAt/revokedAt/lastUsedAt) is ISO-8601 UTC
 * (rpc-types.ts's own convention), and a fixed month table sidesteps any
 * ICU/locale difference between "Sep" and "Sept" across environments.
 */
export function formatEnInDate(iso: string): string {
  const d = new Date(iso)
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${day} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export const LEVEL_LABEL: Record<0 | 1, string> = {
  0: "Level 0 · Read, analyse, report",
  1: "Level 1 · Small edits, directly",
}

/**
 * WO-013 §1.2, in plain language: what switching Level 1 on actually means.
 * Shown the moment the person turns it on, before they press "Copy link".
 * The quoted audit-label phrase is verbatim -- it is what History and the
 * Monday email will literally say next to the AI's change.
 */
export const LEVEL1_EXPLANATION =
  "With this on, the AI can act directly — adding a NOTE, changing when a job is due (SET_DUE), giving a job to an existing member of your organisation (ASSIGN), or marking a job as not applicable (MARK_NA) — without asking you first. Every change it makes is recorded as “by <person> via AI assistant”, shown in your next Monday email, and can be undone for 24 hours. Anything with legal weight — marking a job done, an owner confirm, a manager check, a partner sign, a delete, adding or removing a person, changing who signs, publishing, or exporting personal data — is never done directly: the AI can only draft it, and you open the confirmation link yourself, in your own browser, to make it real."
