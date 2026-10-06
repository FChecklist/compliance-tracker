// AUDIT-100 item 4 (ENGINE_CAPABILITIES change 5, owner decisions D1 and D2) and item 5 (the receipt): the pure rules the confirm screens use.
//   RISK     a change that deletes, cancels or retires something, or that touches money (the registry's own `money_sensitive`), needs ONE EXTRA TICK from the
//            person on the confirm screen. The rule is the function id and the registry flag, never anything the caller says about itself.
//   PLAIN    one sentence in plain words for the screen, from the registry's label (never from text a caller wrote).
//   RECEIPT  a short code for a change (R-XXXXX), derived from the intent id, that the person can read back to their AI; it is in the answer of the change
//            and in the workspace's "recent changes by you via AI".
//   TARGETS  the record an id parameter points at, read live (by the existing record reader) so the screen shows its real name, never what the link claimed.
import { functionDef } from "./api-definition.ts"

export const DELETE_ID_RE = /^(delete_|remove_|void_|archive_|cancel_|retire_|reject_)/

export type Risk = { delete: boolean; money: boolean; needs_tick: boolean }

export function riskOf(fnId: string): Risk {
  const def = functionDef(fnId)
  const del = DELETE_ID_RE.test(fnId)
  const money = def?.money_sensitive === true
  return { delete: del, money, needs_tick: del || money }
}

export const TICK_TEXT: Record<"delete" | "money" | "both", string> = {
  delete: "I understand this deletes or cancels what is shown above and cannot be undone from here.",
  money: "I understand this adds or changes money figures (amounts, rates or payments) shown above.",
  both: "I understand this deletes, cancels or changes money figures shown above and cannot be undone from here.",
}

export const tickTextOf = (r: Risk): string => (r.delete && r.money ? TICK_TEXT.both : r.delete ? TICK_TEXT.delete : TICK_TEXT.money)

/** One plain sentence about the change: what it is, and whether it deletes or touches money. */
export function plainSentence(fnId: string): string {
  const def = functionDef(fnId)
  const label = (def?.label ?? fnId).replace(/\s+/g, " ").trim()
  const r = riskOf(fnId)
  if (r.delete && r.money) return `${label}. This deletes or cancels something and involves money figures.`
  if (r.delete) return `${label}. This deletes or cancels something.`
  if (r.money) return `${label}. This involves money figures.`
  return `${label}.`
}

// ------------------------------------------------------------------------------------------------------------------------------ receipt
const RECEIPT_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

/** R-XXXXX from the intent id (FNV-1a, 5 characters of a look-alike-free alphabet). The same id always gives the same code. */
export function receiptOf(intentId: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < intentId.length; i++) {
    h ^= intentId.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  let out = ""
  for (let i = 0; i < 5; i++) {
    out += RECEIPT_ALPHABET[h % 32]
    h = (h >>> 5) | ((h & 31) << 27)
    h = Math.imul(h ^ (i + 1), 0x9e3779b1) >>> 0
  }
  return `R-${out}`
}

// ------------------------------------------------------------------------------------------------------------------------------ targets
/** The record kind an id parameter of a delete or money function points at, where the reader has that kind. */
export const TARGET_KINDS: Readonly<Record<string, string>> = {
  issueId: "tasks", boqId: "boqs", changeOrderId: "change_orders", attendanceId: "attendance", meetingId: "meetings", permitId: "permits",
  claimId: "progress_claims", receiptId: "material_receipts", timeEntryId: "timesheets",
}
const TARGET_BY_FN: Readonly<Record<string, Record<string, string>>> = {
  delete_progress_entry: { entryId: "progress" },
  delete_time_entry: { entryId: "timesheets" },
}

export function targetKindsFor(fnId: string): Record<string, string> {
  const def = functionDef(fnId)
  const out: Record<string, string> = {}
  for (const p of def?.id_params ?? []) {
    const k = TARGET_BY_FN[fnId]?.[p] ?? TARGET_KINDS[p]
    if (k) out[p] = k
  }
  return out
}

export type Target = { param: string; kind: string; id: string; found: boolean | null; name: string | null }

const NAME_FIELDS = ["name", "title", "subject", "description", "item_code", "code", "number", "reference"]

export function nameOfRecord(row: Record<string, unknown>): string | null {
  for (const f of NAME_FIELDS) {
    const v = row[f]
    if (typeof v === "string" && v.trim() !== "") return v.trim().slice(0, 120)
  }
  return null
}
