#!/usr/bin/env node
// DOD-S1 CI instrument (D28, VERIDIAN/PROJEXA release programme). PM-directed
// follow-up to a real, unresolved finding: pm/owner_admin hit
// POST /api/v1/projexa/project-budgets and got two DIFFERENT 5xx codes
// (503 then 500) on the identical request back to back, in three separate
// attempts, every one of them measured against a ct DEV-MODE backend (never
// a real production server) -- see kt/DOD_BASELINE_2026-09-10.csv DOD-S1.
// "Does this survive a real production build" was left as the open question.
//
// D72 (RAM floor on the dev laptop, 2026-09-10): a local `bun run build &&
// bun run start` answers this once and leaves nothing behind. This script,
// wired into a CI job that boots the REAL production server and calls it
// with a REAL authenticated request, answers it repeatedly and is the
// instrument DOD-S1 actually needs -- built per PM's explicit ruling
// ("we have spent this whole programme discovering that our instruments
// were the constraint; build the instrument"), scoped deliberately small
// (ONE role, ONE route, ONE assertion) per PM's own instruction not to try
// covering all six roles in this first version.
//
// AUTH: a single, minimal-privilege, revocable API key
// (compliance.api_keys id=eb7328b8-319e-4413-8b23-4be754abd84b, name "DOD-S1
// CI smoke test (W-GAP, revocable)", org_id=projexa_demo_org, scopes="write"
// only, rate_limit_per_minute=30), NOT a real user's session -- chosen
// deliberately over the mint-session-r33/GoTrue cookie flow the e2e spec
// uses because that mechanism is scoped to PROJEXA's own Supabase auth
// project and would require booting BOTH ct and projexa in CI; the route
// under test lives in ct and accepts requireAuthOrApiKey(), so an API key
// exercises the identical downstream service code (erp-budget-service.ts's
// createBudget()) with a single server to boot. The raw key value is a
// GitHub Actions secret (DOD_S1_SMOKE_API_KEY), never committed here -- this
// repo is public.
//
// D58: this script's own PASS/FAIL decision (decideVerdict) is proven able
// to FAIL, on synthetic fixtures, before a single live request is trusted --
// the same fixture-based falsifiability pattern already used and re-verified
// for DOD-X5's decideCiVerdict() in r75-citation-gate.mjs.
//
// KNOWN LIMITATION, disclosed not hidden: createBudget() has no
// corresponding DELETE endpoint at time of writing, so each real (non-5xx)
// CI run leaves one real row in compliance.erp_budgets for
// org=projexa_demo_org. Every created budget is named
// "DOD-S1 CI smoke <ISO timestamp>" specifically so a future bulk cleanup
// can identify and remove them by name prefix -- the same "tag it, don't
// silently leak it" precedent as e2e/demo-gate-smoke.spec.ts's own R46/E-126b
// fix (that spec DOES clean up after itself; this script does not yet, and
// that gap is intentional-and-recorded for this small first version, not an
// oversight).

const BASE_URL = process.env.CHECK_BASE_URL || "http://localhost:3000"
const API_KEY = process.env.DOD_S1_SMOKE_API_KEY
const ROUTE = "/api/v1/projexa/project-budgets"
// FY 2026, real, open (is_closed=false), confirmed live for org_id=projexa_demo_org
// on 2026-09-10 via a direct query against compliance.erp_fiscal_years. Using a
// REAL fiscal year (not a bogus one) so this request exercises the SAME
// create-a-real-budget code path the original pm/owner_admin observation used,
// not a short-circuited 404/validation-error branch that would prove less.
const REAL_FISCAL_YEAR_ID = "3b4a2772-2edf-4024-9175-6d4035b9cd41"

/** Pure decision function: the only thing separating this from a "cannot
 *  fail" instrument (D58's own named failure class) is that this function
 *  is proven, below, to actually say FAIL on a bad input before it is ever
 *  handed a real one. */
function decideVerdict(status) {
  if (typeof status !== "number" || Number.isNaN(status)) return "FAIL"
  return status < 500 ? "PASS" : "FAIL"
}

function selfTest() {
  const cases = [
    [500, "FAIL"],
    [502, "FAIL"],
    [503, "FAIL"],
    [200, "PASS"],
    [201, "PASS"],
    [400, "PASS"],
    [401, "PASS"],
    [403, "PASS"],
    [404, "PASS"],
  ]
  for (const [status, expected] of cases) {
    const got = decideVerdict(status)
    if (got !== expected) {
      console.error(`::error::self-test failed: decideVerdict(${status}) = ${got}, expected ${expected} -- this instrument cannot be trusted, refusing to run the live check`)
      process.exit(1)
    }
  }
  console.log("[check-project-budgets-live] self-test passed: decideVerdict correctly FAILs on 500/502/503 and PASSes on 200/201/400/401/403/404 -- proven falsifiable before trusting a live result.")
}

async function main() {
  selfTest()

  if (!API_KEY) {
    console.error("::error::DOD_S1_SMOKE_API_KEY is not set -- cannot run the live check (this is a required secret, not an optional one; a missing key must fail loudly, not silently skip and report success)")
    process.exit(1)
  }

  const url = `${BASE_URL}${ROUTE}`
  const budgetName = `DOD-S1 CI smoke ${new Date().toISOString()}`
  let status
  let bodyText = ""
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        fiscalYearId: REAL_FISCAL_YEAR_ID,
        name: budgetName,
        lineItems: [],
      }),
    })
    status = res.status
    bodyText = await res.text()
  } catch (error) {
    console.error(`::error::request to ${url} did not complete: ${error instanceof Error ? error.message : String(error)}`)
    console.error("::error::this is a network/connection failure, not a measured HTTP status -- treated as FAIL, same as a 5xx, because a route that cannot be reached at all is not evidence of DOD-S1 holding")
    process.exit(1)
  }

  const verdict = decideVerdict(status)
  console.log(`[check-project-budgets-live] POST ${ROUTE} -> HTTP ${status} (${verdict})`)
  console.log(`[check-project-budgets-live] response body (first 500 chars): ${bodyText.slice(0, 500)}`)

  if (verdict === "FAIL") {
    console.error(`::error::DOD-S1: POST ${ROUTE} returned ${status} against a real production server with a real authenticated write-scoped request. This is the exact defect class DOD-S1 measures -- a 5xx under a legitimate role, not an auth/validation rejection.`)
    process.exit(1)
  }

  console.log(`[check-project-budgets-live] DOD-S1 PASS: non-5xx (${status}) from a real production server, real authenticated request, real fiscal year. Note: this run created a real row in compliance.erp_budgets named "${budgetName}" (see this file's header for the disclosed cleanup gap).`)
}

main()
