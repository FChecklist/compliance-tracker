// Wave 119: /api/v1 is the stable external contract PROJEXA (and any other
// external client) targets instead of the internal /api/construction/*
// routes, which can change without notice. Same service calls either way.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireActingPerson } from "@/lib/supabase/auth-guard"
import { listBoqs, parseBoqInclude, createBoq, ServiceError } from "@/lib/services/construction-boq-service"
// PROJEXA-BUILD-001 U-27 (BR-404): the paged list is reached through the module namespace, not a named import.
// boq-route.client-boundary.test.ts replaces construction-boq-service with a partial mock of the names imported
// above; a new named import would fail that file at link time although its flag-OFF path never calls it.
import * as boqService from "@/lib/services/construction-boq-service"
import { isBoqKeysetPaginationEnabled } from "@/lib/boq-line-keyset"
import { withRouteTiming } from "@/lib/route-timing"
// R85 Addendum 3 v4 Phase 6 (gates 6-01/6-03a): THE ONE GATE every BOQ read
// route must call before returning line items -- see cost-visibility-
// service.ts's own header for why. An API-key-only caller (ctx.dbUser null)
// has no real internal role to check and is always treated as cost-blind,
// same as this file's own comment on the shared-per-org-API-key posture.
import { applyCostVisibility } from "@/lib/services/cost-visibility-service"
import type { UserRole } from "@/lib/supabase/role-rank"

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    // PROJEXA's Work Progress Report needs each line item's rate/amount to
    // compute the report's Amt/Percentage columns, so `lineItems` is always
    // included -- that contract is unchanged.
    //
    // R67 F-23 (R-239) / F-04 (R-060/R-063) -- the SAME fix, arriving from two
    // lanes. It used to be satisfied with `Promise.all(boqs.map(getBoq))`, and
    // every getBoq() opens its OWN withTenantContext transaction, so an
    // N-revision project fanned out N concurrent transactions on a
    // five-connection pool. listBoqs() now does the whole thing in ONE
    // transaction (see its own header comment), and `?include=variation` adds
    // the per-revision variation figures PROJEXA's /scope screen used to fetch
    // with one /compare request PER ROW.
    //
    // R67 F-29 (R-273) adds `?include=compare`, which puts each revision's
    // lineCount / total / deltaAmount / deltaPct on the row. It shares the
    // SAME statement as `variation`, so asking for both is not a second query.
    const include = request.nextUrl.searchParams.get("include")
    const { variation, compare } = parseBoqInclude(include)
    const parts = ["lineItems"]
    if (variation) parts.push("variation")
    if (compare) parts.push("compare")
    // 6-01/6-03a: rate_project/qty_project (and any future project-side
    // figure) are stripped out below for any caller who is not granted cost
    // visibility -- client_viewer can NEVER pass this, unconditionally (see
    // canRoleSeeCost's hard floor).
    const role = (ctx.dbUser?.role as UserRole | undefined) ?? null

    // PROJEXA-BUILD-001 U-27 (BR-404, D-11 as amended by PMD-09): with BUILD001_BOQ_KEYSET_PAGINATION on (read on
    // every request), the response is the current revision's chain of headers with ONE page of the current
    // revision's line items plus revision/limit/nextCursor/hasMore; `cursor`, `limit` (1 to 200, default 50) and
    // `revision` query parameters page it (a bad value is 400). See listBoqsPage() in construction-boq-service.ts.
    // Same cost-visibility gate around it. With the flag off, nothing below this block changes.
    if (isBoqKeysetPaginationEnabled()) {
      const params = request.nextUrl.searchParams
      const page = await boqService.listBoqsPage({ orgId: ctx.orgId }, projectId, {
        include: parts.join(","),
        cursor: params.get("cursor"),
        limit: params.get("limit"),
        revision: params.get("revision"),
      })
      const pagedBody = await applyCostVisibility({ orgId: ctx.orgId }, role, page)
      return NextResponse.json(pagedBody)
    }

    const boqs = await listBoqs({ orgId: ctx.orgId }, projectId, { include: parts.join(",") })
    const responseBody = await applyCostVisibility({ orgId: ctx.orgId }, role, { boqs })
    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ list error:", error)
    return NextResponse.json({ error: "Failed to fetch BOQs" }, { status: 500 })
  }
}

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function POST(...args: Parameters<typeof POST_impl>) {
  return withRouteTiming("POST", () => POST_impl(...args))
}

async function POST_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    // R42 seq22 / R67 WS-H (D-05) fix class, missed instance found via the
    // Sumeet billing-milestones Playwright gap-closure sweep (2026-09-19):
    // `ctx.apiKey!.id` is an api_keys.id, not a real compliance.users.id --
    // PROJEXA's real proxy always authenticates with a shared per-org API
    // key, so createdById was silently the SAME single value for every BOQ
    // ever created through PROJEXA regardless of which real user clicked
    // Create, and approveBoq's self-approval guard could therefore never
    // distinguish two different PROJEXA users (see the sibling approve
    // route's own fix, same root cause). Resolves the real acting user via
    // the X-Acting-User/X-Acting-User-Email headers PROJEXA now sends.
    // U-20b (BR-215): the api-key-id fallback for "neither header present" is
    // gone -- that call now gets 400 ACTING_USER_REQUIRED, and a header that
    // does not resolve is refused (USER_NOT_LINKED) instead of being ignored.
    const { acting, error: actingError } = await requireActingPerson(request, ctx)
    if (actingError) return actingError
    const actorId = acting.person.id
    const result = await createBoq({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ create error:", error)
    return NextResponse.json({ error: "Failed to create BOQ" }, { status: 500 })
  }
}
