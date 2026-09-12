#!/usr/bin/env node
// R85-ADDENDUM/register-consistency-check (added 2026-09-12, pm-t1 brief
// "wire 4 standing register-consistency proofs into CI"). Turns 4 real,
// one-off SQL/API investigations of `platform.sumeet_requirements` /
// `platform.sumeet_requirement_components` (the Sumeet requirement
// register R74-RULING-03 governs) into a real, checked-in, re-runnable CI
// check -- not a thing a session did once by hand and nobody can reproduce.
//
// THE FOUR PROOFS
// ----------------
// 1. CLOSURE-STATE DRIFT (c1 vs c6). closure_state ("c1") may, per this
//    register's own rule, only be written TRUE/CLOSED after c2, c3, c6 and
//    c7 are ALL TRUE for that row. As of 2026-09-12 there are 15 rows where
//    closure_state = 'CLOSED' but a component is genuinely 'FALSE' --every
//    one of them was set CLOSED before R84 demoted their c6 component back
//    to FALSE on audit, and nobody ever walked closure_state back down to
//    match. This is a KNOWN-RED gate BY DESIGN: it must NOT assert zero,
//    and must NOT be silently "fixed" by touching closure_state directly.
//    The only legitimate fix is landing real c6 evidence (a fresh CI run
//    that genuinely executes the row's closure_test_path) for a row, which
//    is what should make closure_state follow, and this script's own
//    EXPECTED_CLOSURE_DRIFT_IDS literal gets updated in that SAME PR. See
//    evaluateProof1() below.
//
// 2. CI-ANCESTRY. For every row whose c6 component is TRUE, its
//    closure_ci_run_id's commit (closure_commit_sha) must be an ancestor of
//    `main` in that ROW'S OWN closure_repo (closure_repo can genuinely be
//    'projexa', not just this repo -- checking the wrong repo produces a
//    false "commit not found" that looks exactly like a real ancestry
//    failure). Checked via the GitHub REST compare endpoint
//    (repos/{owner}/{repo}/compare/main...{sha}) for BOTH repos uniformly,
//    status 'identical'/'behind' = ancestor, 'ahead'/'diverged'/404 = not.
//    See evaluateProof2() / classifyCompareStatus().
//
// 3. CI-CITATION. For every row whose c6 component is TRUE, the RAW job log
//    (gh api .../actions/jobs/<id>/logs -- never `gh run view --log`, which
//    silently truncates) of the run's actual test-running job (resolved by
//    NAME, "Unit Tests" or "Test" -- never jobs[0], which is not guaranteed
//    to be the test job) must contain the row's own closure_test_path
//    string. A row whose citation doesn't actually appear in its own cited
//    run's log is real, reportable evidence fabrication/drift. See
//    resolveTestJobId() / logContainsTestPath().
//
// 4. NA SELF-CERTIFICATION (LITERAL SPEC, KNOWN VACUOUS TODAY). The literal
//    check the brief specifies is `na_ruling_id = verified_by` (exact
//    string equality). As of 2026-09-12 this predicate is VACUOUS BY
//    CONSTRUCTION: na_ruling_id values look like "R83-NA-R-A2-c1" and
//    verified_by values look like "W-VERIFY (local_2c4175a1-...)" -- two
//    different id namespaces that can never collide as literal strings,
//    confirmed by querying every distinct verified_by value that appears
//    against any NA row (currently exactly 2 distinct values, neither of
//    which is a na_ruling_id-shaped string). Implemented literally anyway
//    (in case the data format ever changes and this stops being vacuous),
//    but a permanent 0 here must NOT be read as "self-certification is
//    impossible" -- it only proves this exact literal predicate has never
//    fired. See evaluateProof4().
//
//    A 5th, REAL self-certification check was investigated as an addendum
//    (this script's own addition, beyond the brief) but NOT implemented:
//    the only columns available (requirement_id, component, state,
//    evidence_ref, na_reason, na_ruling_id, verified_by, verified_at,
//    updated_at) do not record WHO made the na_ruling itself as a
//    structured actor id -- only free-text verified_by records who
//    verified it. As of 2026-09-12 there are only 2 distinct verified_by
//    values across every NA row in the whole register, and neither embeds
//    a na_ruling_id-shaped session token in a way that could be compared
//    to na_ruling_id's own session prefix (one literally says "separate
//    from ruler <session>", the other has no ruler reference at all) --
//    there is no reliable way to detect "the same actor both ruled and
//    verified" from what's actually stored. Documented honestly rather
//    than shipping a check that looks rigorous but isn't. If a future
//    schema change adds a structured `na_ruled_by` actor column, THAT is
//    the real 5th proof to add here.
//
// DB ACCESS -- A REAL, CURRENTLY-UNRESOLVED BLOCKER, DOCUMENTED HONESTLY
// (2026-09-12). Read this before assuming this check is actually running.
// ------------------------------------------------------------------------
// The brief that started this script asked for the same secrets.DATABASE_URL
// / degrade-to-warning wiring the other DB-backed CI jobs use. That was
// tried FIRST, live, on this script's own PR (#1708) -- and it is silently,
// dangerously wrong for these two tables specifically: CI's DATABASE_URL
// connects as the `app_runtime` role (this app's normal tenant-scoped
// runtime role, see src/lib/db/tenant-scoped.ts), which does NOT have
// BYPASSRLS, and both platform.sumeet_requirements and platform.
// sumeet_requirement_components have RLS enabled with real SELECT policies
// ONLY for `service_role` (sumeet_requirement_components also grants
// `authenticated`, which app_runtime is not either) -- confirmed live via
// pg_policies. This is a DELIBERATE, consistent pattern across the
// governance/audit tables in this schema (claude_log, crr_*, uat_*, and
// every other sumeet_* table are the same: service_role-only). The live
// run proved this isn't theoretical: it connected fine and returned ZERO
// rows from BOTH tables with no error -- which would have made proof 1 (a
// KNOWN-RED gate that must never assert zero) silently report PASS with an
// empty set, exactly the false-negative this whole check exists to
// prevent elsewhere.
//
// A second attempt tried reading via the Supabase REST API (PostgREST)
// with the service role key -- the same SUPABASE_URL + SUPABASE_SERVICE_
// ROLE_KEY pair this repo's own doc-processing-job.yml already uses for
// other service-role-only tables, which genuinely bypasses RLS by design.
// This ALSO failed live, for a different reason: PostgREST on this project
// only exposes {public, graphql_public, compliance} as queryable schemas
// (confirmed via the live 406 PGRST106 response) -- `platform` is not
// exposed via REST at all, so `Accept-Profile: platform` is rejected
// regardless of the credential used.
//
// The actual minimal fix -- a new, additive, SELECT-only RLS policy
// granting `app_runtime` read access on just these two tables, mirroring
// the many already-existing app_runtime_read_* SELECT-only policies on
// sibling platform.* tables (module_registry, product_branches,
// ai_model_registry, etc.) -- was drafted and attempted live via the
// Supabase MCP, and was correctly BLOCKED by this platform's own safety
// classifier as "modifying system or security settings," a category this
// agent may never perform or route around regardless of how minimal or
// well-justified it looks from the inside. That block was respected in
// full: no other tool (raw execute_sql, a differently-worded migration,
// etc.) was used to work around it.
//
// CURRENT STATE, HONESTLY: neither DATABASE_URL nor the service-role REST
// path can reach this data from CI today. This script therefore degrades
// to a WARNING and exits 0 without running any of the 4 proofs, exactly
// like an unreachable database would -- it does NOT fabricate a PASS.
// UNBLOCKING THIS (owner or an authorized session, not a future agent
// working around the classifier): either (a) have the Owner/an authorized
// human apply the two-policy migration above directly (drizzle/ file left
// as a hand-authored, NOT-YET-APPLIED draft for this repo's usual
// platform-schema-migration workflow -- see check-register-consistency
// .sql.example if one is added alongside this, or re-derive the exact DDL
// from this comment), or (b) add `platform` to PostgREST's exposed-schema
// list (a project-level Supabase setting) and keep the REST path this
// script already implements. Until one of those happens, treat every
// "Register Consistency Check: PASS (warned)" run as "did not run," not as
// evidence the register is consistent.
//
// DEGRADES TO WARNING, same convention as the DATABASE_URL-gated jobs: an
// unreachable/misconfigured Supabase endpoint is an infrastructure
// condition, not proof of drift, so it warns and exits 0 rather than
// blocking every PR in the repo -- but see the honest caveat immediately
// above: today that warning fires on EVERY run, not just transient outages.
//
// Proofs 2 and 3 additionally need a GitHub token with cross-repo read
// access (closure_repo can be 'projexa', a different repo than this one)
// -- GITHUB_TOKEN alone cannot read another repo's Actions API, so these
// two proofs use PAT_FCHECKLIST (the same cross-repo PAT
// sync-vercel-env.yml already uses) and degrade to their own, independent
// warning if it's absent, without blocking proofs 1/4.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//          [GITHUB_TOKEN=... or PAT_FCHECKLIST=...] \
//          node scripts/check-register-consistency.mjs
// Exit code 0 = all runnable proofs pass (or DB/token unavailable, warned),
// 1 = a real, currently-runnable proof failed.

import { pathToFileURL } from "url"

// ---------------------------------------------------------------------
// Proof 1: closure-state (c1) vs c6 drift
// ---------------------------------------------------------------------

// The last-recorded expected set of CLOSED-but-c6-FALSE rows (see header
// above for why this is a KNOWN-RED gate, not a bug). Update this literal
// array, in the SAME PR that lands the fix, whenever a row is genuinely
// closed via real c6 evidence (or, in the other direction, if a NEW row is
// found in this same drifted state -- that would itself be a new incident
// worth its own investigation, not a silent literal bump).
export const EXPECTED_CLOSURE_DRIFT_IDS = [
  "R-01", "R-02", "R-11", "R-15", "R-30", "R-31", "R-32", "R-40", "R-41",
  "R-42", "R-43", "R-60", "R-90", "R-B1", "R-B2",
]

/**
 * currentRows: rows from
 *   select r.id from platform.sumeet_requirements r
 *   where r.closure_state = 'CLOSED'
 *     and exists (select 1 from platform.sumeet_requirement_components c
 *                 where c.requirement_id = r.id and c.state = 'FALSE')
 * Each row only needs an `id` field.
 */
/**
 * Pure join replacing the SQL EXISTS-subquery shape above, now that both
 * tables are fetched in full via REST (see header): every requirement
 * whose closure_state is 'CLOSED' AND has at least one component row with
 * state === 'FALSE'.
 */
export function computeClosureDriftRows(requirements, components) {
  const falseReqIds = new Set(
    components.filter((c) => c.state === "FALSE").map((c) => c.requirement_id)
  )
  return requirements.filter((r) => r.closure_state === "CLOSED" && falseReqIds.has(r.id))
}

export function evaluateProof1(currentRows, expectedIds = EXPECTED_CLOSURE_DRIFT_IDS) {
  const currentIds = [...new Set(currentRows.map((r) => r.id))].sort()
  const expected = [...new Set(expectedIds)].sort()
  const missing = expected.filter((id) => !currentIds.includes(id)) // expected but no longer drifting -- likely genuinely fixed, literal array needs updating
  const extra = currentIds.filter((id) => !expected.includes(id)) // drifting now but not previously recorded -- a NEW incident
  const pass = missing.length === 0 && extra.length === 0
  return { pass, currentIds, expectedIds: expected, missing, extra }
}

// ---------------------------------------------------------------------
// Proof 2: c6=TRUE rows' CI-run commit must be an ancestor of main, in
// THAT ROW'S OWN closure_repo.
// ---------------------------------------------------------------------

/**
 * Classifies a GitHub compare-endpoint response's `status` field.
 * 'identical' or 'behind' => sha IS an ancestor of main.
 * 'ahead' or 'diverged' => sha is NOT an ancestor of main.
 * status === null (e.g. a 404 -- commit not found on that repo) => NOT an
 * ancestor either (and almost always means the wrong repo was checked --
 * see header gotcha).
 */
export function classifyCompareStatus(status) {
  return status === "identical" || status === "behind"
}

/**
 * rows: [{ id, closure_repo, closure_commit_sha }] for every c6=TRUE row.
 * compareFn(repo, sha) => Promise<string|null> resolving to the compare
 * endpoint's `status` field, or null on any failure (network, 404, missing
 * sha). Injected so this is testable without live network/git state.
 */
export async function evaluateProof2(rows, compareFn) {
  const cache = new Map() // "repo|sha" -> status
  const failures = []
  for (const row of rows) {
    if (!row.closure_commit_sha || !row.closure_repo) {
      failures.push({ id: row.id, reason: "missing closure_repo/closure_commit_sha" })
      continue
    }
    const key = `${row.closure_repo}|${row.closure_commit_sha}`
    if (!cache.has(key)) {
      cache.set(key, await compareFn(row.closure_repo, row.closure_commit_sha))
    }
    const status = cache.get(key)
    if (!classifyCompareStatus(status)) {
      failures.push({ id: row.id, repo: row.closure_repo, sha: row.closure_commit_sha, status })
    }
  }
  return { pass: failures.length === 0, failures }
}

// ---------------------------------------------------------------------
// Proof 3: c6=TRUE rows' cited closure_test_path must actually appear in
// the raw log of the run's real test-running job.
// ---------------------------------------------------------------------

export function resolveTestJobName(jobs) {
  const job = jobs.find((j) => j.name === "Unit Tests" || j.name === "Test")
  return job ? job.id : null
}

export function logContainsTestPath(log, testPath) {
  if (log == null) return false
  // closure_test_path can be multiple files, "; "-separated (e.g. R-C16).
  const paths = testPath.split(";").map((p) => p.trim()).filter(Boolean)
  return paths.length > 0 && paths.every((p) => log.includes(p))
}

/**
 * rows: [{ id, closure_repo, closure_ci_run_id, closure_test_path }] for
 * every c6=TRUE row with a non-null closure_ci_run_id.
 * resolveJobIdFn(repo, runId) => Promise<number|null>
 * fetchLogFn(repo, jobId) => Promise<string|null>
 * Both injected for testability and so distinct (repo, run) / (repo, job)
 * pairs are resolved/fetched exactly once no matter how many rows share
 * them -- this check is realistically expensive (one network round trip
 * per distinct run/job), so aggressive caching matters for real runtime.
 */
export async function evaluateProof3(rows, resolveJobIdFn, fetchLogFn) {
  const jobCache = new Map() // "repo|runId" -> jobId|null
  const logCache = new Map() // "repo|jobId" -> log|null
  const failures = []
  for (const row of rows) {
    if (!row.closure_ci_run_id) {
      failures.push({ id: row.id, reason: "closure_ci_run_id is null" })
      continue
    }
    const jobKey = `${row.closure_repo}|${row.closure_ci_run_id}`
    if (!jobCache.has(jobKey)) {
      jobCache.set(jobKey, await resolveJobIdFn(row.closure_repo, row.closure_ci_run_id))
    }
    const jobId = jobCache.get(jobKey)
    if (jobId == null) {
      failures.push({ id: row.id, reason: "no 'Unit Tests'/'Test' job found on that run" })
      continue
    }
    const logKey = `${row.closure_repo}|${jobId}`
    if (!logCache.has(logKey)) {
      logCache.set(logKey, await fetchLogFn(row.closure_repo, jobId))
    }
    const log = logCache.get(logKey)
    if (!logContainsTestPath(log, row.closure_test_path)) {
      failures.push({ id: row.id, reason: `closure_test_path "${row.closure_test_path}" not found in job log`, repo: row.closure_repo, runId: row.closure_ci_run_id, jobId })
    }
  }
  return { pass: failures.length === 0, failures }
}

// ---------------------------------------------------------------------
// Proof 4: NA self-certification, literal spec (known vacuous today --
// see header).
// ---------------------------------------------------------------------

/**
 * Pure join replacing the SQL c.component='c6' AND c.state='TRUE' JOIN
 * shape above: every requirement with a c6 component row whose state is
 * 'TRUE', carrying the requirement's own closure_repo/closure_ci_run_id/
 * closure_commit_sha/closure_test_path (proofs 2 and 3 need these from the
 * requirement row itself, not the component row).
 */
export function computeC6TrueRows(requirements, components) {
  const c6TrueReqIds = new Set(
    components.filter((c) => c.component === "c6" && c.state === "TRUE").map((c) => c.requirement_id)
  )
  return requirements.filter((r) => c6TrueReqIds.has(r.id))
}

export function evaluateProof4(componentRows) {
  const violations = componentRows.filter(
    (r) => r.na_ruling_id != null && r.na_ruling_id === r.verified_by
  )
  return { pass: violations.length === 0, violations }
}

// ---------------------------------------------------------------------
// Live wiring (only runs under `node scripts/check-register-consistency.mjs`,
// not when imported for unit tests).
// ---------------------------------------------------------------------

async function ghApiJson(repo, path, token) {
  const res = await fetch(`https://api.github.com/repos/FChecklist/${repo}/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "check-register-consistency.mjs",
    },
  })
  if (!res.ok) return null
  return res.json()
}

async function ghApiText(repo, path, token) {
  const res = await fetch(`https://api.github.com/repos/FChecklist/${repo}/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "check-register-consistency.mjs",
    },
  })
  if (!res.ok) return null
  return res.text()
}

async function supabaseRestSelect(table, params, url, serviceRoleKey) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${url}/rest/v1/${table}?${qs}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Accept-Profile": "platform",
    },
  })
  if (!res.ok) {
    throw new Error(`Supabase REST select on platform.${table} failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("WARNING: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set -- skipping the register-consistency check.")
    console.warn("(Not DATABASE_URL -- see this script's own header for why these two tables need the service-role REST path instead.)")
    process.exit(0)
  }

  let exitCode = 0
  try {
    const requirements = await supabaseRestSelect(
      "sumeet_requirements",
      { select: "id,closure_state,closure_repo,closure_ci_run_id,closure_commit_sha,closure_test_path" },
      supabaseUrl, serviceRoleKey
    )
    const components = await supabaseRestSelect(
      "sumeet_requirement_components",
      { select: "requirement_id,component,state,na_ruling_id,verified_by" },
      supabaseUrl, serviceRoleKey
    )

    // ---- Proof 1 ----
    const proof1Rows = computeClosureDriftRows(requirements, components)
    const p1 = evaluateProof1(proof1Rows)
    console.log(`\n[Proof 1: closure-state drift] expected ${p1.expectedIds.length} known-red row(s), found ${p1.currentIds.length} live.`)
    if (p1.pass) {
      console.log("PASS -- current drifted-row set matches the last-recorded expected set exactly.")
    } else {
      console.error("FAIL -- the drifted-row set has changed since it was last recorded:")
      if (p1.missing.length) console.error(`  no longer drifting (update EXPECTED_CLOSURE_DRIFT_IDS in this same PR if genuinely fixed via c6 evidence): ${p1.missing.join(", ")}`)
      if (p1.extra.length) console.error(`  NEWLY drifting (real new incident, investigate before updating the literal array): ${p1.extra.join(", ")}`)
      exitCode = 1
    }

    // ---- Proof 4 ----
    const naComponentRows = components.filter((c) => c.na_ruling_id != null)
    const p4 = evaluateProof4(naComponentRows)
    console.log(`\n[Proof 4: NA self-certification, literal spec] checked ${naComponentRows.length} NA-ruled component row(s).`)
    if (p4.pass) {
      console.log("PASS -- 0 rows where na_ruling_id = verified_by (this predicate is known-vacuous today, see this script's header -- a permanent 0 is not a guarantee against real self-certification).")
    } else {
      console.error("FAIL -- na_ruling_id literally equals verified_by for:")
      for (const v of p4.violations) console.error(`  - ${v.requirement_id}/${v.component}: "${v.na_ruling_id}"`)
      exitCode = 1
    }

    // ---- Proofs 2 & 3 (need cross-repo GitHub API access) ----
    const token = process.env.PAT_FCHECKLIST || process.env.GITHUB_TOKEN
    if (!token) {
      console.warn("\nWARNING: no PAT_FCHECKLIST/GITHUB_TOKEN set -- skipping proofs 2 and 3 (CI-ancestry, CI-citation). These need cross-repo GitHub API read access (closure_repo can be 'projexa').")
    } else {
      const c6Rows = computeC6TrueRows(requirements, components)

      const compareFn = async (repo, sha) => {
        const data = await ghApiJson(repo, `compare/main...${sha}`, token)
        return data ? data.status : null
      }
      const p2 = await evaluateProof2(c6Rows, compareFn)
      console.log(`\n[Proof 2: CI-ancestry] checked ${c6Rows.length} c6=TRUE row(s).`)
      if (p2.pass) {
        console.log("PASS -- every c6=TRUE row's cited commit is an ancestor of main in its own closure_repo.")
      } else {
        console.error("FAIL -- the following row(s) cite a commit that is NOT an ancestor of main in their own closure_repo:")
        for (const f of p2.failures) console.error(`  - ${f.id}: repo=${f.repo ?? "?"} sha=${f.sha ?? "?"} status=${f.status ?? f.reason}`)
        exitCode = 1
      }

      const resolveJobIdFn = async (repo, runId) => {
        const data = await ghApiJson(repo, `actions/runs/${runId}/jobs`, token)
        if (!data) return null
        return resolveTestJobName(data.jobs || [])
      }
      const fetchLogFn = async (repo, jobId) => ghApiText(repo, `actions/jobs/${jobId}/logs`, token)
      const p3 = await evaluateProof3(c6Rows, resolveJobIdFn, fetchLogFn)
      console.log(`\n[Proof 3: CI-citation] checked ${c6Rows.length} c6=TRUE row(s).`)
      if (p3.pass) {
        console.log("PASS -- every c6=TRUE row's closure_test_path genuinely appears in its cited run's job log.")
      } else {
        console.error("FAIL -- the following row(s) cite a test path that does NOT appear in their own cited run's job log:")
        for (const f of p3.failures) console.error(`  - ${f.id}: ${f.reason}`)
        exitCode = 1
      }
    }

    process.exit(exitCode)
  } catch (err) {
    console.warn(`WARNING: could not complete the register-consistency check (${err.message ?? err}).`)
    console.warn("Not failing CI on this -- an unreachable/misconfigured Supabase REST endpoint is an infrastructure condition, not proof of drift.")
    process.exit(0)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
