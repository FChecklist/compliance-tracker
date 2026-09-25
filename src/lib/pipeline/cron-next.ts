// PROJEXA-BUILD-001 U-40 (register row BR-515): the next run time of a five-field cron expression, in UTC.
//
// compliance.pipeline_schedules.cadence holds a plain cron expression (minute hour day-of-month month day-of-week). The scheduler
// bridge (scheduler-bridge.ts) claims a due schedule and moves next_run_at to nextCronRun(cadence, now), so this is the one place
// that decides when a schedule runs next. No dependency: a cron library is not in package.json, and the five fields are small.
//
// Accepted per field: `*`, `*/n`, a number, `a-b`, `a-b/n`, and comma lists of those. Month and day-of-week also take the three
// letter English names (jan..dec, sun..sat), alone or as range ends. Day-of-week is 0 to 7, and both 0 and 7 mean Sunday.
// Not accepted (parseCron reports why): @daily and the other macros, `L`, `W`, `#`, `?`, a step on a single number (`5/15`), a
// range whose start is after its end, and a step of 0.
//
// Day rule, the one the standard cron (Vixie) and pg_cron use: when both day-of-month and day-of-week are restricted (neither
// field starts with `*`), a day matches if EITHER field matches; when one of them starts with `*`, the day must match both.
//
// nextCronRun returns the first minute strictly after `after` that matches, with seconds and milliseconds at 0, or null when the
// expression does not parse or nothing matches within eight years (for example `0 0 31 2 *`). Pure: no clock, no I/O.

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const DOW_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

type FieldSpec = { name: string; min: number; max: number; names?: readonly string[]; nameBase?: number }

const FIELDS: readonly FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 },
  { name: "day-of-week", min: 0, max: 7, names: DOW_NAMES, nameBase: 0 },
]

export type ParsedCron = {
  minute: ReadonlySet<number>
  hour: ReadonlySet<number>
  dayOfMonth: ReadonlySet<number>
  month: ReadonlySet<number>
  /** 0 to 6, Sunday is 0 (a 7 in the expression is folded into 0) */
  dayOfWeek: ReadonlySet<number>
  dayOfMonthStar: boolean
  dayOfWeekStar: boolean
}

export type CronParse = { ok: true; cron: ParsedCron } | { ok: false; reason: string }

function parseValue(text: string, spec: FieldSpec): number | null {
  if (/^\d+$/.test(text)) return Number(text)
  const named = spec.names?.indexOf(text.toLowerCase()) ?? -1
  return named >= 0 ? named + (spec.nameBase ?? 0) : null
}

function parseField(text: string, spec: FieldSpec): { ok: true; values: Set<number> } | { ok: false; reason: string } {
  const values = new Set<number>()
  if (text === "") return { ok: false, reason: `${spec.name} is empty` }
  for (const part of text.split(",")) {
    if (part === "") return { ok: false, reason: `${spec.name} has an empty list item` }
    const [rangeText, stepText, ...extra] = part.split("/")
    if (extra.length > 0) return { ok: false, reason: `${spec.name} has more than one step in '${part}'` }
    let step = 1
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1 || Number(stepText) > spec.max) {
        return { ok: false, reason: `${spec.name} step '${stepText}' is not a whole number from 1 to ${spec.max}` }
      }
      step = Number(stepText)
    }
    let start: number
    let end: number
    if (rangeText === "*") {
      start = spec.min
      end = spec.max
    } else if (rangeText.includes("-")) {
      const [a, b, ...more] = rangeText.split("-")
      const low = parseValue(a, spec)
      const high = parseValue(b ?? "", spec)
      if (more.length > 0 || low === null || high === null) return { ok: false, reason: `${spec.name} range '${rangeText}' is not valid` }
      start = low
      end = high
    } else {
      const single = parseValue(rangeText, spec)
      if (single === null) return { ok: false, reason: `${spec.name} value '${rangeText}' is not valid` }
      if (stepText !== undefined) return { ok: false, reason: `${spec.name} '${part}' puts a step on a single value` }
      start = single
      end = single
    }
    if (start < spec.min || end > spec.max || start > end) {
      return { ok: false, reason: `${spec.name} '${rangeText}' is outside ${spec.min}-${spec.max}` }
    }
    for (let v = start; v <= end; v += step) values.add(v)
  }
  return { ok: true, values }
}

/** Parse a five-field expression, or say why it cannot be used. */
export function parseCron(expression: string): CronParse {
  if (typeof expression !== "string") return { ok: false, reason: "the expression is not text" }
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5 || fields[0] === "") {
    return { ok: false, reason: `expected 5 fields (minute hour day-of-month month day-of-week), got ${expression.trim() === "" ? 0 : fields.length}` }
  }
  const parsed: Set<number>[] = []
  for (const [index, spec] of FIELDS.entries()) {
    const out = parseField(fields[index], spec)
    if (!out.ok) return out
    parsed.push(out.values)
  }
  const dow = new Set<number>([...parsed[4]].map((v) => (v === 7 ? 0 : v)))
  return {
    ok: true,
    cron: {
      minute: parsed[0],
      hour: parsed[1],
      dayOfMonth: parsed[2],
      month: parsed[3],
      dayOfWeek: dow,
      dayOfMonthStar: fields[2].startsWith("*"),
      dayOfWeekStar: fields[4].startsWith("*"),
    },
  }
}

function dayMatches(cron: ParsedCron, t: Date): boolean {
  const domOk = cron.dayOfMonth.has(t.getUTCDate())
  const dowOk = cron.dayOfWeek.has(t.getUTCDay())
  return cron.dayOfMonthStar || cron.dayOfWeekStar ? domOk && dowOk : domOk || dowOk
}

const HORIZON_YEARS = 8

/** The first matching minute strictly after `after` (UTC, seconds 0), or null when the expression is invalid or never matches. */
export function nextCronRun(expression: string, after: Date): Date | null {
  const parsed = parseCron(expression)
  if (!parsed.ok || Number.isNaN(after.getTime())) return null
  const cron = parsed.cron
  let t = new Date(Math.floor(after.getTime() / 60000) * 60000 + 60000)
  const lastYear = t.getUTCFullYear() + HORIZON_YEARS
  while (t.getUTCFullYear() <= lastYear) {
    if (!cron.month.has(t.getUTCMonth() + 1)) {
      t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1))
    } else if (!dayMatches(cron, t)) {
      t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1))
    } else if (!cron.hour.has(t.getUTCHours())) {
      t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours() + 1))
    } else if (!cron.minute.has(t.getUTCMinutes())) {
      t = new Date(t.getTime() + 60000)
    } else {
      return t
    }
  }
  return null
}
