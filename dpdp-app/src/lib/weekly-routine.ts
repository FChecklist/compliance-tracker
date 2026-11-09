// The weekly routine: three stages every organisation runs every week -- Discover, Act, Confirm. Pure functions only (no React, no network),
// so the same rules are unit-tested and the screen just shows what they return.
//
// Honest source of every line: the organisation's own History (dpdp_org_history, newest first) and its jobs. Nothing here is invented:
// when no entry exists for a stage the screen says "Nothing recorded yet", never a made-up run. A stage's "last run" is the newest
// History entry of a kind that belongs to that stage; the Check stage also reads the live job counts, and records the person's own
// sign-off on this device (a server-side sign-off needs one new RPC -- see the design note).

export type StageId = "know" | "act" | "check"
export type Doer = "person" | "machine" | "software"

export type RoutineStep = { n: number; doer: Doer; what: string; result: string }
export type RoutineStage = { id: StageId; name: string; promise: string; steps: RoutineStep[] }

export const DOER_LABEL: Record<Doer, string> = {
  person: "A person",
  machine: "Your device",
  software: "The automatic helper",
}

export const STAGES: RoutineStage[] = [
  {
    id: "know",
    name: "Discover",
    promise: "Find out what data you hold, who holds it and where it lives.",
    steps: [
      { n: 1, doer: "software", what: "Every Monday the helper reads your list of data, people and systems.", result: "A fresh reading, with the date, shows in the line below." },
      { n: 2, doer: "person", what: "Open your AI work link and ask: “What changed since last week?”", result: "You get a short list: new data, new people, new systems." },
      { n: 3, doer: "person", what: "Say yes to what is right. Give anything unclear to the person who knows.", result: "Every item has a name against it." },
    ],
  },
  {
    id: "act",
    name: "Act",
    promise: "Do this week's jobs, one by one, each with a name and a date.",
    steps: [
      { n: 1, doer: "software", what: "The helper sorts the week's jobs: late first, then due soon.", result: "“What you have to do” is already in the right order." },
      { n: 2, doer: "person", what: "Do the job, then tap Mark done. Not yours? Give it to someone.", result: "The job shows ✓ and your name and the time go into History." },
      { n: 3, doer: "machine", what: "Your device keeps your changes safe, even without internet, and sends them when you are back online.", result: "“Saved on this device” turns into “Saved”." },
    ],
  },
  {
    id: "check",
    name: "Confirm",
    promise: "Make sure the week's work really happened, and keep the proof.",
    steps: [
      { n: 1, doer: "software", what: "The helper counts the week's jobs: done, still open, late.", result: "Three numbers, always live, below." },
      { n: 2, doer: "person", what: "The owner looks at the numbers and at History, and opens the audit log if needed.", result: "You can say, in one line, whether the week is complete." },
      { n: 3, doer: "person", what: "Tap “This week is checked”.", result: "The week is marked checked, with the date and time." },
    ],
  },
]

// Which History kinds belong to which stage. Anything else (a payment, a share tap) is not part of the routine and is ignored.
const KIND_STAGE: Record<string, StageId> = {
  ai_link_created: "know", ai_work_link_created: "know", organisation_created: "know", organisation_owner_confirmed: "know",
  membership_joined: "know", membership_named_in_role: "know", membership_first_visit_acknowledged: "know",
  obligation_accepted: "act", obligation_assigned: "act", obligation_due_changed: "act", obligation_note_added: "act", obligation_not_my_job: "act",
  obligation_stuck: "act", consent_recorded: "act", consent_withdrawn: "act", ai_action_undone: "act",
}

export type HistoryLike = { kind: string; summary: string; actorLabel: string; occurredAt: Date }
export type JobLike = { yes: boolean; na: boolean; due: Date }

/** The Monday (00:00 UTC) that starts the week containing d. Weeks run Monday to Sunday. */
export function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const back = (x.getUTCDay() + 6) % 7 // Monday = 0
  x.setUTCDate(x.getUTCDate() - back)
  return x
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

export type StageLog = { lastAt: Date | null; lastWhat: string | null; lastWho: string | null; thisWeek: boolean; countThisWeek: number }

/** The latest-log line for one stage: what ran, who or what did it, when, and whether it has run in the current week. */
export function stageLog(stage: StageId, entries: HistoryLike[], now: Date): StageLog {
  const mine = entries.filter((e) => KIND_STAGE[e.kind] === stage).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
  const ws = weekStart(now).getTime()
  const inWeek = mine.filter((e) => e.occurredAt.getTime() >= ws)
  const last = mine[0]
  return { lastAt: last?.occurredAt ?? null, lastWhat: last?.summary ?? null, lastWho: last?.actorLabel ?? null, thisWeek: inWeek.length > 0, countThisWeek: inWeek.length }
}

export type WeekDot = { start: Date; ran: boolean; current: boolean }
export type Cadence = { lastRun: Date | null; nextRun: Date; missed: number; weeks: WeekDot[] }

/** The weekly rhythm: a week counts as run when at least one stage left an entry in it. Four weeks are shown, the current one last; only finished weeks can be "missed". */
export function cadence(entries: HistoryLike[], now: Date, span = 4): Cadence {
  const cur = weekStart(now)
  const staged = entries.filter((e) => KIND_STAGE[e.kind])
  const weeks: WeekDot[] = []
  for (let i = span - 1; i >= 0; i--) {
    const start = addDays(cur, -7 * i)
    const end = addDays(start, 7).getTime()
    weeks.push({ start, ran: staged.some((e) => e.occurredAt.getTime() >= start.getTime() && e.occurredAt.getTime() < end), current: i === 0 })
  }
  const last = staged.reduce<Date | null>((m, e) => (m === null || e.occurredAt > m ? e.occurredAt : m), null)
  return { lastRun: last, nextRun: addDays(cur, 7), missed: weeks.filter((w) => !w.current && !w.ran).length, weeks }
}

export type CheckCounts = { done: number; open: number; late: number; total: number }

/** The live numbers for stage 3: jobs that apply to this organisation, how many are done, still open, and late. */
export function checkCounts(rows: JobLike[], now: Date): CheckCounts {
  const live = rows.filter((r) => !r.na)
  const done = live.filter((r) => r.yes).length
  const late = live.filter((r) => !r.yes && r.due.getTime() < now.getTime()).length
  return { done, open: live.length - done, late, total: live.length }
}

/** The day name and date, for lines like "Monday 9 Nov". UTC, so the same everywhere. */
export function dayLine(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })
}

export const checkedKey = (orgId: string, now: Date) => `dpdp.week-checked.${orgId}.${weekStart(now).toISOString().slice(0, 10)}`
