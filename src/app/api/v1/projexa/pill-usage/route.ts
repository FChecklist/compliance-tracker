// R53 Phase 6 / R67 A-07 -- /api/v1/projexa/pill-usage. The composer strip's
// ranking and M24's chain history, read in one call because the composer
// renders them together.
//
// *** THE RANKING IS A QUERY, NOT A STORED NUMBER. *** There is no daily
// bucket table and there must not be one: MP-RULE-3's rolling 7-day window
// is a predicate over last_used_at, and a cached rank is a rank that goes
// stale the moment someone works. The three tiers (PINNED at any age, then
// inside the window by use_count, then OUTSIDE it by last_used_at -- MP-RISK-3,
// without which month-end work vanishes for three weeks) now live in
// src/lib/services/projexa-pill-usage-service.ts, unit-tested without a
// database, rather than inline in this handler.
//
// R67 A-07 ADDS TWO THINGS:
//
//   1. A LABEL PER RANKED ENTRY. The response used to carry a bare pillKey.
//      That was fine while every key was one of the fourteen universal pill
//      keys the client knew by heart; it stops being fine now that leaf CARD
//      ids are recorded ("work-progress.entry"), because a client with no
//      match for a key would have nothing to print but the key. PROJEXA's
//      forked PillStrip drops keys it does not recognise, and this label is
//      what lets it render the ones it half-recognises instead.
//
//   2. A WRITE PATH (POST). Card clicks were counted in the BROWSER's
//      localStorage only, so the server ranked from rows that only the
//      pipeline had ever written -- and most card clicks NAVIGATE rather than
//      execute, so the ranking never learned what this user actually does.
//      POST records one click. Recording is not running: nothing here calls a
//      function, and the row is the strip's memory and nothing more.
//
// R67 A-08 ADDS A THIRD: `recentChains`, the top three LEAF chains of the last
// seven days, for the composer's "Do again" cards. It is computed from the
// SAME compliance.chain_history rows this response's `history` is built from,
// in the same transaction -- a second query for "the recent three" would be a
// second thing that could disagree with the first. The chain_history WRITE is
// unchanged and already correct: run-submission.ts records one row per task on
// both the typed and the pill path, with outcome "ok" or "failed", so a failed
// chain is kept and can be repeated (M24: the commonest reason to re-run
// something is that it went wrong).
//
// No migration: compliance.pill_usage.pill_key is free text and derived_chain
// is jsonb, so a leaf id and its chain fit the columns that already exist, and
// compliance.chain_history already has every column A-08 needs.
//
// PER USER, never per org: one PM's ranking must never reorder another's
// strip. The unique key on pill_usage is (org_id, user_id, pill_key).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import {
  normaliseRecordedPillKey,
  readPillStrip,
  recordPillUse,
} from "@/lib/services/projexa-pill-usage-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr

  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
  const url = new URL(request.url)
  const limitRaw = Number(url.searchParams.get("limit") ?? "6")
  // M24: "nobody sees 25 pills, they see their top five or six."
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 25) : 6
  const historyLimitRaw = Number(url.searchParams.get("historyLimit") ?? "6")
  // M24: "Five or six entries, never twenty."
  const historyLimit = Number.isFinite(historyLimitRaw) ? Math.min(Math.max(Math.trunc(historyLimitRaw), 1), 20) : 6

  try {
    const payload = await readPillStrip({ orgId: ctx.orgId, userId: actorId, limit, historyLimit })
    return NextResponse.json(payload)
  } catch (error) {
    console.error("v1 projexa pill-usage error:", error)
    const message = error instanceof Error ? error.message : "Failed to read pill usage"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

/**
 * R67 A-07 -- record one card/pill click.
 *
 * Body: { pillKey, functionId?, chain? } where `chain` is the derived chain
 * the client built ({ root, steps, full }). The chain is what makes a leaf id
 * renderable later: labelForPillKey() reads its last step, so a strip on
 * another device can show "Record progress" for a key it has never seen.
 *
 * *** THIS DOES NOT EXECUTE ANYTHING. *** It requires the "write" scope
 * because it writes a row, not because it performs any user-visible action;
 * there is no functionId dispatch on this path and no executor is reachable
 * from it.
 */
export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr

  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
    }

    const pillKey = normaliseRecordedPillKey(body.pillKey)
    if (!pillKey) {
      return NextResponse.json({ error: "pillKey must be a non-empty string of at most 120 characters" }, { status: 400 })
    }

    const functionId = typeof body.functionId === "string" && body.functionId.trim() ? body.functionId.trim() : null
    const derivedChain = body.chain && typeof body.chain === "object" ? body.chain : undefined

    await recordPillUse({ orgId: ctx.orgId, userId: actorId, pillKey, functionId, derivedChain })
    return NextResponse.json({ recorded: pillKey }, { status: 201 })
  } catch (error) {
    console.error("v1 projexa pill-usage POST error:", error)
    const message = error instanceof Error ? error.message : "Failed to record pill usage"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
