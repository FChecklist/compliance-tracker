// R53 Phase 6 -- GET /api/v1/projexa/pill-usage. The strip's ranking, and
// M24's HISTORY drop-down, read in one call because the composer renders
// them together.
//
// *** THE RANKING IS A QUERY, NOT A STORED NUMBER. *** There is no daily
// bucket table and there must not be one: MP-RULE-3's rolling 7-day window
// is a predicate over last_used_at, and a cached rank is a rank that goes
// stale the moment someone works.
//
// THREE TIERS, IN THIS ORDER, AND THE THIRD IS NOT OPTIONAL:
//   1. PINNED first, any age. M24: a pinned pill NEVER decays.
//   2. Inside the 7-day window, by use_count. That is MP-RULE-3.
//   3. OUTSIDE the window, by last_used_at, to fill the remaining slots.
//      That is MP-RISK-3, and dropping it is what makes month-end work
//      vanish for three weeks.
//
// PER USER, never per org: one PM's ranking must never reorder another's
// strip. The unique key on pill_usage is (org_id, user_id, pill_key).
import { NextRequest, NextResponse } from "next/server"
import { and, desc, eq, gte, lt } from "drizzle-orm"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { chainHistory, pillUsage } from "@/lib/db/schema"

const WINDOW_DAYS = 7

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

  const windowStart = new Date(Date.now() - WINDOW_DAYS * 86400000)

  try {
    const payload = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
      const scope = and(eq(pillUsage.orgId, ctx.orgId!), eq(pillUsage.userId, actorId))

      const pinned = await db
        .select()
        .from(pillUsage)
        .where(and(scope, eq(pillUsage.pinned, true)))
        .orderBy(desc(pillUsage.lastUsedAt))

      const inWindow = await db
        .select()
        .from(pillUsage)
        .where(and(scope, eq(pillUsage.pinned, false), gte(pillUsage.lastUsedAt, windowStart)))
        .orderBy(desc(pillUsage.useCount), desc(pillUsage.lastUsedAt))
        .limit(limit)

      const outsideWindow = await db
        .select()
        .from(pillUsage)
        .where(and(scope, eq(pillUsage.pinned, false), lt(pillUsage.lastUsedAt, windowStart)))
        .orderBy(desc(pillUsage.lastUsedAt))
        .limit(limit)

      // M24: PINNED above a divider, then RECENT. Include FAILED chains --
      // "the commonest reason to re-run something is that it went wrong."
      const history = await db
        .select()
        .from(chainHistory)
        .where(and(eq(chainHistory.orgId, ctx.orgId!), eq(chainHistory.userId, actorId)))
        .orderBy(desc(chainHistory.pinned), desc(chainHistory.lastUsedAt))
        .limit(historyLimit)

      const ranked = [...pinned, ...inWindow, ...outsideWindow]
      const seen = new Set<string>()
      const pills = ranked
        .filter((p) => (seen.has(p.pillKey) ? false : (seen.add(p.pillKey), true)))
        .slice(0, limit)
        .map((p) => ({
          pillKey: p.pillKey,
          functionId: p.functionId,
          derivedChain: p.derivedChain,
          useCount: p.useCount,
          pinned: p.pinned,
          lastUsedAt: p.lastUsedAt,
          // Which tier put this pill on the strip -- so the UI can explain a
          // ranking rather than assert one, and so a wrong order is
          // diagnosable from the response alone.
          tier: p.pinned ? "pinned" : p.lastUsedAt >= windowStart ? "window" : "last_used_ever",
        }))

      return {
        pills,
        history: history.map((h) => ({
          fullChain: h.fullChain,
          functionId: h.functionId,
          mode: h.mode,
          projectId: h.projectId,
          outcome: h.outcome,
          pinned: h.pinned,
          useCount: h.useCount,
          lastUsedAt: h.lastUsedAt,
        })),
        windowDays: WINDOW_DAYS,
        // EMPTY STATES MUST PROMPT, NEVER LOOK BROKEN (M24). A brand-new
        // user has earned no ranking and no history, and the caller needs to
        // know that is WHY the arrays are empty.
        isNewUser: ranked.length === 0,
      }
    })

    return NextResponse.json(payload)
  } catch (error) {
    console.error("v1 projexa pill-usage error:", error)
    const message = error instanceof Error ? error.message : "Failed to read pill usage"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
