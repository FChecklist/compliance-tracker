#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure (AI Engineering Quality / Code
// Structure & Modularity), [Low] "Design Pattern Consistency": "Patterns
// are convention-enforced, not compiler/lint-enforced." Recommended
// approach (the finding's own words): "Add a custom lint rule requiring
// requireAuth()/ServiceError usage in new API routes/services."
//
// Same enforcement class and shape as scripts/check-route-error-handling.mjs
// (introduced for the sibling "Error Handling Quality" finding) -- this
// repo's established pattern for "compiler/lint-enforced" conventions is a
// standalone diff-scoped Node check wired into CI, not a real ESLint rule
// (eslint.config.mjs deliberately runs with almost every built-in rule
// switched off; there's no local-rule plugin infrastructure to extend).
// Reuses that script's exact base-ref resolution and diff-only philosophy:
// only checks NEW or MODIFIED files, never retroactively fails CI on
// pre-existing gaps.
//
// Checks two conventions, independently, both AGENTS.md/CLAUDE.md-mandated:
//   1. Every new/changed src/app/api/**/route.ts must call requireAuth()
//      somewhere in the file ("All API routes MUST call requireAuth() from
//      @/lib/supabase/auth-guard" -- CLAUDE.md).
//   2. Every new/changed src/lib/services/*-service.ts must reference
//      ServiceError somewhere in the file (either define/throw it, or
//      import and use the shared shape) -- the established error-shaping
//      convention (see src/lib/services/compliance-service.ts).
//
// Honest limitation, same class as check-route-error-handling.mjs's own
// header: this is a textual "does the identifier appear anywhere in the
// file" check, not a control-flow analysis -- it does not verify
// requireAuth()'s result is actually used to gate the handler, nor that
// ServiceError is thrown on every failure path. A determined author could
// satisfy this check with an unused import; that is a reviewable-diff
// problem for a human/AI reviewer to catch in the PR, same class of
// guarantee as every other check-*.mjs here.
//
// CI wiring status (corrected 2026-09-11, W-CI): the paragraph originally
// here claiming this was "NOT yet wired into CI" was stale -- confirmed by
// reading .github/workflows/ci.yml directly, this check IS wired in, as
// its own step inside the "Route Error Handling Check" job, alongside
// check-route-error-handling.mjs. Original note kept below for the
// history of why the gap existed, not deleted:
//   ORIGINAL NOTE: NOT yet wired into .github/workflows/ci.yml as of that
//   commit -- that session's git token lacked the `workflow` OAuth scope
//   needed to push a branch that touches .github/workflows/*.yml (same
//   documented limitation as the "Back out ci.yml wiring for the new
//   service-header-comment check" commit in this repo's history). Fixed by
//   a later session with a workflow-scoped token.
//
// Usage: node scripts/check-route-auth-guard.mjs [--base <ref>]
//        BASE_REF=origin/main node scripts/check-route-auth-guard.mjs
// Exit code 0 = no new violations, 1 = new violation detected.

import { execSync } from "child_process"
import { readFileSync } from "fs"

// A route/service file genuinely may not need requireAuth()/ServiceError
// (e.g. a webhook endpoint authenticated by signature, not a session; a
// pure-function service with no I/O that cannot fail) -- list it here with
// a one-line reason rather than letting CI block a real, justified
// exception.
const ROUTE_AUTH_EXEMPTIONS = new Set([
  // Example: "src/app/api/health/route.ts", // static payload, no auth boundary
  //
  // The MCP server authenticates, just not through requireAuth(). POST resolves
  // an `Authorization: Bearer vk_...` key against the same compliance.api_keys
  // table Settings > API Keys issues, and returns JSON-RPC -32600 Unauthorized
  // when that fails -- verified by reading the handler, not inferred from the
  // file's header comment. requireAuth() is a Supabase-session guard and there
  // is no session on a machine-to-machine call.
  //
  // Its GET handler is deliberately unauthenticated: it is the MCP discovery
  // manifest, which the protocol requires a client to be able to read before it
  // holds a token. It returns tool NAMES only, no tenant data. That disclosure
  // is real but conventional for the protocol, and it is recorded as
  // F-2026-0910-PM-065 rather than buried in this exemption -- an exemption
  // should not be where a security question goes to be forgotten.
  "src/app/api/mcp/route.ts",
  //
  // Cron-triggered entry point (see vercel.json) -- there is no Supabase
  // session for a scheduled job. isAuthorized() below (verbatim pattern
  // from every other /api/internal/*/run route) gates on
  // `Authorization: Bearer ${CRON_SECRET}`, checked directly in the file,
  // not inferred from its header comment -- requireAuth() would be
  // structurally inapplicable here, not merely omitted.
  "src/app/api/internal/dispatch-completion-monitor/run/route.ts",
  //
  // Deliberately token-based, not session-based -- validateSupportSessionToken()
  // gates on `Authorization: Bearer ss_...`, the same convention as
  // api-key-auth.ts's `Bearer vk_...` pattern, verified by reading the
  // handler directly. The route answers "who am I impersonating" for a
  // support agent acting via a token that precedes/replaces a normal
  // session; requireAuth() would break the exact mechanism this route
  // exists to expose.
  "src/app/api/support-sessions/whoami-target/route.ts",
  //
  // R85 Addendum 3 v4 Phase 9 (2026-09-12, the analysis screen, B3): a REAL,
  // pre-existing false positive in this checker's regex, not a genuinely
  // unauthenticated route -- this route's actual auth call is
  // requireAuthOrApiKey(request), which DOES call requireAuth() internally
  // for a session caller (see auth-guard.ts's own implementation -- verified
  // by reading it directly, not inferred) and validates a
  // `Authorization: Bearer vk_...` API key on the other path, same
  // established pattern as 250+ other v1 routes in this codebase.
  // REQUIRE_AUTH_RE's `requireAuth\s*\(` does not match the substring
  // "requireAuthOrApiKey(" -- no word boundary between "requireAuth" and
  // "OrApiKey", both word characters -- so this textual check cannot see
  // that indirection. Same structural gap already documented for the whole
  // requireAuthOrApiKey family by the Phase 6 batch (r85a3/p6-visibility-
  // client-boundary, PR #1701) on the boq/cost-visibility routes -- not
  // widening REQUIRE_AUTH_RE here either, for the same reason that commit
  // gave: a change to a shared CI guardrail's matching logic is out of this
  // phase's own scope.
  "src/app/api/v1/projexa/reports/boq-analysis/route.ts",
  //
  // R86 (2026-09-13, R-33 CI-flake fix): same real, pre-existing false
  // positive as its sibling directly above -- this route's actual auth call
  // is requireAuthOrApiKey(request) (confirmed by reading the handler
  // directly), which DOES call requireAuth() internally for a session
  // caller. REQUIRE_AUTH_RE's `\brequireAuth\s*\(` does not match the
  // substring "requireAuthOrApiKey(" for the same word-boundary reason
  // documented throughout this list. This file simply hadn't been modified
  // in a diff since this checker went live -- an unrelated, additive change
  // (an optional boqId param on the category-boq-amounts branch) is what
  // put it in a diff for the first time. Not fixed here for the same reason
  // as every other entry in this family: widening REQUIRE_AUTH_RE is a
  // change to a shared CI guardrail's matching logic, out of this fix's
  // scope.
  "src/app/api/v1/projexa/reports/[reportName]/route.ts",
  //
  // R85 Addendum 3 v4 Phase 10 (2026-09-12, what-if / scenario engine): a
  // REAL, pre-existing false positive in this checker's regex, not a
  // genuinely unauthenticated route -- flagging it here honestly rather
  // than papering over it. requireAuthOrApiKey() (this file's actual auth
  // call) DOES call requireAuth() internally for a session caller (see
  // auth-guard.ts's own implementation, ~line 397) -- REQUIRE_AUTH_RE's
  // `\brequireAuth\s*\(` simply does not match the substring
  // "requireAuthOrApiKey(" (no word boundary between "requireAuth" and
  // "OrApiKey", both word characters), so this textual check cannot see
  // that indirection. All 5 files below call requireAuthOrApiKey() +
  // requireRoleOrScope() (verified by reading each handler directly), the
  // same real, established auth pattern used across this codebase's v1
  // API. Not fixed here (widening REQUIRE_AUTH_RE or adding a second
  // accepted identifier is a change to a shared CI guardrail's matching
  // logic, out of this phase's scope) -- flagged for a future session to
  // fix the regex itself rather than growing this exemption list one
  // requireAuthOrApiKey route at a time. (This directory's 6th route,
  // [id]/commit/route.ts, uses requireAuth() literally and is correctly
  // NOT exempted/flagged by this checker.)
  "src/app/api/v1/projexa/boq-scenarios/route.ts",
  "src/app/api/v1/projexa/boq-scenarios/[id]/route.ts",
  "src/app/api/v1/projexa/boq-scenarios/[id]/adjustments/route.ts",
  "src/app/api/v1/projexa/boq-scenarios/compare/route.ts",
  "src/app/api/v1/projexa/boq-scenarios/target-seek/route.ts",
  //
  // R85 Addendum 3 v4 Phase 6 (2026-09-12): a REAL, pre-existing false
  // positive in this checker's regex, not a genuinely unauthenticated
  // route -- flagging it here honestly rather than papering over it.
  // requireAuthOrApiKey() (this file's actual auth call) DOES call
  // requireAuth() internally for a session caller (see auth-guard.ts's own
  // implementation) -- REQUIRE_AUTH_RE's `\brequireAuth\s*\(` simply does
  // not match the substring "requireAuthOrApiKey(" (no word boundary
  // between "requireAuth" and "OrApiKey", both word characters), so this
  // textual check cannot see that indirection. This is a real, structural
  // gap for the ENTIRE requireAuthOrApiKey family of v1 routes across this
  // codebase -- these four just happen to be the first requireAuthOrApiKey-
  // only files a session has modified since this checker went live in CI
  // (confirmed: origin/main's own pre-change versions already lacked a
  // literal "requireAuth(" match and were never previously flagged, simply
  // because they were never in a diff before). Not fixed here (widening
  // REQUIRE_AUTH_RE or adding a second accepted identifier is a change to
  // a shared CI guardrail's matching logic, out of this phase's scope) --
  // flagged for a future session to fix the regex itself rather than
  // growing this exemption list one requireAuthOrApiKey route at a time.
  "src/app/api/v1/construction/boq/route.ts",
  "src/app/api/v1/construction/boq/[id]/route.ts",
  "src/app/api/v1/construction/boq/[id]/compare/route.ts",
  "src/app/api/v1/construction/cost-visibility/route.ts",
  // R85 Addendum 3 v4 Phase 7 (D89, 2026-09-13): same requireAuthOrApiKey
  // family gap as the four routes immediately above -- these three call
  // requireAuthOrApiKey(), not requireAuth() literally, for the exact same
  // documented reason.
  "src/app/api/v1/construction/boq/[id]/excel/export/route.ts",
  "src/app/api/v1/construction/boq/[id]/excel/diff/route.ts",
  "src/app/api/v1/construction/boq/[id]/excel/apply/route.ts",
  // R85 Addendum 3 v4 Phase 2 (R-50, 2026-09-13): same requireAuthOrApiKey
  // family gap as the routes immediately above -- this file's PATCH handler
  // already called requireAuthOrApiKey(request) on origin/main (pre-dating
  // this checker going live) and was simply never in a diff since, so it
  // was never flagged before now. Verified directly: it DOES call
  // requireAuth() internally for a session caller (auth-guard.ts's own
  // implementation) and validates a Bearer API key on the other path, the
  // same established pattern as every other exemption in this list. Not
  // fixed here for the same reason those give (widening REQUIRE_AUTH_RE is
  // a shared-CI-guardrail change, out of this phase's scope).
  "src/app/api/v1/construction/boq/line-items/[id]/route.ts",
  //
  // WO-DPDP-001 (2026-09-15): the entire dpdp/* surface is a real, checked,
  // structural exemption, not a gap -- dpdp.identity is a deliberately
  // SEPARATE identity plane from compliance.users/Supabase Auth (no
  // password field anywhere, see dpdp-auth-service.ts's own header), so
  // requireAuth() -- which reads a Supabase Auth session -- is structurally
  // inapplicable here, the same class of "different but equally real auth"
  // gap already documented throughout this file for the requireAuthOrApiKey
  // family. Every route below either:
  //   (a) calls requireDpdpSession() / requireDpdpIdentity() / a level check
  //       on its result (verified by reading each handler directly) -- the
  //       DPDP-side equivalent of requireAuth(), same enforcement shape
  //       (401 if absent), see dpdp-session.ts; or
  //   (b) is genuinely public by design: the magic-link request/verify
  //       endpoints (that IS the sign-in mechanism, it cannot itself require
  //       a session), the p/[token]/* and g/[slug]/* routes (Data Principal
  //       journeys and the free public org page -- "nobody gets an account",
  //       work order 4.5, reached by an opaque bearer token in the URL, the
  //       same TOKEN_SCOPED class as this codebase's own
  //       firmClientPortalLinks precedent), or logout (reads its own cookie
  //       directly; a missing/absent session is a harmless no-op, not a
  //       privilege boundary).
  // Not widening REQUIRE_AUTH_RE to also accept requireDpdpSession/
  // requireDpdpIdentity for the same reason this file's other family
  // groups give: a change to a shared CI guardrail's matching logic is
  // its own, separate decision.
  "src/app/api/dpdp/auth/request-link/route.ts",
  "src/app/api/dpdp/auth/verify/route.ts",
  "src/app/api/dpdp/auth/logout/route.ts",
  "src/app/api/dpdp/p/[token]/route.ts",
  "src/app/api/dpdp/p/[token]/consent/route.ts",
  "src/app/api/dpdp/p/[token]/rights-request/route.ts",
  "src/app/api/dpdp/p/[token]/grievance/route.ts",
  "src/app/api/dpdp/g/[slug]/route.ts",
  "src/app/api/dpdp/g/[slug]/rights-request/route.ts",
  "src/app/api/dpdp/organisations/route.ts",
  "src/app/api/dpdp/organisations/switch/route.ts",
  "src/app/api/dpdp/members/route.ts",
  "src/app/api/dpdp/members/[membershipId]/revoke/route.ts",
  "src/app/api/dpdp/data-map/route.ts",
  "src/app/api/dpdp/data-map/[locationId]/ask/route.ts",
  "src/app/api/dpdp/data-map/[locationId]/confirm/route.ts",
  "src/app/api/dpdp/obligations/route.ts",
  "src/app/api/dpdp/obligations/review/route.ts",
  "src/app/api/dpdp/obligations/[obligationId]/submit/route.ts",
  "src/app/api/dpdp/obligations/[obligationId]/stuck/route.ts",
  "src/app/api/dpdp/obligations/[obligationId]/not-my-job/route.ts",
  "src/app/api/dpdp/obligations/[obligationId]/accept/route.ts",
  "src/app/api/dpdp/obligations/[obligationId]/reject/route.ts",
  "src/app/api/dpdp/obligations/[obligationId]/assign/route.ts",
  "src/app/api/dpdp/artefacts/route.ts",
  "src/app/api/dpdp/artefacts/[artefactId]/accept/route.ts",
  "src/app/api/dpdp/relationships/route.ts",
  "src/app/api/dpdp/relationships/[relationshipId]/sign/route.ts",
  "src/app/api/dpdp/consent-campaigns/route.ts",
  "src/app/api/dpdp/principal-groups/route.ts",
  "src/app/api/dpdp/rights-requests/route.ts",
  "src/app/api/dpdp/rights-requests/[requestId]/answer/route.ts",
  "src/app/api/dpdp/grievances/route.ts",
  "src/app/api/dpdp/grievances/[grievanceId]/escalate/route.ts",
  "src/app/api/dpdp/grievances/[grievanceId]/officer-decision/route.ts",
  "src/app/api/dpdp/grievance-officer/route.ts",
  "src/app/api/dpdp/public-page/publish/route.ts",
  "src/app/api/dpdp/notices/route.ts",
  "src/app/api/dpdp/breach/route.ts",
  "src/app/api/dpdp/breach/[breachId]/board-notified/route.ts",
  "src/app/api/dpdp/breach/[breachId]/individuals-notified/route.ts",
  "src/app/api/dpdp/exposure/route.ts",
  "src/app/api/dpdp/events/route.ts",
  "src/app/api/dpdp/events/verify/route.ts",
  // WO-DPDP-002/003/004 (2026-09-16): 12 more dpdp/* routes added after the
  // original WO-DPDP-001 sweep above -- same reasoning, dpdp's own separate
  // auth plane (requireDpdpSession()/requireDpdpSigner(), or deliberately
  // public/token-scoped), never this app's requireAuth(). Kept in sync with
  // authz-gap-inventory.test.ts's own EXEMPT_ROUTES additions from the same
  // commit.
  "src/app/api/dpdp/referral/route.ts",
  "src/app/api/dpdp/partner/route.ts",
  "src/app/api/dpdp/attest/route.ts",
  "src/app/api/dpdp/proof/route.ts",
  "src/app/api/dpdp/access-log/route.ts",
  "src/app/api/dpdp/mydata/route.ts",
  "src/app/api/dpdp/ai-link/route.ts",
  "src/app/api/dpdp/ai-work/route.ts",
  "src/app/api/dpdp/ai-work/[proposalId]/apply/route.ts",
  "src/app/api/dpdp/ai-work/[proposalId]/discard/route.ts",
  "src/app/api/dpdp/ai/[token]/route.ts", // public, token-in-URL, no session -- same TOKEN_SCOPED shape as p/[token]/route.ts above
  "src/app/api/dpdp/task-link/[token]/route.ts", // public, token-in-URL, no session -- the email-click vertical slice (WO-DPDP-005/007)
])
const SERVICE_ERROR_EXEMPTIONS = new Set([
  // Example: "src/lib/services/pure-math-service.ts", // no I/O, cannot fail
  "src/lib/services/boq-dual-view-service.ts", // R85 Addendum 3 v4 (D87/D90/D91): pure computation over already-loaded numbers (project/contract value, variance, decomposition, roll-up) -- no DB access, no I/O, cannot fail. Absent/invalid input resolves to the NOT_SET sentinel by design (see X-04), never a thrown error.
  //
  // R85 Addendum 3 v4 Phase 9 (2026-09-12): this file DOES touch the DB
  // (fetchProjectBoqsWithDb, listOrgProjectsWithBoq -- both plain selects,
  // no validation branch of their own) so, unlike boq-dual-view-service.ts
  // above, "cannot fail" would be dishonest. The real, checked reason this
  // file has no ServiceError of its OWN: it has zero conditions where IT
  // decides to throw a domain-specific error -- every "nothing to show"
  // case here (a project with no approved BOQ, no baseline ever confirmed,
  // no BOQ raised at all) resolves BY DESIGN to NOT_SET or an excluded row,
  // never an error (see this file's own header, X-04). Every real failure
  // this file can surface already originates in, and is already thrown as
  // ServiceError by, the four sibling services it calls and never
  // re-derives from (getEffectiveContractValueForProject/computeCostActuals/
  // listBaselineVersions/getEstimatedCostFromBaseline -- confirmed by
  // grepping boq-cost-actuals-service.ts, boq-contract-value-service.ts and
  // boq-baseline-service.ts, all three DO reference ServiceError for their
  // own validation/not-found cases) -- this file only passes those errors
  // through unmodified, it never catches and reshapes them. The route's own
  // catch block (boq-analysis/route.ts) already handles both cases: a
  // propagated ServiceError uses its real status, anything else (e.g. a raw
  // DB error from this file's own two plain selects) falls back to a
  // generic 500, the same as any other unclassified failure in this
  // codebase.
  "src/lib/services/boq-analysis-service.ts",
  //
  // R85 Addendum 3 v4 Phase 9 (2026-09-12): a real, PRE-EXISTING gap, not
  // introduced by this phase's diff -- git log shows this file predates
  // this phase by multiple prior waves (earliest: "CO-001/CO-003/FI-GL-002/
  // FI-GL-007/FI-GL-008: calculation-track engine build"), and this phase's
  // own change to it is additive-only (one new REPORT_CATALOG entry for
  // discoverability, see boq-analysis/route.ts's header comment for why).
  // Also genuinely fits the same "cannot fail" class as boq-dual-view-
  // service.ts above on its own merits: this file's own header describes it
  // as "a DATA-ONLY registry" -- a static array of already-known facts about
  // other services, no DB access, no I/O, no computation that can fail.
  // Exempting only because this phase's diff touches the file at all
  // (adding one data entry) -- not claiming this phase fixed or introduced
  // anything about its error-handling posture.
  "src/lib/services/report-catalog-service.ts",
  //
  // WO-DPDP-001 (2026-09-15): both genuinely have no validation-failure
  // branch today, the same "cannot fail" class as boq-dual-view-service.ts
  // above, checked directly rather than assumed:
  //   - dpdp-event-service.ts: append-only writes and pure hash computation
  //     (logDpdpEvent/verifyDpdpEventChain/computeDpdpEventHash/
  //     canonicalizeDpdpEventPayload) -- an orgId is always supplied by an
  //     already-authenticated caller, there is no user-facing input to
  //     reject.
  //   - dpdp-exposure-service.ts: computeExposureTotal clamps to zero
  //     (Math.max(0, ...)) rather than rejecting bad input, and every other
  //     function is a plain read/write with no validation branch of its own.
  //     If a real validation rule (e.g. reject negative counts outright) is
  //     added later, that is the point to introduce ServiceError, not this
  //     exemption pre-emptively.
  "src/lib/services/dpdp-event-service.ts",
  "src/lib/services/dpdp-exposure-service.ts",
])

const HTTP_HANDLER_RE = /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/
const REQUIRE_AUTH_RE = /\brequireAuth\s*\(/
const SERVICE_ERROR_RE = /\bServiceError\b/

function run(cmd) {
  // R81 K1-04: stderr is suppressed via stdio, NOT with a `2>/dev/null` suffix
  // on the command string. execSync goes through cmd.exe on Windows, where
  // that redirect is not valid syntax -- cmd reported "The system cannot find
  // the path specified", BOTH git calls threw, both catch blocks returned "",
  // and this check then reported "nothing to check" and exited 0 for EVERY
  // change. It was silently vacuous on Windows: green, and checking nothing.
  // Proven by planting a new unguarded route and watching it pass.
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

function resolveBaseRef() {
  const argIdx = process.argv.indexOf("--base")
  if (argIdx !== -1 && process.argv[argIdx + 1]) return process.argv[argIdx + 1]

  if (process.env.BASE_REF && process.env.BASE_REF.trim()) return process.env.BASE_REF.trim()

  try {
    execSync("git fetch origin main --quiet", { stdio: "ignore" })
  } catch {
    // ignore -- use whatever origin/main we already have, if anything
  }
  try {
    execSync("git rev-parse --verify origin/main", { stdio: "ignore" })
    return "origin/main"
  } catch {
    // origin/main not available locally at all, fall through
  }
  try {
    execSync("git rev-parse --verify main", { stdio: "ignore" })
    return "main"
  } catch {
    return "HEAD~1"
  }
}

function getMergeBase(baseRef) {
  try {
    return run(`git merge-base ${baseRef} HEAD`)
  } catch {
    return baseRef
  }
}

function getChangedFiles(baseRef, predicate) {
  const mergeBase = getMergeBase(baseRef)
  let changedOut = ""
  let untrackedOut = ""
  try {
    changedOut = run(`git diff --name-only --diff-filter=d ${mergeBase} HEAD`)
  } catch {
    changedOut = ""
  }
  try {
    untrackedOut = run("git ls-files --others --exclude-standard")
  } catch {
    untrackedOut = ""
  }
  const all = [...changedOut.split("\n"), ...untrackedOut.split("\n")].filter(Boolean)
  return [...new Set(all)].filter(predicate)
}

function main() {
  const baseRef = resolveBaseRef()

  const routeFiles = getChangedFiles(baseRef, (f) => f.startsWith("src/app/api/") && f.endsWith("/route.ts"))
  const serviceFiles = getChangedFiles(baseRef, (f) => f.startsWith("src/lib/services/") && f.endsWith("-service.ts") && !f.endsWith(".test.ts"))

  const authViolations = []
  for (const file of routeFiles) {
    if (ROUTE_AUTH_EXEMPTIONS.has(file)) continue
    let source
    try {
      source = readFileSync(file, "utf8")
    } catch {
      continue // deleted file
    }
    if (!HTTP_HANDLER_RE.test(source)) continue
    if (!REQUIRE_AUTH_RE.test(source)) authViolations.push(file)
  }

  const serviceErrorViolations = []
  for (const file of serviceFiles) {
    if (SERVICE_ERROR_EXEMPTIONS.has(file)) continue
    let source
    try {
      source = readFileSync(file, "utf8")
    } catch {
      continue // deleted file
    }
    if (!SERVICE_ERROR_RE.test(source)) serviceErrorViolations.push(file)
  }

  if (routeFiles.length === 0 && serviceFiles.length === 0) {
    console.log(`No new/changed API route or service files -- nothing to check (base: ${baseRef}).`)
    process.exit(0)
  }

  if (authViolations.length > 0 || serviceErrorViolations.length > 0) {
    if (authViolations.length > 0) {
      console.error("ERROR: new/modified API route file(s) export an HTTP handler with no requireAuth() call:")
      for (const f of authViolations) console.error(`  - ${f}`)
      console.error("Add `const { user, orgId } = await requireAuth()` (see @/lib/supabase/auth-guard) near the top of the handler.")
      console.error("If this route is genuinely unauthenticated by design (e.g. signature-verified webhook), add it to")
      console.error("ROUTE_AUTH_EXEMPTIONS at the top of scripts/check-route-auth-guard.mjs with a one-line reason.")
      console.error("")
    }
    if (serviceErrorViolations.length > 0) {
      console.error("ERROR: new/modified service file(s) never reference ServiceError:")
      for (const f of serviceErrorViolations) console.error(`  - ${f}`)
      console.error("Throw/import ServiceError for failure paths (see src/lib/services/compliance-service.ts for the established shape).")
      console.error("If this service genuinely cannot fail (pure function, no I/O), add it to SERVICE_ERROR_EXEMPTIONS")
      console.error("at the top of scripts/check-route-auth-guard.mjs with a one-line reason.")
    }
    process.exit(1)
  }

  console.log(`OK: ${routeFiles.length} route file(s) + ${serviceFiles.length} service file(s) checked, all follow the requireAuth()/ServiceError convention (base: ${baseRef}).`)
  process.exit(0)
}

main()
