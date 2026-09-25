// PROJEXA-BUILD-001 U-27 (BR-403, BR-404, BR-405; D-11 as amended by PMD-09 and AM-088): the pure half of keyset
// pagination for BOQ line items. The database half (the (boq_id, id) keyset read and the two paged service reads,
// listBoqsPage and getBoqPage) lives in src/lib/services/construction-boq-service.ts. This file holds only what needs
// no database: the flag, the cursor codec, the page-size rule and the revision-chain walk.
//
// WHY A SEPARATE FILE WITH NO IMPORTS. The two v1 BOQ routes read the flag on every request. Several route tests
// replace construction-boq-service with a partial mock that lists only the names those routes imported before U-27,
// so a new named import from that module would fail those tests at link time although their flag-OFF path never
// uses it. This file imports nothing, so a route can import it under any test double.
//
// THE FLAG. BUILD001_BOQ_KEYSET_PAGINATION is read from process.env on every call, never at import, so the value in
// force is the one at request time. Unset, or any value other than 1, true or yes, means OFF: the routes and the
// services behave exactly as before U-27. Production stays OFF until the owner releases a deploy and PROJEXA forwards
// a cursor (U-33; the three PROJEXA proxy routes forward none today, AM-088).
//
// THE CURSOR. base64url of {"b": <boq_id>, "i": <line item id>} of the last row of a page, nothing else. It carries no
// organisation and no project, so it cannot widen a read: the service still reads only the caller's organisation and
// the requested project, and refuses a cursor naming any other BOQ. Decoding is strict (the canonical encoding only,
// exactly the two keys, each a non-empty string of at most 128 characters with no control character); anything else
// decodes to null, which the service turns into HTTP 400.
//
// THE ORDER. (boq_id, id) in byte order. Postgres gives byte order with COLLATE "C"; the live database's default
// collation is en_US.UTF-8, which is not byte order (read 2026-09-25), so the keyset read names the collation on both
// the ORDER BY and the comparison. JavaScript's plain string comparison is the same order for these ASCII ids.

export const BOQ_KEYSET_PAGINATION_FLAG = "BUILD001_BOQ_KEYSET_PAGINATION"
export const BOQ_LINE_PAGE_DEFAULT_LIMIT = 50
export const BOQ_LINE_PAGE_MAX_LIMIT = 200
export const BOQ_LINE_CURSOR_MAX_ID_LENGTH = 128

/** Read on every call: the environment at request time decides, not the environment at import. */
export function isBoqKeysetPaginationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env[BOQ_KEYSET_PAGINATION_FLAG] ?? "").trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes"
}

/** A position in (boq_id, id) order: the last row a page returned. */
export type BoqLineCursor = { boqId: string; id: string }

export function encodeBoqLineCursor(position: BoqLineCursor): string {
  return Buffer.from(JSON.stringify({ b: position.boqId, i: position.id }), "utf8").toString("base64url")
}

// The longest cursor encodeBoqLineCursor can mint: 15 bytes of JSON punctuation plus two ids of 128 UTF-16 units at
// up to 3 UTF-8 bytes each is 783 bytes, and base64 spends 4 characters per 3 bytes.
const BOQ_LINE_CURSOR_MAX_LENGTH = Math.ceil((15 + 2 * 3 * BOQ_LINE_CURSOR_MAX_ID_LENGTH) / 3) * 4

function isCursorId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > BOQ_LINE_CURSOR_MAX_ID_LENGTH) return false
  for (let k = 0; k < value.length; k++) {
    const code = value.charCodeAt(k)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

/**
 * The cursor's position, or null when `raw` is not a cursor this server minted. Null, not a guess: a malformed cursor
 * must never degrade to "start from the top" or to a wider read, the caller answers it with HTTP 400.
 */
export function decodeBoqLineCursor(raw: string): BoqLineCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > BOQ_LINE_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
  const keys = Object.keys(parsed).sort()
  if (keys.length !== 2 || keys[0] !== "b" || keys[1] !== "i") return null
  const { b, i } = parsed as { b: unknown; i: unknown }
  if (!isCursorId(b) || !isCursorId(i)) return null
  const position = { boqId: b, id: i }
  // Canonical form only: re-encoding must give back the exact input, so one position has exactly one spelling.
  return encodeBoqLineCursor(position) === raw ? position : null
}

/**
 * The page size: BOQ_LINE_PAGE_DEFAULT_LIMIT when absent, else a whole number from 1 to BOQ_LINE_PAGE_MAX_LIMIT.
 * Null for anything else (0, 201, "1.5", "abc", "-1"), which the caller answers with HTTP 400.
 */
export function parseBoqLinePageLimit(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return BOQ_LINE_PAGE_DEFAULT_LIMIT
  if (typeof raw === "string" && !/^[0-9]{1,3}$/.test(raw)) return null
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1 || limit > BOQ_LINE_PAGE_MAX_LIMIT) return null
  return limit
}

/**
 * The revision chain `selectedId` belongs to, in the order `boqs` already has: every older revision it supersedes
 * (walking parentBoqId up) and every newer revision that supersedes it (walking down, only non-empty when the caller
 * picked an older revision). parent_boq_id is UNIQUE (drizzle/0323), so a chain is a single line. A parent outside
 * `boqs` or a loop in parentBoqId stops the walk instead of hanging it.
 */
export function resolveRevisionChain<B extends { id: string; parentBoqId: string | null }>(boqs: B[], selectedId: string): B[] {
  const byId = new Map(boqs.map((b) => [b.id, b]))
  const childByParent = new Map<string, B>()
  for (const b of boqs) if (b.parentBoqId) childByParent.set(b.parentBoqId, b)
  if (!byId.has(selectedId)) return []

  const members = new Set<string>([selectedId])
  let older = byId.get(selectedId)
  while (older?.parentBoqId && byId.has(older.parentBoqId) && !members.has(older.parentBoqId)) {
    members.add(older.parentBoqId)
    older = byId.get(older.parentBoqId)
  }
  let newer = childByParent.get(selectedId)
  while (newer && !members.has(newer.id)) {
    members.add(newer.id)
    newer = childByParent.get(newer.id)
  }
  return boqs.filter((b) => members.has(b.id))
}
