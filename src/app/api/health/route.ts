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
export async function GET() {
  const startedAt = Date.now()
  const region = process.env.VERCEL_REGION ?? null
  try {
    await db.execute(sql`select current_database() as db, current_user as usr`)
    return NextResponse.json(
      { ok: true, db: 'up', region, latencyMs: Date.now() - startedAt, ts: Date.now() },
      { status: 200 },
    )
  } catch (err) {
    const code = (err as { code?: string })?.code ?? null
    console.error('health: database probe failed', code, (err as Error)?.message)
    return NextResponse.json(
      { ok: false, db: 'down', region, code, latencyMs: Date.now() - startedAt, ts: Date.now() },
      { status: 503 },
    )
  }
}
