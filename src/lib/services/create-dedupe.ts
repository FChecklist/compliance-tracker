// Shared by the retry guards on create endpoints (Sumeet UI audit 2026-10-19/20: R-C08 materials in #2167, then project and BOQ).
// PROJEXA gives up on a slow write after ~10 s and offers "Try again", but the write usually completes anyway, so a retry stored
// a second identical row. There is no idempotency-key table and a hand-added RLS table is the riskier route, so the guard is
// content-based: the same org + owner + content created inside this window IS the same create and the ORIGINAL row is returned.
// The advisory lock serialises a retry that arrives while the first attempt's transaction is still open (a plain
// read-then-insert would race straight past it). The lock is transaction-scoped, so it is released at commit/rollback.
import { sql, type AnyColumn, type SQL } from "drizzle-orm"
import type { TenantDb } from "@/lib/db/tenant-scoped"

export const CREATE_DEDUPE_WINDOW_MINUTES = 2

export async function lockCreateDedupeKey(db: TenantDb, parts: ReadonlyArray<string | null | undefined>): Promise<void> {
  const key = parts.map((p) => p ?? "").join("|")
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`)
}

/** `column >= now() - 2 minutes`; a row older than this is a deliberate later duplicate, not a retry. */
export function createdWithinDedupeWindow(column: AnyColumn): SQL {
  return sql`${column} >= now() - interval '2 minutes'`
}
