// E-105: this route was previously `runtime = 'edge'` returning an
// unconditional {ok:true}. It touched no database, no env var and no
// dependency, so it reported 200 OK for the entire 21-22 Aug outage while
// every real page 500'd with 28P01 on the SAME deployment.
// A guard that cannot fail is worse than no guard (AR-08).
//
// Now: nodejs runtime, one real round trip through the SAME pooled driver
// the app itself uses (@/lib/db -> postgres-js, DATABASE_URL), and 503 on
// failure so the signal is honest. Deliberately NOT `select 1` as a bare
// literal -- that can be answered by a pooler without a live backend
// session; reading a real catalog row proves an authenticated connection.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getStorageStatus } from '@/lib/storage-config'

// R52: report the region this function actually executed in, alongside the
// DB latency it measured. Without this the two numbers can't be related to
// each other -- `latencyMs` on its own cannot distinguish "the query was
// slow" from "the query was fast but ran a continent away", which is exactly
// the confusion that made the cross-region round trip invisible for weeks.
//
// The pairing is what makes it useful: this same probe measured latencyMs 62
// consistently from sin1 (Singapore) against a database in ap-south-1
// (Mumbai), while the identical statement's server-side `EXPLAIN ANALYZE`
// Execution Time is 0.105 ms. Effectively all 62 ms was network. Emitting
// `region` makes that finding re-checkable by anyone with curl, and makes a
// silent region regression (or a vercel.json `regions` value that isn't
// being honoured) visible instead of merely slow.
// R67 D-78: `storageConfigured` is reported alongside the DB probe, for the same
// reason the DB probe replaced the unconditional {ok:true}: every upload path in
// this repo asserts SUPABASE_SERVICE_ROLE_KEY with a `!` and finds out it was
// missing only when a user has already chosen a file. It is true ONLY when the
// service-role key resolves AND the upload bucket exists (see storage-config.ts,
// which caches the answer for 60 s so this route stays cheap to poll).
//
// Deliberately just the boolean here: this route is unauthenticated, so it must
// not say WHICH env var is missing. The operator's half of the answer is in the
// server log storage-config.ts writes, and in the authenticated
// /api/v1/projexa/storage-status route the PROJEXA upload screens read.
//
// A storage failure is NOT a 503: the app serves every non-upload page perfectly
// well without a bucket, and turning this route red would take a deployment out
// of rotation for a fault that affects three screens.
export async function GET() {
  const startedAt = Date.now()
  const region = process.env.VERCEL_REGION ?? null
  // Never allowed to fail the health check itself -- getStorageStatus() already
  // swallows its own errors, and this is the belt to that braces.
  const storageConfigured = await getStorageStatus()
    .then((s) => s.storageConfigured)
    .catch(() => false)
  try {
    await db.execute(sql`select current_database() as db, current_user as usr`)
    return NextResponse.json(
      { ok: true, db: 'up', storageConfigured, region, latencyMs: Date.now() - startedAt, ts: Date.now() },
      { status: 200 },
    )
  } catch (err) {
    const code = (err as { code?: string })?.code ?? null
    console.error('health: database probe failed', code, (err as Error)?.message)
    return NextResponse.json(
      { ok: false, db: 'down', storageConfigured, region, code, latencyMs: Date.now() - startedAt, ts: Date.now() },
      { status: 503 },
    )
  }
}
