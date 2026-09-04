// R68 Phase 7 (Institutional Memory Graph): Google Sheets projection.
//
// Owner ruling, 2026-09-03 (see R-IMG-06 Trap 6 in the R68 study, and this
// PR's own description): Supabase's `compliance.memory_records` stays the
// ONE canonical store. This job is a ONE-WAY, write-through projection --
// it reads selected memory_records rows and appends them to a Google
// Sheet as a readable/shareable mirror, refreshed on a schedule. It never
// reads anything Sheets holds back into Supabase, carries NO vectors or
// embeddings (Sheets cannot do vector search -- a hard technical fact, not
// a scope choice), and does not attempt any conflict resolution, because
// there are deliberately no two writable copies: Sheets is never written
// to by anything else, and this job never reads FROM Sheets at all. If a
// bidirectional path is ever wanted, that needs its own explicit
// conflict-resolution policy from the owner -- do not build toward it here,
// not even as a disabled flag (see this PR's own negative test asserting
// exactly that).
//
// ─── Selection criteria (this job's own reasonable default, documented
// here since the directive left it open) ────────────────────────────────
// Every memory_records row with lifecycle_state = 'ACTIVE' that does not
// yet have a compliance.memory_sources row with source_kind = 'SHEET_ROW'
// -- i.e. rows genuinely live (not CANDIDATE/TRANSIENT/SUPERSEDED/ARCHIVED)
// and not yet projected. CANDIDATE/TRANSIENT are excluded because they are
// not yet confirmed memory; SUPERSEDED/ARCHIVED are excluded because
// projecting stale content into a shared, human-facing mirror would be
// actively misleading. A record that later transitions OUT of ACTIVE (superseded/archived)
// is intentionally NOT retracted from the Sheet by this job -- that would
// require a delete/update-in-place capability this phase deliberately
// does not build (append-only, see google-sheets-client.ts's own header);
// removing stale rows from the mirror is left as a documented follow-up,
// not silently attempted here.
//
// ─── Join-back ───────────────────────────────────────────────────────
// After a successful append, this job inserts one compliance.memory_sources
// row per projected memory_records row with source_kind = 'SHEET_ROW' and
// sheet_row_ref set to the row's own "SheetName!A<n>" locator (as R68's
// study anticipated -- that column already existed for exactly this,
// added in drizzle/0520_r65_partc_phase1_memory_schema.sql). That value is
// a locator string this job computed from ITS OWN append call's response,
// never content read back from Sheets -- see this file's
// "no write-back" test for the falsifiable version of that claim.
//
// ─── Cron wiring ────────────────────────────────────────────────────
// Piggybacked onto the existing daily loops cron
// (src/app/api/internal/loops/run/route.ts), same convention as
// capability-index-freshness-audit.ts and the other non-canonical-loop
// jobs in that file's header comment -- this is infrastructure/projection
// work, not one of the 15 spec'd loop_definitions rows, so it does not get
// its own vercel.json cron entry.
//
// Uses the raw `db` client deliberately, same reasoning as
// capability-index-freshness-audit.ts: this is a platform-level sweep
// across every org's ACTIVE memory, not a single tenant's RLS-scoped
// request.
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { appendRows, expandRowRefs, isGoogleSheetsConfigured } from "@/lib/google-sheets-client"

export const MEMORY_SHEET_NAME = "MemoryRecords"

// Cap per run so one cron tick can't try to append an unbounded backlog in
// a single Sheets API call (Sheets/Apps Script quotas, and this codebase's
// own established "bounded sweep per tick" pattern -- see
// capability-index-freshness-audit.ts, which has no explicit cap only
// because its backlog is inherently small; this one guards against an
// initial huge backlog on first-ever run).
export const MAX_RECORDS_PER_RUN = 500

export type UnsyncedMemoryRow = {
  id: string
  scopeType: string
  orgId: string | null
  memoryType: string
  content: string
  confidence: string | null
  provenanceType: string
  lifecycleState: string
  createdAt: Date
}

/**
 * Pure formatting function, tested directly (same split as
 * byo-model-audit.ts's detectMissedEscalations): turns one DB row into the
 * flat string row this job writes to Sheets. Content is truncated -- a
 * Sheets cell has a 50,000-character hard limit and this mirror is meant
 * to be human-skimmable, not a full-fidelity export.
 */
export function toSheetRow(row: UnsyncedMemoryRow): string[] {
  const MAX_CONTENT_CHARS = 2000
  const content = row.content.length > MAX_CONTENT_CHARS ? `${row.content.slice(0, MAX_CONTENT_CHARS)}…` : row.content
  return [
    row.id,
    row.scopeType,
    row.orgId ?? "",
    row.memoryType,
    content,
    row.confidence ?? "",
    row.provenanceType,
    row.lifecycleState,
    row.createdAt.toISOString(),
  ]
}

export type MemorySheetsProjectionResult =
  | { skipped: true; reason: string }
  | { skipped: false; attempted: number; written: number; errors: number }

/**
 * The scheduled job. Never throws -- a cron caller (see run/route.ts) must
 * be able to call this unconditionally and get a result object back, same
 * "cron-safe" contract every other loop in this file's neighbors follows.
 * "Not configured" is exit-0-with-a-log, never an uncaught error.
 */
export async function runMemorySheetsProjectionJob(): Promise<MemorySheetsProjectionResult> {
  if (!isGoogleSheetsConfigured()) {
    console.log(
      "memory-sheets-projection: not configured (GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON / GOOGLE_SHEETS_SPREADSHEET_ID unset), skipping"
    )
    return { skipped: true, reason: "not_configured" }
  }

  let rows: UnsyncedMemoryRow[]
  try {
    const result = (await db.execute(sql`
      SELECT mr.id, mr.scope_type, mr.org_id, mr.memory_type, mr.content,
             mr.confidence, mr.provenance_type, mr.lifecycle_state, mr.created_at
      FROM compliance.memory_records mr
      LEFT JOIN compliance.memory_sources ms
        ON ms.memory_record_id = mr.id AND ms.source_kind = 'SHEET_ROW'
      WHERE mr.lifecycle_state = 'ACTIVE' AND ms.id IS NULL
      ORDER BY mr.created_at ASC
      LIMIT ${MAX_RECORDS_PER_RUN}
    `)) as unknown as Array<{
      id: string
      scope_type: string
      org_id: string | null
      memory_type: string
      content: string
      confidence: string | null
      provenance_type: string
      lifecycle_state: string
      created_at: Date
    }>
    rows = result.map((r) => ({
      id: r.id,
      scopeType: r.scope_type,
      orgId: r.org_id,
      memoryType: r.memory_type,
      content: r.content,
      confidence: r.confidence,
      provenanceType: r.provenance_type,
      lifecycleState: r.lifecycle_state,
      createdAt: new Date(r.created_at),
    }))
  } catch (err) {
    console.error("memory-sheets-projection: failed to select unsynced memory_records:", err)
    return { skipped: false, attempted: 0, written: 0, errors: 1 }
  }

  if (rows.length === 0) {
    return { skipped: false, attempted: 0, written: 0, errors: 0 }
  }

  let written = 0
  let errors = 0
  try {
    const sheetRows = rows.map(toSheetRow)
    const appendResult = await appendRows(MEMORY_SHEET_NAME, sheetRows)
    const refs = expandRowRefs(appendResult.updatedRange, rows.length)

    for (let i = 0; i < rows.length; i++) {
      const ref = refs[i]
      if (!ref) {
        // Sheets returned fewer refs than rows we sent -- do not guess a
        // locator for these; they simply stay unsynced and get retried
        // next run (still no memory_sources row = still selected by the
        // query above).
        errors++
        continue
      }
      try {
        await db.execute(sql`
          INSERT INTO compliance.memory_sources
            (id, memory_record_id, source_kind, sheet_row_ref)
          VALUES
            (${createId()}, ${rows[i].id}, 'SHEET_ROW', ${ref})
        `)
        written++
      } catch (err) {
        errors++
        console.error(`memory-sheets-projection: failed to record sheet_row_ref for ${rows[i].id}:`, err)
      }
    }
  } catch (err) {
    console.error("memory-sheets-projection: Sheets append failed:", err)
    return { skipped: false, attempted: rows.length, written: 0, errors: rows.length }
  }

  return { skipped: false, attempted: rows.length, written, errors }
}
