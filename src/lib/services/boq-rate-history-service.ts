// R85 Addendum 3 v4 (FINAL, claude_log 379), Phase 8 / spec section E5 --
// THE HISTORY DEFAULT / RATE LIBRARY (D91 Q8, gates 8-01..8-08).
//
// WHAT THIS IS. "On entering a BOQ line, the system OFFERS a rate_project
// default from what this firm ACTUALLY PAID BEFORE, with its source shown
// (which project, which date, which quantity, which rate). OFFERED, NEVER
// IMPOSED (8-03/X-17 -- a silently auto-filled wrong default is WORSE than a
// blank). Accept, edit or dismiss." This module is the read/offer/capture
// surface for that: it does not write rate_project itself -- the caller
// (the BOQ grid's own save path) does that, exactly as if the user had typed
// the number themselves. This module never auto-fills anything.
//
// WHERE THE DATA COMES FROM. Every past constructionBoqLineItems row in the
// CALLING ORG with a non-null rateProject (Phase 1's qtyProject/rateProject/
// qtyContract/rateContract columns on construction_boq_line_items, already
// merged to main -- see boq-dual-view-service.ts's own header for the
// single-producer money-figure rule this module deliberately does NOT
// duplicate: this module never computes project_value/contract_value/
// variance, it only surfaces a PAST rate_project as a suggested INPUT to a
// NEW line).
//
// MATCHING, PER 8-02: "Start simple -- exact and near-text match. NO
// embeddings in v1." classifyDescriptionMatch()/matchRateHistoryCandidates()
// below are the whole matcher: exact (normalized string equality) first,
// then a simple near-text check (normalized substring containment, either
// direction -- documented on classifyDescriptionMatch itself). Unit must
// always match exactly; an optional `trade` narrows further against the
// line's own `category` column (this table has no separate "trade" column --
// `category` free-text field, e.g. "Civil"/"Gypsum"/"Joinery", per R67 lane I
// item I-05 -- is the closest existing concept and is what "trade" maps to
// here; documented so a future reader doesn't go looking for a column that
// doesn't exist).
//
// ★ 8-07 IS A HARD SECURITY GATE -- ORG-SCOPED, NEVER CROSS TENANTS. ★
// Three independent layers, deliberately not just one:
//   1. DATABASE (RLS): compliance.construction_boq_line_items has RLS
//      ENABLED *and* FORCED, policy `app_runtime_tenant_isolation` --
//      verified live via the Supabase MCP against pcrjmlpuqsbocqfwoxod
//      before writing this file (pg_policy: USING EXISTS(SELECT 1 FROM
//      compliance.construction_boqs b WHERE b.id = construction_boq_line_
//      items.boq_id AND b.org_id = compliance.current_org_id())) --
//      app_runtime (rolbypassrls = false) cannot see another org's rows no
//      matter what SQL this file sends. compliance.construction_boqs itself
//      carries the identical policy shape directly on its own org_id column.
//   2. THE QUERY (defense-in-depth #1): the WHERE clause below explicitly
//      filters `eq(constructionBoqs.orgId, ctx.orgId)` on top of RLS,
//      matching this codebase's own established double-layered convention
//      (construction-boq-service.ts filters explicitly on orgId at every
//      read even though RLS also enforces it -- "trust one layer" is not
//      this codebase's posture for tenant data).
//   3. THE APPLICATION (defense-in-depth #2, and the layer this file's own
//      committed test suite can prove without a live database -- see this
//      file's sibling .test.ts for why): every row returned by the query is
//      RE-CHECKED against ctx.orgId before ever reaching a match. If layers
//      1 and 2 ever BOTH failed at once (the only way a foreign row could
//      arrive here at all), this layer refuses to silently drop the leaked
//      rows and hope nobody notices -- it throws, loudly, rather than
//      returning a partially-filtered result a caller might trust. A firm's
//      rate history crossing a tenant boundary is exactly the worst-case
//      leak D91/E1 warns rate_project is "the most sensitive field in the
//      product" over -- this function fails CLOSED, not open.
//
// A REAL, LIVE BEGIN...ROLLBACK proof of layer 1 (both directions, plus a
// deliberate RLS-bypass demonstrating the leak these three layers exist to
// prevent) was run once via the Supabase MCP against pcrjmlpuqsbocqfwoxod
// before this file was written -- see this PR's description for the full
// transcript (nothing was persisted; the whole fixture+proof ran inside one
// transaction that ended in ROLLBACK).
import { constructionBoqLineItems, constructionBoqs, projects, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, desc, eq, isNotNull } from "drizzle-orm"
import { logActivity } from "@/lib/audit"

export type RateHistoryContext = { orgId: string }
export type RateHistoryWriteContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

/** 8-02: "record the method" -- honest about HOW a suggestion matched. */
export type RateHistoryMatchMethod = "exact_description_and_unit" | "near_text_and_unit"

/**
 * One historical line item that has a real rate_project on it -- the raw
 * material findRateHistoryMatches's DB layer produces, before matching.
 * `orgId` is carried through explicitly (read off the JOINed construction_
 * boqs row, the actual RLS-protected column) so the layer-3 tenant re-check
 * below has real ground truth to compare against, not an assumption.
 */
export type RateHistoryCandidateLine = {
  lineItemId: string
  boqId: string
  orgId: string
  projectId: string
  projectName: string
  /** The line's own createdAt -- when THIS rate was actually entered. Chosen
   * over the parent BOQ's createdAt (the spec allows either) because a BOQ
   * can live through many revisions; the line's own timestamp is the more
   * precise "when did we pay this" answer 8-04's source requirement wants. */
  date: Date
  /** qtyProject -- the quantity this rate was actually priced against, not
   * the contract/billed quantity (qtyContract), which can legitimately
   * differ (D90/A4). */
  quantity: number | null
  rateProject: number
  description: string
  unit: string
  category: string | null
}

export type RateHistoryMatch = RateHistoryCandidateLine & { matchMethod: RateHistoryMatchMethod }

export type FindRateHistoryMatchesInput = {
  description: string
  unit: string
  /** Optional narrowing filter, matched against the line's `category`
   * column (see this file's header for why "trade" maps there). */
  trade?: string
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function toFiniteOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 8-02's matcher, exactly. Deliberately simple, per the spec's own
 * instruction ("Start simple -- exact and near-text match. NO embeddings in
 * v1"):
 *   "exact"  -- normalized (trimmed, lowercased, internal whitespace
 *               collapsed to a single space) strings are identical.
 *   "near"   -- neither string is empty and, after the same normalization,
 *               one contains the other as a substring, in EITHER direction.
 *               This is the whole "near-text" algorithm -- documented here,
 *               not left implicit, per this task's own instruction to pick
 *               and document a near-text approach. It catches the common
 *               real case of a longer typed description ("Supply and install
 *               20mm exterior grade plywood") containing a shorter saved one
 *               ("20mm plywood"), and vice versa, without pulling in a real
 *               fuzzy-match/edit-distance library for a v1 that the spec
 *               explicitly says must stay simple.
 *   "none"   -- neither of the above.
 * Pure function -- no DB, no org, so 8-02's exact/near/non-match cases are
 * directly testable without a database.
 */
export function classifyDescriptionMatch(
  candidateDescription: string,
  targetDescription: string
): "exact" | "near" | "none" {
  const a = normalizeText(candidateDescription)
  const b = normalizeText(targetDescription)
  if (!a || !b) return "none"
  if (a === b) return "exact"
  if (a.includes(b) || b.includes(a)) return "near"
  return "none"
}

/**
 * 8-02 (unit + optional trade) + 8-06 (ordering): the pure matching/ordering
 * core over an already-fetched candidate set. Unit must match exactly
 * (normalized) -- a "near" match on unit is never offered, since a rate for
 * the wrong unit of measure is actively misleading, not just imprecise.
 * `trade`, when supplied, narrows further against `category` (also exact,
 * normalized) -- it is a FILTER, never a substitute for the description/unit
 * match, and an uncategorised candidate (`category` null) never matches a
 * trade-narrowed search (there is nothing to compare against).
 * Ordered most-recent first (8-01 "ordered by recency") so
 * formatRateHistoryOffer never has to re-sort or guess which one is "the"
 * suggestion.
 */
export function matchRateHistoryCandidates(
  candidates: RateHistoryCandidateLine[],
  input: FindRateHistoryMatchesInput
): RateHistoryMatch[] {
  const targetUnit = normalizeText(input.unit)
  const targetTrade = input.trade ? normalizeText(input.trade) : null

  const matches: RateHistoryMatch[] = []
  for (const candidate of candidates) {
    if (normalizeText(candidate.unit) !== targetUnit) continue
    if (targetTrade !== null) {
      if (!candidate.category || normalizeText(candidate.category) !== targetTrade) continue
    }
    const method = classifyDescriptionMatch(candidate.description, input.description)
    if (method === "none") continue
    matches.push({
      ...candidate,
      matchMethod: method === "exact" ? "exact_description_and_unit" : "near_text_and_unit",
    })
  }

  return matches.sort((a, b) => b.date.getTime() - a.date.getTime())
}

/**
 * 8-01/8-07: the DB-touching half. ORG-SCOPED -- see this file's header for
 * the three isolation layers. Queries every past line in the calling org
 * with a real rate_project, then hands the result to the pure matcher above.
 */
export async function findRateHistoryMatches(
  ctx: RateHistoryContext,
  input: FindRateHistoryMatchesInput
): Promise<RateHistoryMatch[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db
      .select({
        lineItemId: constructionBoqLineItems.id,
        boqId: constructionBoqLineItems.boqId,
        orgId: constructionBoqs.orgId,
        projectId: constructionBoqs.projectId,
        projectName: projects.name,
        date: constructionBoqLineItems.createdAt,
        quantity: constructionBoqLineItems.qtyProject,
        rateProject: constructionBoqLineItems.rateProject,
        description: constructionBoqLineItems.description,
        unit: constructionBoqLineItems.unit,
        category: constructionBoqLineItems.category,
      })
      .from(constructionBoqLineItems)
      .innerJoin(constructionBoqs, eq(constructionBoqLineItems.boqId, constructionBoqs.id))
      .leftJoin(projects, eq(constructionBoqs.projectId, projects.id))
      .where(and(eq(constructionBoqs.orgId, ctx.orgId), isNotNull(constructionBoqLineItems.rateProject)))
      .orderBy(desc(constructionBoqLineItems.createdAt))

    const candidates = buildCandidatesFromRows(rows, ctx.orgId)
    return matchRateHistoryCandidates(candidates, input)
  })
}

/**
 * Raw shape read off the join in findRateHistoryMatches, before the
 * numeric-string parsing and tenant re-check below are applied. Exported so
 * this file's test suite can exercise buildCandidatesFromRows directly with
 * a fixture that never touches a real database -- see that test's own
 * header for why this is where 8-07's application-level (layer 3) guarantee
 * is actually provable in this repo's `bun test` suite.
 */
export type RawRateHistoryRow = {
  lineItemId: string
  boqId: string
  orgId: string | null
  projectId: string
  projectName: string | null
  date: Date
  quantity: string | number | null
  rateProject: string | number | null
  description: string
  unit: string
  category: string | null
}

/**
 * 8-07 layer 3 (the application-level tenant re-check -- see this file's
 * header). Drops rows with no usable rate_project (defensive -- the WHERE
 * clause above already filters this, but a row surviving `isNotNull` and
 * still failing to parse as a finite number would otherwise silently become
 * a wrong suggestion), and then re-asserts every remaining row's own org_id
 * -- read off the JOINed construction_boqs row, the actual RLS-governed
 * column -- equals the calling org. This should be UNREACHABLE given the
 * WHERE clause and RLS above; if it ever throws, both of those layers failed
 * at once, which is exactly the scenario 8-07 exists to catch. Fails
 * CLOSED: it throws rather than silently returning a partially-filtered
 * (and therefore still-trust-me) result.
 */
export function buildCandidatesFromRows(rows: RawRateHistoryRow[], callingOrgId: string): RateHistoryCandidateLine[] {
  const candidates: RateHistoryCandidateLine[] = []
  const foreignOrgIds = new Set<string>()

  for (const row of rows) {
    const rateProject = toFiniteOrNull(row.rateProject)
    if (rateProject === null) continue
    if (row.orgId !== callingOrgId) {
      // Do not push the row and do not return early -- collect every
      // offending org first so the thrown error (and a caller's logs) show
      // the full extent of a leak, not just the first row of it.
      if (row.orgId) foreignOrgIds.add(row.orgId)
      continue
    }
    candidates.push({
      lineItemId: row.lineItemId,
      boqId: row.boqId,
      orgId: row.orgId,
      projectId: row.projectId,
      projectName: row.projectName ?? "Unknown project",
      date: row.date,
      quantity: toFiniteOrNull(row.quantity),
      rateProject,
      description: row.description,
      unit: row.unit,
      category: row.category,
    })
  }

  if (foreignOrgIds.size > 0) {
    throw new Error(
      `boq-rate-history-service: 8-07 cross-tenant leak blocked -- expected only org ${callingOrgId}, ` +
        `also saw ${[...foreignOrgIds].join(", ")}. This should be unreachable (RLS + the query's own WHERE ` +
        `clause both scope to org_id already) -- refusing to return anything rather than risk a partial leak.`
    )
  }

  return candidates
}

export type RateHistoryOffer = {
  mostRecent: RateHistoryMatch
  otherMatchCount: number
  displayText: string
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function formatShortDate(date: Date): string {
  return `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]}`
}

/**
 * 8-03/8-04/8-06: turns a match list into the display-ready offer.
 * `mostRecent` is always the FULL RateHistoryMatch (project, date, quantity,
 * rate, description, matchMethod) -- 8-03/8-04 forbid ever offering a bare
 * number, and this function structurally cannot: there is no code path here
 * that extracts just the rate and discards the rest.
 *   0 matches -> null (8-06 "Zero matches -> no offer").
 *   1 match   -> otherMatchCount 0, displayText carries NO "other matches"
 *                text (8-06 "Single match -> no 'other matches' text").
 *   N matches -> the most recent highlighted plus an accurate count of the
 *                rest, per 8-06's own example shape
 *                ("AED 85, Oakwood 14 Aug — 4 other matches").
 * `currencyLabel` is optional and purely cosmetic for displayText -- this
 * module has no opinion on the org's base currency (that concern belongs to
 * boq-dual-view-service.ts, the single producer for money FIGURES; this
 * module only ever offers a rate as an INPUT, never computes with it).
 */
export function formatRateHistoryOffer(matches: RateHistoryMatch[], currencyLabel = ""): RateHistoryOffer | null {
  if (matches.length === 0) return null
  const [mostRecent, ...rest] = matches as [RateHistoryMatch, ...RateHistoryMatch[]]
  const otherMatchCount = rest.length
  const ratePart = currencyLabel ? `${currencyLabel} ${mostRecent.rateProject}` : `${mostRecent.rateProject}`
  const base = `${ratePart}, ${mostRecent.projectName} ${formatShortDate(mostRecent.date)}`
  const displayText =
    otherMatchCount > 0 ? `${base} — ${otherMatchCount} other match${otherMatchCount === 1 ? "" : "es"}` : base
  return { mostRecent, otherMatchCount, displayText }
}

export type RecordRateHistoryAcceptanceInput = {
  /** The NEW line the suggestion was applied to. */
  lineItemId: string
  /** The HISTORICAL line the offered rate actually came from -- 8-08 "captured
   * with the source it came from". */
  sourceLineItemId: string
  offeredRate: number
}

/**
 * 8-08: captures that a rate-history suggestion was accepted, and which
 * historical line it came from. Reuses this codebase's existing generic
 * audit trail (src/lib/audit.ts's logActivity / the auditLogs table) rather
 * than a parallel logging mechanism, per G-25 -- the same "write inside the
 * same withTenantContext transaction as the data write it documents"
 * convention every other logActivity call site in this codebase already
 * follows (see e.g. abac-policy-service.ts, approval-workflow-service.ts).
 * This function does NOT write rate_project itself -- accepting a suggestion
 * still goes through the BOQ line's own normal save path, exactly like any
 * other edit to that field (A8: "Project side ... freely editable. Every
 * change captured. NO evidence required."); this call only records the
 * provenance of where the accepted value came from, alongside that edit.
 */
export async function recordRateHistoryAcceptance(
  ctx: RateHistoryWriteContext,
  input: RecordRateHistoryAcceptanceInput
): Promise<void> {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    await logActivity({
      tx: db,
      orgId: ctx.orgId,
      dbUser: ctx.dbUser,
      action: "boq_rate_history.suggestion_accepted",
      entityType: "construction_boq_line_item",
      entityId: input.lineItemId,
      details: JSON.stringify({
        sourceLineItemId: input.sourceLineItemId,
        offeredRate: input.offeredRate,
      }),
    })
  })
}
