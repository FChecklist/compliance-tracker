#!/usr/bin/env node
// DB ROLE POSTURE CHECK -- which Postgres role does each connection string
// ACTUALLY authenticate as, and does that role bypass row-level security?
//
// WHY THIS EXISTS (PROJEXA-COST-001, prepared 2026-09-22; full record in
// ai-os/DB_ROLE_POSTURE_2026-09-22.md).
//
// The raw Drizzle client in src/lib/db/index.ts (`export const db`, built from
// DATABASE_URL) is documented in two places as the RLS-bypassing `postgres`
// role:
//   - src/lib/db/tenant-scoped.ts:7-9  -- "unlike `postgres`, which
//     DATABASE_URL still uses for routes not yet migrated to this wrapper"
//   - src/lib/orchestra-execution-logger.ts:136-138 -- "uses the direct `db`
//     import (DATABASE_URL, bypasses RLS) rather than withTenantContext"
// Every cross-org read in this codebase that goes through `db` (all 29 Vercel
// crons under /api/internal/*, admin reports such as
// /api/orchestra/routing-accuracy, the orchestra payload purge, ...) is written
// against that assumption. In production, DATABASE_URL has instead connected
// as `app_runtime` (rolbypassrls = false) since roughly 2026-08-21..23. Under
// RLS with no tenant context set, `compliance.current_org_id()` is null, so
// every such query matches ZERO rows -- no error, no log line, just an empty
// result that is indistinguishable from "nothing to do". The first in-repo
// acknowledgement is commit aebb8763 (2026-08-24, PR #1348), which proved it
// live and worked around it for exactly one query with a SECURITY DEFINER
// function (compliance.gap_log_orgs_with_recent_activity). Nothing since has
// made the general condition visible. This script does.
//
// WHAT THIS DOES NOT DO. It does not fix the posture -- that is an owner
// decision (restore a BYPASSRLS role for DATABASE_URL, or keep `app_runtime`
// and give each cross-org read its own SECURITY DEFINER function; see the doc
// above for the trade-offs). It runs exactly one read-only SELECT per
// configured connection string, never prints a URL or password, and never
// touches the schema.
//
// USAGE
//   node scripts/check-db-role-posture.mjs                # enforcing: exit 1 on mismatch
//   node scripts/check-db-role-posture.mjs --report-only  # always exit 0 (CI, until the decision)
//   node scripts/check-db-role-posture.mjs --json         # machine-readable rows on stdout
//
// EXIT CODES (enforcing mode)
//   0  every set variable matches EXPECTED_POSTURE; unset variables are fine
//   1  at least one set variable MISMATCHES, or could not be verified
//      (a connection string that is set but unreachable is "unverified",
//      not "verified OK" -- a posture gate that cannot prove its claim must
//      not report green)
// --report-only always exits 0 and says what the enforcing exit would have been.
//
// The pure functions below (evaluatePosture, formatTable, toJson, ...) are
// exported so scripts/check-db-role-posture.test.ts can prove the logic with
// no network; only main() opens a connection.
import { pathToFileURL } from "node:url"
import postgres from "postgres"

/** The three connection strings this codebase reads, in the order they are reported. */
export const ROLE_ENV_VARS = Object.freeze([
  "DATABASE_URL",
  "APP_RUNTIME_DATABASE_URL",
  "PROVISIONING_DATABASE_URL",
])

/**
 * The posture the CODE assumes for each variable. A key that is absent for a
 * variable is not asserted (e.g. DATABASE_URL's user is not pinned: any role
 * with rolbypassrls=true satisfies the documented contract, whichever role the
 * owner's decision ends up naming).
 *
 * If the owner decides to KEEP app_runtime behind DATABASE_URL, change
 * DATABASE_URL.bypassrls to false here in the same PR that rewrites the two
 * code comments named in STALE_COMMENTS -- the three must never disagree.
 */
export const EXPECTED_POSTURE = Object.freeze({
  DATABASE_URL: Object.freeze({
    bypassrls: true,
    basis:
      "the code's documented assumption -- src/lib/db/tenant-scoped.ts:7-9 and " +
      "src/lib/orchestra-execution-logger.ts:136-138 both describe DATABASE_URL as the RLS-bypassing role",
  }),
  APP_RUNTIME_DATABASE_URL: Object.freeze({
    user: "app_runtime",
    bypassrls: false,
    basis: "src/lib/db/tenant-scoped.ts:7-16 -- tenant isolation depends on this role NOT bypassing RLS",
  }),
  PROVISIONING_DATABASE_URL: Object.freeze({
    user: "veridian_provisioning",
    basis: "src/lib/db/provisioning.ts -- the elevated, single-statement organisations-INSERT connection (R-CRR-23)",
  }),
})

/** The two code comments that currently describe a posture production does not have. */
export const STALE_COMMENTS = Object.freeze([
  'src/lib/db/tenant-scoped.ts:7-9 ("unlike `postgres`, which DATABASE_URL still uses")',
  'src/lib/orchestra-execution-logger.ts:136-138 ("direct `db` import (DATABASE_URL, bypasses RLS)")',
])

export const DECISION_DOC = "ai-os/DB_ROLE_POSTURE_2026-09-22.md"

/** Exactly the read-only probe run against each configured connection string. */
export const POSTURE_QUERY =
  "select current_user, current_database(), " +
  "(select rolbypassrls from pg_roles where rolname = current_user) as bypassrls, " +
  "(select rolsuper from pg_roles where rolname = current_user) as superuser"

export const STATUS = Object.freeze({
  OK: "ok",
  MISMATCH: "mismatch",
  NOT_SET: "not_set",
  UNREACHABLE: "unreachable",
})

const ASSERTABLE_KEYS = Object.freeze(["user", "bypassrls", "superuser"])

/**
 * Pure. Compare one observation against EXPECTED_POSTURE.
 *
 * @param {string} varName one of ROLE_ENV_VARS
 * @param {null | undefined | { error: string } | { user: string, db: string, bypassrls: boolean|null, superuser: boolean|null }} observed
 *   null/undefined = the variable is not set; { error } = set but the probe failed.
 */
export function evaluatePosture(varName, observed) {
  const expectedFull = EXPECTED_POSTURE[varName]
  if (!expectedFull) {
    throw new Error(`evaluatePosture: "${varName}" is not one of ${ROLE_ENV_VARS.join(", ")}`)
  }
  const expected = {}
  for (const key of ASSERTABLE_KEYS) if (key in expectedFull) expected[key] = expectedFull[key]

  const base = { var: varName, user: null, db: null, bypassrls: null, superuser: null, expected, reasons: [] }

  if (observed === null || observed === undefined) {
    return { ...base, status: STATUS.NOT_SET }
  }
  if (typeof observed === "object" && "error" in observed) {
    return { ...base, status: STATUS.UNREACHABLE, reasons: [`could not verify: ${observed.error}`] }
  }

  const reasons = []
  for (const key of Object.keys(expected)) {
    if (observed[key] !== expected[key]) {
      reasons.push(`${key}: expected ${String(expected[key])}, got ${String(observed[key])}`)
    }
  }
  return {
    ...base,
    status: reasons.length === 0 ? STATUS.OK : STATUS.MISMATCH,
    user: observed.user ?? null,
    db: observed.db ?? null,
    bypassrls: observed.bypassrls ?? null,
    superuser: observed.superuser ?? null,
    reasons,
  }
}

/** Pure. Evaluate every variable from a { VAR: observation } map (missing keys = not set). */
export function evaluateAll(observations) {
  return ROLE_ENV_VARS.map((v) => evaluatePosture(v, observations[v] ?? null))
}

/** Pure. The one-line explanation printed for a row that is not OK. Names the two stale comments. */
export function explainRow(row) {
  const basis = EXPECTED_POSTURE[row.var]?.basis ?? ""
  if (row.status === STATUS.MISMATCH) {
    return (
      `${row.var} MISMATCH: connected as user=${row.user} bypassrls=${row.bypassrls} superuser=${row.superuser} ` +
      `but the code assumes ${describeExpected(row.expected)} (${basis}). ` +
      `Stale comments to fix with the owner's decision: ${STALE_COMMENTS.join("; ")}. ` +
      `Consequence today: every cross-org raw-db read silently returns 0 rows under RLS -- see ${DECISION_DOC}.`
    )
  }
  if (row.status === STATUS.UNREACHABLE) {
    return (
      `${row.var} UNVERIFIED: the variable is set but the posture probe failed (${row.reasons.join("; ")}). ` +
      `Cannot prove it matches ${describeExpected(row.expected)}; treating as not green. ` +
      `Expected posture is defined by ${STALE_COMMENTS.join("; ")} -- see ${DECISION_DOC}.`
    )
  }
  return `${row.var}: ${row.status}`
}

function describeExpected(expected) {
  const parts = Object.entries(expected).map(([k, v]) => `${k}=${String(v)}`)
  return parts.length ? parts.join(", ") : "(nothing asserted)"
}

/** Pure. Enforcing exit code for a set of rows (ignores --report-only). */
export function enforcingExitCode(rows) {
  return rows.some((r) => r.status === STATUS.MISMATCH || r.status === STATUS.UNREACHABLE) ? 1 : 0
}

/** Pure. The exit code the CLI actually uses. */
export function exitCodeFor(rows, { reportOnly = false } = {}) {
  return reportOnly ? 0 : enforcingExitCode(rows)
}

const COLUMNS = Object.freeze([
  ["var", "VAR"],
  ["status", "STATUS"],
  ["user", "USER"],
  ["db", "DB"],
  ["bypassrls", "BYPASSRLS"],
  ["superuser", "SUPERUSER"],
])

function cell(row, key) {
  if (key === "status") return row.status === STATUS.NOT_SET ? "not set" : row.status
  const v = row[key]
  return v === null || v === undefined ? "-" : String(v)
}

/** Pure. Fixed-width table; one line per variable; never contains a URL. */
export function formatTable(rows) {
  const widths = COLUMNS.map(([key, header]) =>
    Math.max(header.length, ...rows.map((r) => cell(r, key).length)),
  )
  const line = (vals) => vals.map((v, i) => v.padEnd(widths[i])).join("  ").trimEnd()
  const out = [line(COLUMNS.map(([, h]) => h)), line(widths.map((w) => "-".repeat(w)))]
  for (const row of rows) out.push(line(COLUMNS.map(([key]) => cell(row, key))))
  return out.join("\n")
}

/** Pure. The --json document. */
export function toJson(rows, { reportOnly = false, checkedAt = new Date().toISOString() } = {}) {
  const summary = { ok: 0, mismatch: 0, not_set: 0, unreachable: 0 }
  for (const r of rows) summary[r.status] += 1
  return {
    schemaVersion: 1,
    checkedAt,
    reportOnly,
    query: POSTURE_QUERY,
    expectedPosture: Object.fromEntries(
      Object.entries(EXPECTED_POSTURE).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== "basis"))]),
    ),
    rows: rows.map((r) => ({
      var: r.var,
      status: r.status,
      user: r.user,
      db: r.db,
      bypassrls: r.bypassrls,
      superuser: r.superuser,
      expected: r.expected,
      reasons: r.reasons,
      explanation: r.status === STATUS.OK || r.status === STATUS.NOT_SET ? null : explainRow(r),
    })),
    summary,
    exitCode: exitCodeFor(rows, { reportOnly }),
    enforcingExitCode: enforcingExitCode(rows),
    staleComments: [...STALE_COMMENTS],
    decisionDoc: DECISION_DOC,
  }
}

/** Pure. CLI flags. Unknown flags throw so a typo cannot silently run enforcing/non-json. */
export function parseArgs(argv) {
  const args = { reportOnly: false, json: false, help: false }
  for (const a of argv) {
    if (a === "--report-only") args.reportOnly = true
    else if (a === "--json") args.json = true
    else if (a === "--help" || a === "-h") args.help = true
    else throw new Error(`unknown argument "${a}" (expected --report-only, --json, --help)`)
  }
  return args
}

/** Pure. Strings that must never appear in output for a given connection string. */
export function redactionTargets(url) {
  const targets = new Set()
  if (typeof url === "string" && url.length > 0) targets.add(url)
  try {
    const u = new URL(url)
    if (u.password) {
      targets.add(u.password)
      try { targets.add(decodeURIComponent(u.password)) } catch { /* keep the raw form only */ }
    }
  } catch { /* not a URL the WHATWG parser accepts -- the whole string is still redacted above */ }
  return [...targets].filter((t) => t.length > 0)
}

/** Pure. Scrub any connection string / password out of a driver error message. */
export function sanitizeErrorMessage(message, targets = []) {
  let out = String(message ?? "")
  for (const t of [...targets].sort((a, b) => b.length - a.length)) out = out.split(t).join("[redacted]")
  return out.replace(/postgres(?:ql)?:\/\/[^\s'"`)]+/gi, "[redacted-connection-string]")
}

/**
 * Network. Open ONE short-lived connection with the given string and run
 * POSTURE_QUERY. Same driver options the app's own client uses
 * (src/lib/db/index.ts) so the observation is what the app would see.
 */
export async function observePosture(url, { connectTimeoutSeconds = 10 } = {}) {
  const targets = redactionTargets(url)
  let sql
  try {
    sql = postgres(url, {
      prepare: false,
      max: 1,
      connect_timeout: connectTimeoutSeconds,
      idle_timeout: 5,
      ssl: { rejectUnauthorized: false },
    })
    const rows = await sql.unsafe(POSTURE_QUERY)
    const r = rows[0] ?? {}
    return {
      user: r.current_user ?? null,
      db: r.current_database ?? null,
      bypassrls: r.bypassrls ?? null,
      superuser: r.superuser ?? null,
    }
  } catch (err) {
    const code = err?.code ? `${err.code}: ` : ""
    return { error: sanitizeErrorMessage(`${code}${err?.message ?? err}`, targets) }
  } finally {
    try { await sql?.end({ timeout: 5 }) } catch { /* best-effort cleanup */ }
  }
}

const USAGE = `usage: node scripts/check-db-role-posture.mjs [--report-only] [--json]
  Reports, for each of ${ROLE_ENV_VARS.join(", ")} that is set, which Postgres
  role it authenticates as and whether that role bypasses RLS, compared against
  EXPECTED_POSTURE. Never prints a URL or password. See ${DECISION_DOC}.`

export async function main(argv = process.argv.slice(2), env = process.env) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err.message)
    console.error(USAGE)
    return 2
  }
  if (args.help) {
    console.log(USAGE)
    return 0
  }

  const rows = []
  for (const varName of ROLE_ENV_VARS) {
    const url = env[varName]
    if (!url) {
      rows.push(evaluatePosture(varName, null))
      continue
    }
    rows.push(evaluatePosture(varName, await observePosture(url)))
  }

  const exitCode = exitCodeFor(rows, args)
  const enforcing = enforcingExitCode(rows)

  if (args.json) {
    console.log(JSON.stringify(toJson(rows, { reportOnly: args.reportOnly }), null, 2))
  } else {
    console.log(formatTable(rows))
  }
  for (const row of rows) {
    if (row.status === STATUS.MISMATCH || row.status === STATUS.UNREACHABLE) console.error(explainRow(row))
  }
  if (args.reportOnly && enforcing !== 0) {
    console.error(`--report-only: exiting 0; the enforcing exit code would have been ${enforcing}.`)
  }
  return exitCode
}

// Only run main() when executed directly (not when imported for its pure
// functions by the test file) -- pathToFileURL handles both POSIX and Windows
// argv[1] paths correctly, unlike a manual string comparison.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("check-db-role-posture: unexpected failure:", err?.message ?? err)
      process.exit(1)
    },
  )
}
