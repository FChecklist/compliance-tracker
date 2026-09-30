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

/** What the page wires for the four actions. Each may reject with the database's own plain-English refusal. */
export type JobActionHandlers = {
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

export function checkNote(text: string): Check {
  const t = text.trim()
  if (!t) return { ok: false, message: "Write a few words first." }
  if (t.length > NOTE_MAX) return { ok: false, message: `A note can be ${NOTE_MAX} characters at most (this one is ${t.length}).` }
  return { ok: true, value: t }
}

export function checkEmail(email: string): Check {
  const t = email.trim().toLowerCase()
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(t)) return { ok: false, message: "Enter a full email address, like name@company.com." }
  return { ok: true, value: t }
}

export function checkReason(reason: string): Check {
  const t = reason.trim()
  if (t.length < 3) return { ok: false, message: "Say in a few words why it doesn't apply. The reason stays in the history." }
  if (t.length > NOTE_MAX) return { ok: false, message: `The reason can be ${NOTE_MAX} characters at most.` }
  return { ok: true, value: t }
}

export function checkDue(value: string, now: Date): Check {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, message: "Pick a date." }
  const { min, max } = dueBounds(now)
  if (value < min || value > max) return { ok: false, message: `Pick a date from ${min} to ${max}.` }
  return { ok: true, value }
}

/** Shown above the reason box when today's law is what makes the job a job. */
export function requiredTodayWarning(row: ObligationRow): string | null {
  return isToday(row.lawCodes)
    ? "Today's law (the SPDI Rules 2011 or the Aadhaar Act) is behind this job. Say it doesn't apply only if that is really true for you, and write why."
    : null
}
