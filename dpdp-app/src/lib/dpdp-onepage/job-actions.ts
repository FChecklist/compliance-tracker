// The four things a person can do to ONE job from their own page besides saying Yes (owner, 2026-09-30):
//   note    add a note to the job's history                     anyone who can see the job
//   assign  give the job to someone else                        the owner
//   due     change when the job is due                          the owner
//   na      say the job does not apply, with a reason           the owner, or the person the job is given to
// Who may do what is decided by the database (dpdp_add_note / dpdp_assign_person / dpdp_set_due_date / dpdp_mark_not_applicable, drizzle/0605
// and 0666); this module only decides what to OFFER, so a button is never shown that the database would refuse, and the plain-English
// checks a form makes before it asks. Pure: no DOM, no clock of its own (the caller passes `now`).

import { isToday, type ObligationRow, type ViewerContext } from "./view-model"

export type JobActionKind = "note" | "assign" | "due" | "na"

/** A note can be 1000 characters (dpdp_add_note). */
export const NOTE_MAX = 1000
/** A new due date must fall within this window of India's today (dpdp_set_due_date). */
export const DUE_WINDOW_DAYS = { before: 30, after: 400 } as const

const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

/** Which of the four the viewer may use on this row. A finished or not-applicable job takes only a note; a parent, who only answers questions, takes none. */
export function availableActions(row: ObligationRow, viewer: ViewerContext): JobActionKind[] {
  if (viewer.kind === "parent") return []
  const owner = viewer.kind === "owner"
  const open = !row.yes && !row.na
  const out: JobActionKind[] = ["note"]
  // A group job stays with its group: dpdp_assign_person would leave the group on it, so it is not offered.
  if (owner && open && !row.isGroup) out.push("assign")
  if (owner && open) out.push("due")
  if (open && (owner || (!row.isGroup && sameAddress(row.by, viewer.me)))) out.push("na")
  return out
}

/** What the page wires for the four actions. Each may reject with the database's own plain-English refusal. `onSaved` receives the sentence to show once one succeeded. */
export type JobActionHandlers = {
  onSaved?: (message: string) => void
  onNote?: (obligationId: string, text: string) => Promise<void>
  onAssign?: (obligationId: string, email: string) => Promise<void>
  onSetDue?: (obligationId: string, dueOn: string) => Promise<void>
  onNotApplicable?: (obligationId: string, reason: string) => Promise<void>
}

/** Which of the four this viewer may use on this row AND the page wired a handler for. */
export function offeredActions(row: ObligationRow, viewer: ViewerContext, h: JobActionHandlers): JobActionKind[] {
  const wired: Record<JobActionKind, boolean> = { note: !!h.onNote, assign: !!h.onAssign, due: !!h.onSetDue, na: !!h.onNotApplicable }
  return availableActions(row, viewer).filter((k) => wired[k])
}

export const ACTION_LABEL: Record<JobActionKind, string> = {
  note: "Add a note",
  assign: "Give to someone",
  due: "Change the date",
  na: "Doesn't apply",
}

/** YYYY-MM-DD in India, the calendar the database counts lateness in. */
export function istDay(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
}

function shiftDay(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The earliest and latest date the database will accept for a job's due date. */
export function dueBounds(now: Date): { min: string; max: string } {
  const today = istDay(now)
  return { min: shiftDay(today, -DUE_WINDOW_DAYS.before), max: shiftDay(today, DUE_WINDOW_DAYS.after) }
}

/** A due date is a calendar day the page reads as UTC midnight (`new Date("2026-10-05")`); its own day is its ISO date, in any time zone. */
export function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export type Check = { ok: true; value: string } | { ok: false; message: string }

/** The id of a row's "More" button, so the row can hand the keyboard's focus back to it when its panel closes. */
export const moreButtonId = (rowId: string): string => `job-more-${rowId}`

/** Characters as Postgres counts them (code points), not UTF-16 units: 600 emoji are 600 characters, not 1200. */
export const charCount = (s: string): number => Array.from(s).length

export function checkNote(text: string): Check {
  const t = text.trim()
  if (!t) return { ok: false, message: "Write a few words first." }
  const n = charCount(t)
  if (n > NOTE_MAX) return { ok: false, message: `A note can be ${NOTE_MAX} characters at most (this one is ${n}).` }
  return { ok: true, value: t }
}

export function checkEmail(email: string): Check {
  const t = email.trim().toLowerCase()
  // name@domain.tld: no spaces, brackets or quotes; the domain is dot-separated labels of letters, digits and hyphens; no empty label, no trailing dot.
  const ok = /^[^\s@<>()[\],;:"\\]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(t) && !t.includes("..") && !t.startsWith(".") && !t.split("@")[0].endsWith(".")
  if (!ok) return { ok: false, message: "Enter a full email address, like name@company.com." }
  return { ok: true, value: t }
}

export function checkReason(reason: string): Check {
  const t = reason.trim()
  const n = charCount(t)
  if (n < 3) return { ok: false, message: "Say in a few words why it doesn't apply. The reason stays in the history." }
  if (n > NOTE_MAX) return { ok: false, message: `The reason can be ${NOTE_MAX} characters at most (this one is ${n}).` }
  return { ok: true, value: t }
}

export function checkDue(value: string, now: Date): Check {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, message: "Pick a date." }
  const { min, max } = dueBounds(now)
  if (value < min || value > max) return { ok: false, message: `Pick a date from ${min} to ${max}.` }
  return { ok: true, value }
}

/** Jobs still waiting on this one: a not-applicable step counts as done, so saying it doesn't apply lets them go ahead. */
export function dependantCount(row: ObligationRow, allRows: ObligationRow[]): number {
  return allRows.filter((r) => r.dependsOnObligationId === row.id && !r.yes && !r.na).length
}

/** Everything worth saying before a person marks THIS job "doesn't apply", beyond the law warning: who it lets through, and what it does to their own view. */
export function notApplicableCautions(row: ObligationRow, viewer: ViewerContext, allRows: ObligationRow[]): string[] {
  const out: string[] = []
  const waiting = dependantCount(row, allRows)
  if (waiting > 0) out.push(`${waiting === 1 ? "Another job is" : `${waiting} other jobs are`} waiting for this one. Saying it doesn't apply lets ${waiting === 1 ? "it" : "them"} go ahead.`)
  if (["coord", "go", "ca"].includes(viewer.kind) && sameAddress(row.by, viewer.me)) {
    out.push("If this job is what gives you your role in this list (Grievance Officer, coordinator or CA), you may see only your own jobs once it is marked.")
  }
  return out
}

/** Shown above the reason box when today's law is what makes the job a job. */
export function requiredTodayWarning(row: ObligationRow): string | null {
  return isToday(row.lawCodes)
    ? "Today's law (the SPDI Rules 2011 or the Aadhaar Act) is behind this job. Say it doesn't apply only if that is really true for you, and write why."
    : null
}
