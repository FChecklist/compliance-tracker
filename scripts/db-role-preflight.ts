/// <reference types="bun-types" />
/**
 * scripts/db-role-preflight.ts -- PROJEXA-COST-001 (2026-09-22), PREPARE-ONLY.
 *
 * Preflight for .github/workflows/cost001-cron-runner.yml: proves, before any
 * cron route is invoked, that the GitHub Actions runner can actually reach
 * the database through the SAME connection strings the app itself uses, and
 * prints which Postgres role each one lands as.
 *
 * WHY THIS EXISTS AS A SEPARATE STEP. No GitHub Actions workflow in this org
 * has ever successfully connected to Supabase: .github/workflows/db-migrate.yml
 * is 0 for its last 10 recorded runs (password authentication failure, see
 * that file's own header and ai-os/COST001_GHA_RUNNER_NOTES.md). A cron run
 * that fails on a dead connection string would look like a cron bug; this
 * step makes it look like what it is.
 *
 * For each of DATABASE_URL and APP_RUNTIME_DATABASE_URL that is set, it
 * connects with the repo's own `postgres` package (same driver options as
 * src/lib/db/index.ts: prepare:false for Supabase's transaction-mode pooler,
 * ssl with rejectUnauthorized:false) and prints current_user,
 * current_database() and that role's rolbypassrls. rolbypassrls matters
 * because APP_RUNTIME_DATABASE_URL is meant to be the RLS-bound app_runtime
 * role (src/lib/db/tenant-scoped.ts) while DATABASE_URL is the
 * RLS-bypassing one -- a swapped or wrong secret shows up here as the wrong
 * answer, before a cron writes anything under the wrong role.
 *
 * NO SECRETS ARE PRINTED. Only host/port/database/user are echoed from the
 * connection string (never the password), and any driver error message is
 * scrubbed of both the password and the full URL before it is logged.
 *
 * Exit 0 only if every set variable connects; exit 1 if any set variable
 * fails, or if neither is set at all (a preflight with nothing to prove is
 * a failed preflight, not a passed one).
 */
import postgres from "postgres"

export const CONNECTION_VARS = ["DATABASE_URL", "APP_RUNTIME_DATABASE_URL"] as const

export type TargetSummary = { host: string; port: string; database: string; user: string }

/** The printable, non-secret parts of a connection string (never the password). */
export function describeTarget(url: string): TargetSummary | null {
  try {
    const u = new URL(url)
    return {
      host: u.hostname || "(none)",
      port: u.port || "(default)",
      database: u.pathname.replace(/^\//, "") || "(none)",
      user: (u.username ? decodeURIComponent(u.username) : "") || "(none)",
    }
  } catch {
    return null
  }
}

/** Scrubs the password and the whole connection string out of any text before it is printed. */
export function redact(text: string, url: string): string {
  let out = url ? text.split(url).join("<connection-string>") : text
  try {
    const raw = new URL(url).password
    const candidates = new Set([raw, raw ? decodeURIComponent(raw) : ""])
    for (const pw of candidates) {
      if (pw) out = out.split(pw).join("***")
    }
  } catch {
    // unparseable URL -- nothing more to scrub beyond the full-string replace above
  }
  return out
}

export type RoleFacts = { current_user: string; current_database: string; rolbypassrls: boolean | null; server_version: string }
export type ProbeResult = { name: string; ok: true; facts: RoleFacts } | { name: string; ok: false; error: string }

export async function probe(name: string, url: string): Promise<ProbeResult> {
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    connect_timeout: 15,
    ssl: { rejectUnauthorized: false },
  })
  try {
    const rows = await sql<RoleFacts[]>`
      select
        current_user::text                                                      as current_user,
        current_database()::text                                                as current_database,
        (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) as rolbypassrls,
        current_setting('server_version')                                       as server_version
    `
    return { name, ok: true, facts: rows[0] }
  } catch (err) {
    const src = err as { code?: string; message?: string }
    const message = `${src.code ? `[${src.code}] ` : ""}${src.message ?? String(err)}`
    return { name, ok: false, error: redact(message, url) }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

export async function main(
  env: Record<string, string | undefined> = process.env,
  log: (line: string) => void = console.log,
): Promise<number> {
  let checked = 0
  let failed = 0
  for (const name of CONNECTION_VARS) {
    const url = env[name]
    if (!url) {
      log(`${name}: not set -- skipped`)
      continue
    }
    checked++
    const target = describeTarget(url)
    if (!target) {
      failed++
      log(`${name}: FAIL -- value is not a parseable URL (value not printed)`)
      continue
    }
    log(`${name}: host=${target.host} port=${target.port} db=${target.database} user=${target.user} (password never printed)`)
    const result = await probe(name, url)
    if (result.ok) {
      const f = result.facts
      log(`  OK   current_user=${f.current_user} current_database=${f.current_database} rolbypassrls=${f.rolbypassrls} server_version=${f.server_version}`)
    } else {
      failed++
      log(`  FAIL ${result.error}`)
    }
  }
  if (checked === 0) {
    log(`PREFLIGHT FAIL: neither ${CONNECTION_VARS.join(" nor ")} is set -- nothing to prove, refusing to pass.`)
    return 1
  }
  if (failed > 0) {
    log(`PREFLIGHT FAIL: ${failed} of ${checked} connection string(s) did not connect.`)
    return 1
  }
  log(`PREFLIGHT OK: ${checked} connection string(s) connected; roles printed above.`)
  return 0
}

// import.meta.main (Bun's entrypoint check, same convention as
// scripts/run-internal-cron.ts) so a test can import the helpers without
// opening a connection.
if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("PREFLIGHT FAIL: preflight itself crashed:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    },
  )
}
