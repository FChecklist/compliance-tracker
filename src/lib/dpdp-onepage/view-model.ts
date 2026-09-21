// WO-DPDP-010: a faithful port of veridian-dpdp.html's pure JS logic
// (vNow/filt/isToday/lawCell/etc.) into typed TS. The WO is explicit that
// this logic is NORMATIVE ("the logic in the spec's vNow() is normative,
// including the order") -- this file exists so that logic lives in ONE
// place, tested, rather than re-derived per component. Every function name
// below matches the spec's own name so a reviewer can diff behaviour
// against veridian-dpdp.html directly.
//
// Known gap, flagged rather than silently guessed: `sent` (emails sent so
// far) is always 0 until the Monday-digest email system (WO §6) is wired to
// this job model -- the real dpdp.task/digest_send tables exist but are not
// yet joined here. Every function that reads `sent` (the sparkline, the
// stats card) degrades to "0 emails sent" rather than fabricating a number.

export type LawCode = string // e.g. "d:§8(9)" -- law:section, law in {d,s,a,g}

export type ObligationRow = {
  id: string
  part: number // 1-7
  what: string
  dataSet: string | null
  dataTypes: string[] | null
  lawCodes: LawCode[] | null
  by: string | null // assigned person's email, or a group label (isGroup=true)
  isGroup: boolean
  groupDone?: number // how many of the group have answered (only when isGroup)
  groupTotal?: number
  due: Date
  yes: boolean
  answer?: "y" | "n" // for consent-style yes/no jobs (parents)
  na: boolean
  dependsOnObligationId: string | null
  sent: number // WO §6 gap -- always 0 until email digest is wired to this model
}

export type RoleKind = "owner" | "coord" | "go" | "staff" | "ca" | "parent"

export type ViewerContext = {
  kind: RoleKind
  me: string // the viewer's own email (or group label for a group answer)
  caSub?: "partner" | "manager" | "staff"
}

export const PARTS: Array<{ n: number; name: string; color: string }> = [
  { n: 1, name: "Basics", color: "var(--dpdp-s1)" },
  { n: 2, name: "Know your data", color: "var(--dpdp-s2)" },
  { n: 3, name: "Tell people & take consent", color: "var(--dpdp-s3)" },
  { n: 4, name: "Keep it safe", color: "var(--dpdp-s4)" },
  { n: 5, name: "Firms you share data with", color: "var(--dpdp-s5)" },
  { n: 6, name: "Requests & complaints", color: "var(--dpdp-s6)" },
  { n: 7, name: "Sign off", color: "var(--dpdp-s7)" },
]

export const LAWS: Record<string, { label: string; cls: "d" | "s" | "g"; title: string }> = {
  d: { label: "DPDP", cls: "d", title: "DPDP Act 2023 and Rules 2025 — in force from 13 May 2027" },
  s: { label: "SPDI", cls: "s", title: "IT Act §43A and SPDI Rules 2011 — in force TODAY, until 13 May 2027" },
  a: { label: "Aadhaar Act", cls: "s", title: "Aadhaar Act 2016 — in force today" },
  g: { label: "Good practice", cls: "g", title: "Not a legal duty — it keeps the work moving" },
}

// veridian-dpdp.html's SENS object, verbatim.
export const SENSITIVE_DATA_TYPES = new Set([
  "Aadhaar", "Bank details", "Bank account", "Medical", "Health", "Fingerprint", "Face",
  "Children’s photos", "Live location", "Category",
])

/** isToday(codes): true if any law code is SPDI ('s') or Aadhaar Act ('a') -- in force today, unlike DPDP ('d', from 13 May 2027). */
export function isToday(codes: LawCode[] | null | undefined): boolean {
  return (codes ?? []).some((c) => c[0] === "s" || c[0] === "a")
}

/** live(rows): rows that aren't marked not-applicable -- the spec's live(). */
export function live(rows: ObligationRow[]): ObligationRow[] {
  return rows.filter((r) => !r.na)
}

/** yesFor(row, viewer): for a group job, a staff viewer's OWN answer counts, not the group total. */
export function yesFor(row: ObligationRow, viewer: ViewerContext): boolean {
  if (row.isGroup && viewer.kind === "staff") return !!(row.groupDone && row.groupTotal && row.groupDone >= row.groupTotal)
  return row.yes
}

/** blocked(row, rows): true if this row depends on another row that isn't done yet (the escalation chain). */
export function blocked(row: ObligationRow, rows: ObligationRow[]): boolean {
  if (!row.dependsOnObligationId || row.yes) return false
  const dep = rows.find((r) => r.id === row.dependsOnObligationId)
  return !!dep && !dep.yes && !dep.na
}

function dueDays(due: Date, now: Date): number {
  return Math.round((due.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000)
}

export type DoThisNow = { icon: string; title: string; subtitle: string; buttonLabel?: string; action?: string }

/**
 * vNow(rows, viewer): the "Do this now" box. Order is NORMATIVE per the WO
 * -- do not reorder these branches. `now` is injectable for tests; defaults
 * to the real current time.
 */
export function vNow(rows: ObligationRow[], viewer: ViewerContext, now: Date = new Date()): DoThisNow {
  const lr = live(rows)
  const mine = lr.filter((r) => r.by === viewer.me && !yesFor(r, viewer) && !blocked(r, rows))
  const nob = lr.filter((r) => !r.by)
  const late = lr.filter((r) => !r.yes && dueDays(r.due, now) < 0)
  const left = lr.filter((r) => !r.yes)

  if (viewer.kind === "parent") {
    const q = lr.filter((r) => !r.yes)
    if (q.length) return { icon: "👪", title: `Please answer ${q.length} question${q.length > 1 ? "s" : ""} about your child`, subtitle: "Press Yes or No on each. You can change your answer any time.", buttonLabel: "Show me", action: "mine" }
    return { icon: "✅", title: "Thank you — you have answered everything", subtitle: "You will hear from the school only if it needs something new." }
  }

  if (viewer.kind === "staff") {
    if (mine.length) return { icon: "👉", title: `You have ${mine.length} job${mine.length > 1 ? "s" : ""} to do`, subtitle: "When a job is done, press the green button. That is all.", buttonLabel: "Show me my jobs", action: "mine" }
    return { icon: "🎉", title: "Nothing for you this week", subtitle: "You will get an email if anything new comes up." }
  }

  // CA role handling (r.k==='ca') deferred to the CA firm view (WO §3
  // "CA firm view") -- not yet built; only owner/coord/go covered here.

  if (viewer.kind === "go" && mine.length) {
    return { icon: "👉", title: `You have ${mine.length} job${mine.length > 1 ? "s" : ""} of your own`, subtitle: "As Grievance Officer. Press Mark Yes on each when it is done.", buttonLabel: "Show me", action: "mine" }
  }
  if (nob.length && viewer.kind !== "go") {
    return { icon: "📧", title: `${nob.length} job${nob.length > 1 ? "s have" : " has"} nobody looking after ${nob.length > 1 ? "them" : "it"}`, subtitle: "Type an email into each amber row — or mark it “doesn’t apply” if it is not relevant to you.", buttonLabel: "Show me", action: "nobody" }
  }
  if (mine.length) {
    return { icon: "👉", title: `You have ${mine.length} job${mine.length > 1 ? "s" : ""} of your own`, subtitle: "Press Mark Yes on each when it is done.", buttonLabel: "Show me", action: "mine" }
  }
  const todayLate = lr.filter((r) => isToday(r.lawCodes) && !r.yes && dueDays(r.due, now) < 0)
  if (todayLate.length) {
    return {
      icon: "⚡", title: `${todayLate.length} job${todayLate.length > 1 ? "s" : ""} required by today’s law ${todayLate.length > 1 ? "are" : "is"} late`,
      subtitle: "These come from the SPDI Rules 2011 or the Aadhaar Act, which apply now — not from May 2027. Everyone has been reminded.", buttonLabel: "Show me", action: "today",
    }
  }
  if (late.length) {
    return { icon: "⏰", title: `${late.length} job${late.length > 1 ? "s are" : " is"} late`, subtitle: "Those people are reminded every Monday automatically. Nothing for you to do unless you want to call them.", buttonLabel: "Show me", action: "late" }
  }
  if (!left.length) {
    return { icon: "🎉", title: "Everything is done", subtitle: "Your list refreshes every quarter. We will email you when it does." }
  }
  return { icon: "✅", title: "Nothing needs you this week", subtitle: "Everyone has been emailed." }
}

export type FilterKey = "all" | "mine" | "pending" | "late" | "today" | "nobody" | "done"

export function filterCounts(rows: ObligationRow[], viewer: ViewerContext, now: Date = new Date()) {
  const lr = live(rows)
  return {
    all: rows.length,
    mine: lr.filter((r) => r.by === viewer.me && !r.yes).length,
    pending: lr.filter((r) => !r.yes).length,
    late: lr.filter((r) => !r.yes && dueDays(r.due, now) < 0).length,
    today: lr.filter((r) => isToday(r.lawCodes) && !r.yes).length,
    nobody: lr.filter((r) => !r.by).length,
    done: lr.filter((r) => r.yes).length,
  }
}

export function applyFilter(rows: ObligationRow[], filter: FilterKey, viewer: ViewerContext, now: Date = new Date()): ObligationRow[] {
  switch (filter) {
    case "today": return rows.filter((r) => isToday(r.lawCodes) && !r.yes && !r.na)
    case "mine": return rows.filter((r) => r.by === viewer.me && !r.yes && !r.na)
    case "pending": return rows.filter((r) => !r.yes && !r.na)
    case "late": return rows.filter((r) => !r.yes && !r.na && dueDays(r.due, now) < 0)
    case "nobody": return rows.filter((r) => !r.by && !r.na)
    case "done": return rows.filter((r) => r.yes)
    default: return rows
  }
}

export type DueStatus = "ok" | "soon" | "late"
export function dueStatus(row: ObligationRow, now: Date = new Date()): DueStatus {
  if (row.yes || row.na) return "ok"
  const d = dueDays(row.due, now)
  if (d < 0) return "late"
  if (d <= 7) return "soon"
  return "ok"
}
export function daysLate(row: ObligationRow, now: Date = new Date()): number {
  return Math.max(0, -dueDays(row.due, now))
}

export function partProgress(rows: ObligationRow[], part: number): { done: number; all: number } {
  const rs = live(rows.filter((r) => r.part === part))
  return { done: rs.filter((r) => r.yes).length, all: rs.length }
}

export type PartSummary = { n: number; name: string; color: string; done: number; all: number; any: boolean; pct: number }

/** partsForRows: PartsTrack's data -- only parts with ANY row (na or not), matching the spec's `.filter(s=>s.any)`. A part whose every row is n/a shows 100% (spec's `s.all?...:100`), not 0/0. */
export function partsForRows(rows: ObligationRow[]): PartSummary[] {
  return PARTS.map((p) => {
    const { done, all } = partProgress(rows, p.n)
    const any = rows.some((r) => r.part === p.n)
    const pct = all ? Math.round((done / all) * 100) : 100
    return { ...p, done, all, any, pct }
  }).filter((p) => p.any)
}

// Port of veridian-dpdp.html's avc()/av() -- a stable colour per email
// (djb2-ish hash into a fixed 8-colour palette) and an initial letter
// ('👥' for a group label starting with "All ").
const AVATAR_COLORS = ["#3B3FB6", "#138A36", "#C2410C", "#0E7490", "#9D174D", "#4D7C0F", "#6D28D9", "#B45309"]
export function avatarColor(email: string): string {
  let h = 0
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
export function avatarInitial(email: string): string {
  if (/^All /.test(email)) return "👥"
  return email.replace(/[^a-z]/gi, "").slice(0, 1).toUpperCase() || "?"
}

export function heroStats(rows: ObligationRow[]) {
  const lr = live(rows)
  const done = lr.filter((r) => r.yes).length
  const total = lr.length
  const sent = rows.reduce((a, r) => a + r.sent, 0)
  const pct = total ? Math.round((done / total) * 100) : 0
  return { done, total, pct, sent }
}
