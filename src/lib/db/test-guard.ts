// P2.3 (W-ENV, R81-ADDENDUM-B phase S5): destructive-test guard, pure logic.
//
// WHAT. `assertTestDatabase` throws unless a connection string resolves to
// either a genuinely local Postgres (localhost/127.0.0.1) or this repo's own
// known dev/test Supabase project (KNOWN_PROJECT_REF). It is wired to run
// automatically before any test file via bunfig.toml's `[test] preload` ->
// test-guard-preload.ts, checking both DATABASE_URL (db/index.ts's role) and
// APP_RUNTIME_DATABASE_URL (tenant-scoped.ts's app_runtime role -- see that
// file's own header) -- this repo has real *.test.ts files that exercise
// both paths against a live database (e.g. r48-six-tenant-tables-rls.test.ts,
// erp-goods-receipt-nested-transaction.test.ts).
//
// WHY. This repo has no separate local database (R72 state note,
// CLAUDE.md) -- both connection strings resolve to the one real Supabase
// project that also backs whatever production traffic exists the moment
// Vercel unpauses. A bad env var, a copy-pasted .env, or a future
// multi-project config mistake pointing either at the wrong database should
// not fail quietly by writing test data into it -- it should refuse to run
// at all, before a single query executes.
//
// SCOPE, deliberately narrow and an allowlist (not a denylist): an
// unrecognised connection string is refused by default, not merely warned
// about. "Local or test" means localhost/127.0.0.1, or a connection string
// naming this repo's own known project ref. If a real, separate test
// project is ever provisioned, add its ref here explicitly -- do not widen
// this to "anything that isn't obviously named prod".
const KNOWN_PROJECT_REF = "pcrjmlpuqsbocqfwoxod" // this repo's Supabase project (compliance-tracker / VERIDIAN core)

export function assertTestDatabase(rawUrl: string | undefined): void {
  if (!rawUrl) return // not set -- nothing to connect to, nothing to guard
  let host: string
  try {
    host = new URL(rawUrl).hostname
  } catch {
    throw new Error(`DESTRUCTIVE-TEST GUARD: connection string is not a valid URL: ${rawUrl}`)
  }
  const isLocal = host === "localhost" || host === "127.0.0.1"
  const isKnownTestProject = rawUrl.includes(KNOWN_PROJECT_REF)
  if (!isLocal && !isKnownTestProject) {
    throw new Error(
      `DESTRUCTIVE-TEST GUARD: refusing to run -- connection string does not point at localhost or the known dev/test project (${KNOWN_PROJECT_REF}). ` +
        `Host was: ${host}. If this is intentionally a new test database, add its project ref to KNOWN_PROJECT_REF in src/lib/db/test-guard.ts -- do not delete this check.`
    )
  }
}
