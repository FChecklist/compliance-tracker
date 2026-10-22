// PROJEXA automatic error and action log -- POST a batch of device-captured events (owner request 2026-10-20).
// The user's own phone/laptop captures and batches; this route only validates, cleans (secrets stripped again here as
// defence), and stores them -- two inserts per batch, no other work. See src/lib/services/client-log-service.ts and
// docs/client-log.md. Any signed-in member, or an API key with write scope (PROJEXA's proxy), may send.
// A bad event never fails the request: the answer lists accepted + rejected[{index, reason}]. Over 120 events/minute
// for one person answers 429 with how many were still accepted, so the device backs off.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, readActingUserId } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import {
  MAX_EVENTS_PER_REQUEST,
  ingestClientLogEventsWithDb,
  takeRateAllowance,
  validateEvent,
  type CleanEvent,
} from "@/lib/services/client-log-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "viewer", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON: {events: [...]}" }, { status: 400 })
  }
  const events = (body as { events?: unknown } | null)?.events
  if (!Array.isArray(events)) return NextResponse.json({ error: "events must be an array" }, { status: 400 })
  if (events.length > MAX_EVENTS_PER_REQUEST) {
    return NextResponse.json({ error: `At most ${MAX_EVENTS_PER_REQUEST} events per request` }, { status: 400 })
  }

  const userId = ctx.dbUser?.id ?? readActingUserId(request) ?? null
  const rejected: Array<{ index: number; reason: string }> = []
  const valid: Array<{ index: number; event: CleanEvent }> = []
  events.forEach((raw, index) => {
    const v = validateEvent(raw)
    if (v.ok) valid.push({ index, event: v.event })
    else rejected.push({ index, reason: v.reason })
  })

  const allowed = takeRateAllowance(`${ctx.orgId}:${userId ?? "org"}`, valid.length)
  const toStore = valid.slice(0, allowed)
  for (const v of valid.slice(allowed)) rejected.push({ index: v.index, reason: "rate_limited" })
  const limited = allowed < valid.length

  try {
    if (toStore.length > 0) {
      await withTenantContext({ orgId: ctx.orgId, ...(userId ? { userId } : {}) }, (db) =>
        ingestClientLogEventsWithDb(db, { orgId: ctx.orgId!, userId }, toStore.map((v) => v.event))
      )
    }
  } catch (error) {
    console.error("v1 projexa client-logs ingest error:", error)
    return NextResponse.json({ error: "Could not store the log batch; try again later" }, { status: 500 })
  }

  if (limited) {
    return NextResponse.json(
      { accepted: toStore.length, rejected, error: "Rate limit: slow down", retryAfterSeconds: 60 },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }
  return NextResponse.json({ accepted: toStore.length, rejected })
}