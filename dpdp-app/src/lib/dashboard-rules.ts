// Dashboard rules for the Firm view and the client view: ageing, "with whom", and one row per client. Pure functions only (no React, no network).
//
// Ageing = whole days since an item became pending. Colour buckets: 0-7 green, 8-14 amber, 15-30 orange, over 30 red. No date, no ageing ("none").
// A date in the future counts as 0 days (never negative). The server does not yet send a "pending since" date per client, so a Firm row only
// shows ageing when the optional fields below are present; it never invents one.
import type { CaClientWire } from "@/lib/rpc-types"
import { daysLate, live, type ObligationRow } from "@/lib/dpdp-onepage/view-model"

export type AgeBucket = "green" | "amber" | "orange" | "red" | "none"
export type StepId = "discover" | "decide" | "do"
export const STEP_NAMES: Record<StepId, string> = { discover: "Discover", decide: "Decide", do: "Do" }
export type StepState = "done" | "pending"

const DAY = 86_400_000

/** Whole days from `since` to `now`; null when there is no usable date; 0 when the date is in the future. */
export function ageingDays(since: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (since === null || since === undefined) return null
  const t = since instanceof Date ? since.getTime() : Date.parse(since)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / DAY))
}

export function ageBucket(days: number | null): AgeBucket {
  if (days === null) return "none"
  if (days <= 7) return "green"
  if (days <= 14) return "amber"
  if (days <= 30) return "orange"
  return "red"
}

export const BUCKET_LABEL: Record<AgeBucket, string> = { green: "0 to 7 days", amber: "8 to 14 days", orange: "15 to 30 days", red: "Over 30 days", none: "No date yet" }

/** Who must act next, in plain words. A named person wins; otherwise the role that owns that step. */
export function withWhom(step: StepId, named?: string | null): string {
  const n = named?.trim()
  if (n) return n
  return step === "discover" ? "Client" : step === "decide" ? "Client owner" : "Client team"
}

export type ClientSteps = { discover: StepState; decide: StepState; do: StepState }

export type FirmRow = {
  orgId: string; name: string; steps: ClientSteps
  firstPending: StepId | null; withWhom: string | null; ageDays: number | null; bucket: AgeBucket
  done: number; total: number
}

/** One Firm row from dpdp_my_clients. Discover is done once data places are listed; Decide once the owner confirmed the list; Do once every job is done. */
export function firmRow(c: CaClientWire & { pendingSince?: string | null; nextActor?: string | null }, now: Date = new Date()): FirmRow {
  const steps: ClientSteps = {
    discover: c.dataLocations > 0 ? "done" : "pending",
    decide: c.ownerConfirmedAt ? "done" : "pending",
    do: c.total > 0 && c.done >= c.total ? "done" : "pending",
  }
  const firstPending = (["discover", "decide", "do"] as StepId[]).find((s) => steps[s] === "pending") ?? null
  const ageDays = firstPending ? ageingDays(c.pendingSince, now) : null
  return {
    orgId: c.org.id, name: c.org.name, steps, firstPending,
    withWhom: firstPending ? withWhom(firstPending, c.nextActor) : null,
    ageDays, bucket: firstPending ? ageBucket(ageDays) : "green", done: c.done, total: c.total,
  }
}

/** Oldest pending first; rows with pending work but no date after dated ones; fully done last. Ties by name. */
export function sortFirmRows(rows: FirmRow[]): FirmRow[] {
  const rank = (r: FirmRow) => (r.firstPending === null ? 2 : r.ageDays === null ? 1 : 0)
  return [...rows].sort((a, b) => rank(a) - rank(b) || (b.ageDays ?? 0) - (a.ageDays ?? 0) || a.name.localeCompare(b.name))
}

export function firmTotals(rows: FirmRow[]) {
  const pending = rows.filter((r) => r.firstPending !== null)
  const ages = pending.map((r) => r.ageDays).filter((d): d is number => d !== null)
  return { clients: rows.length, done: rows.length - pending.length, pending: pending.length, oldestPending: ages.length ? Math.max(...ages) : null }
}

export type ClientItem = { id: string; what: string; step: StepId; state: StepState; withWhom: string; ageDays: number | null; bucket: AgeBucket }

/**
 * One item of the client's own list, placed on a step. Done = Do/done. Not done: no data details yet = Discover; data known but nobody named = Decide;
 * a person is named = Do. Age counts days past the due date (the list has no "became pending" date); not yet due = 0.
 */
export function clientItem(r: ObligationRow, now: Date = new Date()): ClientItem {
  if (r.yes) return { id: r.id, what: r.what, step: "do", state: "done", withWhom: r.by ?? "", ageDays: null, bucket: "none" }
  const known = r.dataSet !== null || (r.dataTypes?.length ?? 0) > 0
  const step: StepId = !known ? "discover" : r.by ? "do" : "decide"
  const late = daysLate(r, now)
  return { id: r.id, what: r.what, step, state: "pending", withWhom: withWhom(step, r.isGroup ? null : r.by), ageDays: late, bucket: ageBucket(late) }
}

export function clientItems(rows: ObligationRow[], now: Date = new Date()): ClientItem[] {
  return live(rows).map((r) => clientItem(r, now))
}
