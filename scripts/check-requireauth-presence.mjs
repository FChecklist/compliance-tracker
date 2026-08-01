#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure (2026-08-01): Design Pattern
// Consistency -- "Patterns are convention-enforced, not compiler/lint-
// enforced. Add a custom lint rule requiring requireAuth()/ServiceError
// usage in new API routes/services."
//
// Real state confirmed before writing this: 927 of 991 src/app/api/**/
// route.ts files call requireAuth() from @/lib/supabase/auth-guard (93.5%),
// and every one of the other 64 has a genuine documented reason (cron jobs
// gated by CRON_SECRET, public token-resolved portals, public forms/
// webhooks, the API-key-gated MCP server, the healthcheck, the public
// OpenAPI spec, and route.ts files that re-export GET/POST from another
// route.ts whose own file this check already covers). This is not a
// hypothetical convention -- it's already near-universal; this script just
// makes "a NEW route.ts silently skips requireAuth()" a CI-visible fact
// instead of something only caught in code review, matching this
// codebase's existing check-*.mjs pattern (see check-guardrail-presence.mjs's
// own header for the same "reviewable-diff guarantee, not a runtime-
// unbypassable lock" honesty note -- that applies here too).
//
// EXEMPT_ROUTES is the same registered/exempted-nothing-in-neither pattern
// asset-registry-coverage.yaml/terminology-guardrail-exemptions.yaml already
// use: every currently-known non-requireAuth route.ts must be listed here
// with a reason, and this script itself verifies every listed path still
// exists (so the allowlist can't silently rot into covering routes that
// were deleted, or worse, renamed into something that should be checked).
// A NEW route.ts that lacks requireAuth() and isn't in this list fails CI --
// the author either adds requireAuth(), or adds a reasoned entry here (a
// visible, reviewable PR diff, same guarantee class as every other
// check-*.mjs gate).

import { readFile } from "node:fs/promises"
import path from "node:path"
import { readdirSync, statSync } from "node:fs"

const REPO_ROOT = process.cwd()
const API_ROOT = path.join(REPO_ROOT, "src/app/api")

const EXEMPT_ROUTES = [
  // Internal cron jobs -- CRON_SECRET bearer-token gated (isAuthorized()),
  // no user session exists for a scheduled job.
  "src/app/api/internal/ai-performance-report/run/route.ts",
  "src/app/api/internal/ai-reduction-snapshot/run/route.ts",
  "src/app/api/internal/audit-cadence/run/route.ts",
  "src/app/api/internal/capability-audit/run/route.ts",
  "src/app/api/internal/cost-anomalies/run/route.ts",
  "src/app/api/internal/dispatch-completion-monitor/run/route.ts",
  "src/app/api/internal/escalations-report/run/route.ts",
  "src/app/api/internal/exchange-rate-refresh/run/route.ts",
  "src/app/api/internal/fm-ppm/generate-occurrences/run/route.ts",
  "src/app/api/internal/idle-ai-capacity/run/route.ts",
  "src/app/api/internal/instruction-audit/run/route.ts",
  "src/app/api/internal/metric-alerts/run/route.ts",
  "src/app/api/internal/ops-task-sync/route.ts",
  "src/app/api/internal/orchestra-log-purge/run/route.ts",
  "src/app/api/internal/recommendations-report/run/route.ts",
  "src/app/api/internal/report-schedules/run/route.ts",
  "src/app/api/internal/risk-trends-report/run/route.ts",
  "src/app/api/internal/routing-accuracy-report/run/route.ts",
  "src/app/api/internal/secrets-audit/run/route.ts",
  "src/app/api/internal/task-nudge-digest/run/route.ts",
  "src/app/api/internal/the-firm/deadline-digest/run/route.ts",
  "src/app/api/internal/the-firm/recur-engagements/run/route.ts",

  // Public, token-resolved portals -- the token IS the credential (a
  // guessable-space-sized random token resolved server-side), not a user
  // session.
  "src/app/api/client-portal/[token]/deliverables/[deliverableId]/submit/route.ts",
  "src/app/api/client-portal/[token]/documents/route.ts",
  "src/app/api/client-portal/[token]/route.ts",
  "src/app/api/esignature/sign/[token]/decline/route.ts",
  "src/app/api/esignature/sign/[token]/route.ts",
  "src/app/api/esignature/sign/[token]/submit/route.ts",
  "src/app/api/guest-chat/[token]/messages/route.ts",
  "src/app/api/invite/[token]/route.ts",
  "src/app/api/partner/[token]/route.ts",
  "src/app/api/vendor-portal/[token]/auctions/[auctionId]/bid/route.ts",
  "src/app/api/vendor-portal/[token]/auctions/route.ts",
  "src/app/api/vendor-portal/[token]/bank-account/route.ts",
  "src/app/api/vendor-portal/[token]/route.ts",

  // Public pre-auth / SSO entry points -- these ARE the unauthenticated
  // login/passcode surface, by definition.
  "src/app/api/auth/passcode-login/route.ts",
  "src/app/api/auth/sso/[orgSlug]/acs/route.ts",
  "src/app/api/auth/sso/[orgSlug]/login/route.ts",

  // Public marketing/contact/onboarding forms and webhooks -- no session to
  // require by design (a visitor hasn't signed up yet).
  "src/app/api/contact/confirm/route.ts",
  "src/app/api/contact/draft/route.ts",
  "src/app/api/contact/submit/route.ts",
  "src/app/api/forge/captcha/route.ts",
  "src/app/api/forge/confirm/route.ts",
  "src/app/api/forge/submit/route.ts",
  "src/app/api/join-code/preview/route.ts",
  "src/app/api/public/portal/[orgSlug]/kb/[slug]/route.ts",
  "src/app/api/support-sessions/whoami-target/route.ts",
  "src/app/api/track/offer/route.ts",

  // Alternate auth mechanisms, not session-less by accident.
  "src/app/api/mcp/route.ts", // Bearer vk_... API key against api_keys table
  "src/app/api/health/route.ts", // trivial healthcheck, no auth needed
  "src/app/api/v1/openapi.json/route.ts", // public by design -- fetched before a customer has a key
  "src/app/api/ai/team/log-usage/route.ts", // AI_TEAM_LOG_SECRET bearer-gated -- caller is scripts/ai-workforce-agent.mjs (GitHub Actions), no Supabase session

  // Pure re-exports -- the real requireAuth() call lives in the
  // construction/* route.ts this file re-exports GET/POST from, which this
  // check already covers directly.
  "src/app/api/v1/projexa/ai/estimate-progress/route.ts",
  "src/app/api/v1/projexa/ai/risk-detection/route.ts",
  "src/app/api/v1/projexa/attendance/route.ts",
  "src/app/api/v1/projexa/kpis/route.ts",
  "src/app/api/v1/projexa/labour/route.ts",
  "src/app/api/v1/projexa/predictions/[activityId]/route.ts",
  "src/app/api/v1/projexa/scope/[id]/compare/route.ts",
  "src/app/api/v1/projexa/scope/[id]/revisions/route.ts",
  "src/app/api/v1/projexa/scope/[id]/route.ts",
  "src/app/api/v1/projexa/scope/route.ts",
  "src/app/api/v1/projexa/site-diary/route.ts",
  "src/app/api/v1/projexa/work-progress/route.ts",
]

function findRouteFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      results.push(...findRouteFiles(fullPath))
    } else if (entry === "route.ts") {
      results.push(fullPath)
    }
  }
  return results
}

const exemptSet = new Set(EXEMPT_ROUTES.map((p) => path.resolve(REPO_ROOT, p)))
const allRouteFiles = findRouteFiles(API_ROOT)

let failed = false
const violations = []
const staleExemptions = []

for (const fullPath of allRouteFiles) {
  const relPath = path.relative(REPO_ROOT, fullPath)
  const content = await readFile(fullPath, "utf8")
  if (content.includes("requireAuth")) continue
  if (exemptSet.has(fullPath)) continue
  failed = true
  violations.push(relPath)
}

for (const exempt of EXEMPT_ROUTES) {
  try {
    await readFile(path.resolve(REPO_ROOT, exempt), "utf8")
  } catch {
    staleExemptions.push(exempt)
  }
}

if (staleExemptions.length > 0) {
  console.error("=== requireAuth Presence Check: stale exemptions ===")
  console.error("These EXEMPT_ROUTES entries no longer exist on disk -- remove them from")
  console.error("scripts/check-requireauth-presence.mjs's manifest:\n")
  for (const line of staleExemptions) console.error(`  - ${line}`)
  failed = true
}

if (violations.length > 0) {
  console.error("=== requireAuth Presence Check FAILED ===")
  console.error("These src/app/api/**/route.ts files call neither requireAuth() nor")
  console.error("requireAuthOrApiKey(), and are not in scripts/check-requireauth-presence.mjs's")
  console.error("EXEMPT_ROUTES allowlist:\n")
  for (const line of violations) console.error(`  - ${line}`)
  console.error("\nEvery API route must call requireAuth() from @/lib/supabase/auth-guard,")
  console.error("unless it has a genuine reason not to (a public/pre-auth endpoint, a")
  console.error("cron job gated by CRON_SECRET, an alternate auth mechanism, or a pure")
  console.error("re-export of another route.ts this check already covers) -- in which")
  console.error("case add it to EXEMPT_ROUTES with a one-line reason, as a visible,")
  console.error("reviewable PR diff rather than a silent gap.")
}

if (failed) process.exit(1)

console.log(`requireAuth Presence Check passed -- ${allRouteFiles.length - EXEMPT_ROUTES.length} of ${allRouteFiles.length} route.ts files call requireAuth(), remaining ${EXEMPT_ROUTES.length} are documented exemptions.`)
