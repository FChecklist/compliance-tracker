// DPDP audit trail -- the hash chain (owner spec 2026-10-06, items 1, 4 and 5). PURE: Web Crypto only.
//
// One chain PER ORGANISATION. Every row's `row_hash` binds the previous row's hash, the row's own content, and the values only the DATABASE decides (the row id,
// the organisation, the server clock in microseconds). Change, delete or reorder any row and every hash after it stops matching.
//
//   content_hash = sha256(content_canonical)                       -- computed IN POSTGRES from the stored canonical text (drizzle/0730), so the writer cannot lie
//   row_hash     = sha256(prev_hash | content_hash | id | org_id | server_time_us)
//   the first row of an org has prev_hash = GENESIS; after the 365-day purge the first REMAINING row's prev_hash is the hash of the last deleted row, which
//   the deletion certificate and dpdp.audit_chain_anchor keep for ever, so verification continues from that anchor.
//
// This file re-computes the same hashes in TypeScript so a person or an auditor can verify without trusting the database's own claim. The SQL and this file
// MUST stay identical byte for byte; src/lib/services/dpdp-audit-chain.test.ts pins both ends (and the SQL text) so a change to one fails the build.

export const GENESIS = "0".repeat(64)

/** JSON with keys sorted at every level and no whitespace: the same value always gives the same text, in any runtime. `undefined` members are dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonicalJson: non-finite number")
    return JSON.stringify(value === undefined ? null : value)
  }
  if (Array.isArray(value)) return "[" + value.map((v) => canonicalJson(v)).join(",") + "]"
  const o = value as Record<string, unknown>
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort()
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}"
}

export async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))
  let s = ""
  for (const b of d) s += b.toString(16).padStart(2, "0")
  return s
}

export const contentHashOf = (contentCanonical: string): Promise<string> => sha256Hex(contentCanonical)

export const rowHashOf = (prevHash: string, contentHash: string, id: string, orgId: string, serverTimeUs: number | string): Promise<string> =>
  sha256Hex(`${prevHash}|${contentHash}|${id}|${orgId}|${String(serverTimeUs)}`)

export type ChainRow = {
  seq: number | string
  id: string
  org_id: string
  event_type: string
  actor_user_id?: string | null
  server_time_us: number | string
  content_canonical: string
  content_hash: string
  prev_hash: string
  row_hash: string
}

export type ChainVerdict =
  | { ok: true; rows: number; head: string | null; firstSeq: number | null; lastSeq: number | null }
  | { ok: false; rows: number; brokenAtSeq: number; reason: "content_hash" | "row_hash" | "link" | "order" | "columns" | "org"; detail: string }

/**
 * Walk rows in `seq` order. `anchor` is the hash the first row must link to: GENESIS for a chain that was never purged, or the anchor kept at the last purge.
 * Stops at the first break and says which row and what kind of break (so "someone edited this row" and "someone deleted a row before it" read differently).
 */
export async function verifyChain(rows: ReadonlyArray<ChainRow>, anchor: string = GENESIS): Promise<ChainVerdict> {
  let prev = anchor
  let lastSeq: number | null = null
  let orgId: string | null = null
  let n = 0
  for (const r of rows) {
    const seq = Number(r.seq)
    if (lastSeq !== null && !(seq > lastSeq)) return { ok: false, rows: n, brokenAtSeq: seq, reason: "order", detail: "rows are not in strictly increasing order" }
    if (orgId === null) orgId = r.org_id
    else if (r.org_id !== orgId) return { ok: false, rows: n, brokenAtSeq: seq, reason: "org", detail: "rows of more than one organisation in one chain" }
    if (r.prev_hash !== prev) return { ok: false, rows: n, brokenAtSeq: seq, reason: "link", detail: "this row does not follow the previous row (a row before it was removed or changed)" }
    const ch = await contentHashOf(r.content_canonical)
    if (ch !== r.content_hash) return { ok: false, rows: n, brokenAtSeq: seq, reason: "content_hash", detail: "the stored content does not match its hash (the row was edited)" }
    let parsed: { org_id?: string; event_type?: string; actor?: { user_id?: string | null } } | null = null
    try { parsed = JSON.parse(r.content_canonical) } catch { parsed = null }
    if (!parsed || parsed.org_id !== r.org_id || parsed.event_type !== r.event_type || (r.actor_user_id ?? null) !== (parsed.actor?.user_id ?? null)) {
      return { ok: false, rows: n, brokenAtSeq: seq, reason: "columns", detail: "a searchable column no longer matches the sealed content" }
    }
    const rh = await rowHashOf(r.prev_hash, r.content_hash, r.id, r.org_id, r.server_time_us)
    if (rh !== r.row_hash) return { ok: false, rows: n, brokenAtSeq: seq, reason: "row_hash", detail: "the row hash does not match the row (id, organisation or time was changed)" }
    prev = r.row_hash
    lastSeq = seq
    n++
  }
  return { ok: true, rows: n, head: n ? prev : null, firstSeq: rows.length ? Number(rows[0].seq) : null, lastSeq }
}

/** One row checked on its own (no neighbours): its content matches its hash and its row hash matches its own fields. Used for a person's rows, which are not a contiguous stretch of the chain. */
export async function verifyRowSelf(r: ChainRow): Promise<boolean> {
  if ((await contentHashOf(r.content_canonical)) !== r.content_hash) return false
  return (await rowHashOf(r.prev_hash, r.content_hash, r.id, r.org_id, r.server_time_us)) === r.row_hash
}

/** The verification hash a downloaded file carries: sha256 of the canonical JSON of the whole body, `verification_hash` itself excluded. */
export async function fileVerificationHash(body: Record<string, unknown>): Promise<string> {
  const { verification_hash: _omit, ...rest } = body
  return sha256Hex(canonicalJson(rest))
}
