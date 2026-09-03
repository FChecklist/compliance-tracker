#!/usr/bin/env node
// Replays drizzle/ against a genuinely empty Postgres and reports exactly
// where it breaks.
//
// WHY THIS EXISTS -- E-103 (platform.r43_faults fault_id
// E103_MIGRATION_REPLAY_EMPTY_DB_BREAK)
// ======================================================================
// E-103 says a fresh database cannot be built by replaying this repo's
// migration folder. It has been triaged four times (2026-08-22, 08-28 x3)
// and each pass reasoned about the failure from file contents and journal
// order rather than running it, because no throwaway Postgres was available
// on the machine doing the triage. Each pass therefore found only the breaks
// its particular reading technique could see, and each concluded the
// migration folder was ALMOST replayable -- one ordering bug at journal
// position 140, then one more at 242, then four un-migrated tables.
//
// That picture was wrong, and only running it showed why. On 2026-09-03 this
// harness replayed all 360 journal entries of origin/main (7d66223a) against
// a real Postgres 18.3 (PGlite 0.5.8):
//
//   Only 50 of 360 entries apply cleanly. 310 entries fail, across 351
//   failing statements. The first failure is at ARRAY POSITION 3.
//
// drizzle/0003_enable_rls_exposed_compliance_tables.sql does
// `ALTER TABLE compliance.challans ENABLE ROW LEVEL SECURITY`, and
// compliance.challans has no CREATE TABLE anywhere in the migration folder.
// Neither do compliance.tasks, compliance.api_keys, compliance.embeddings,
// compliance.webhooks, or 90 other live tables: 95 of the 598 live BASE
// TABLEs across compliance+platform have no CREATE TABLE in drizzle/ at all
// (measured 2026-09-03 against project pcrjmlpuqsbocqfwoxod by diffing every
// `CREATE TABLE` in drizzle/*.sql against information_schema.tables -- 35 in
// compliance, 60 in platform). Nor is the function
// compliance.current_org_id() defined anywhere in drizzle/, though 74
// separate statements across the folder call it.
//
// The root cause is therefore not an ordering bug at all. The drizzle folder
// has never been a from-empty build source: the bulk of this schema was
// created by `bun run db:push` (drizzle-kit's schema-diff push, which writes
// nothing to drizzle/ or to the journal) and only incremental patches were
// ever captured as migration files. Every prior triage was measuring the
// depth of a hole whose bottom it had not reached.
//
// This script is the instrument that was missing. It does not fix E-103 --
// closing E-103 means authoring a baseline for 95 untracked tables plus the
// functions/triggers/policies that go with them, which is deliberate,
// reviewed schema archaeology and not a bug fix. What it does is make the
// claim testable: any future attempt at that baseline can be proven or
// disproven in one command instead of argued about from file contents.
//
// USAGE
//   node scripts/replay-migrations-from-empty.mjs            # stop at first failure
//   node scripts/replay-migrations-from-empty.mjs --report   # full failure list, exit 0
//   node scripts/replay-migrations-from-empty.mjs --report --strict   # ... exit 1 if any
//   node scripts/replay-migrations-from-empty.mjs --database-url=postgres://...
//
// ENGINE
// Default engine is PGlite (@electric-sql/pglite) -- real Postgres compiled
// to WASM, no server, no Docker, runs anywhere Node runs. That matters
// because the absence of a local Postgres is precisely what stopped the
// previous four triage passes from getting a real answer. Pass
// --database-url to run against a real server instead; the script refuses
// to touch a database that is not empty.
//
// TWO DOCUMENTED DEVIATIONS FROM A LITERAL `bun run db:migrate`
//   1. Supabase baseline. A fresh Supabase project ships roles (anon,
//      authenticated, service_role, app_runtime), an `extensions` schema,
//      and an `auth` schema with users/mfa tables and auth.uid(). None of
//      that is in drizzle/, and migrations reference all of it. The baseline
//      below recreates that surface so failures attributable to Supabase's
//      own bootstrap are not miscounted as migration defects. It is applied
//      only to the PGlite engine (a real Supabase target already has it).
//   2. pgvector. PGlite 0.5.8 ships no `vector` extension, so the three
//      migrations using vector(1536) columns and hnsw/ivfflat indexes are
//      rewritten (column type -> real[], vector indexes skipped). This
//      preserves the column-existence semantics that ordering depends on
//      while dropping the parts needing the real extension. Every
//      substitution is printed. Against --database-url on a server with
//      pgvector installed, no substitution is applied.
// Both deviations are reported in the output so a reader can see precisely
// how far the run is from a literal production replay.
import { readFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url))

// What a fresh Supabase project provides before any of this repo's
// migrations run. Kept minimal and explicit: every object here is one a
// migration in drizzle/ actually references.
export const SUPABASE_BASELINE_SQL = `
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator NOINHERIT;
CREATE ROLE app_runtime NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE auth.mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  status text,
  factor_type text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE auth.mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_id uuid REFERENCES auth.mfa_factors(id),
  verified_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ select null::uuid $fn$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $fn$ select null::text $fn$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$ select '{}'::jsonb $fn$;
`

/**
 * The exact statement split drizzle-orm performs (migrator.js): the file is
 * cut on the `--> statement-breakpoint` marker and each piece is sent as one
 * command. Hand-authored migrations in this repo carry no marker, so they
 * arrive as a single multi-statement chunk -- also exactly what drizzle does.
 * Pure, so the split can be tested without an engine.
 */
export function splitStatements(fileContent) {
  return fileContent.split("--> statement-breakpoint").filter((s) => s.trim().length > 0)
}

/**
 * Rewrite the pgvector-dependent SQL that PGlite cannot execute, and report
 * every substitution made. Pure: returns the rewritten text plus the list of
 * changes, so a caller can print them and a test can assert on them without
 * a database.
 *
 * The rewrite is deliberately narrow. A vector column becomes real[], which
 * keeps the column present so later migrations that ALTER or index around it
 * still exercise real ordering; a vector index is dropped entirely, because
 * there is no meaningful stand-in for hnsw/ivfflat and a fake one would
 * prove nothing.
 */
export function applyPgvectorShim(sqlText, tag) {
  const changes = []
  let out = sqlText
  if (/vector\(\d+\)/i.test(out)) {
    out = out.replace(/vector\((\d+)\)/gi, "real[]")
    changes.push(`${tag}: vector(N) -> real[] (PGlite has no pgvector)`)
  }
  out = out.replace(/CREATE\s+INDEX[\s\S]*?USING\s+(?:hnsw|ivfflat)[\s\S]*?;/gi, (match) => {
    changes.push(`${tag}: skipped pgvector index -- ${match.slice(0, 70).replace(/\s+/g, " ")}...`)
    return "/* pgvector index skipped by replay harness */"
  })
  return { sql: out, changes }
}

/**
 * Turn a raw failure list into the shape the report prints and CI asserts on.
 * Pure so the reporting logic is testable without running a replay.
 */
export function summarize(totalEntries, failures) {
  const byTag = new Map()
  for (const f of failures) {
    if (!byTag.has(f.tag)) byTag.set(f.tag, [])
    byTag.get(f.tag).push(f)
  }
  const byMessage = new Map()
  for (const f of failures) byMessage.set(f.message, (byMessage.get(f.message) ?? 0) + 1)
  return {
    totalEntries,
    failingEntries: byTag.size,
    failingStatements: failures.length,
    passingEntries: totalEntries - byTag.size,
    firstFailure: failures[0] ?? null,
    topMessages: [...byMessage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
  }
}

async function openPgliteEngine() {
  let PGlite, pg_trgm, pgcrypto
  try {
    ;({ PGlite } = await import("@electric-sql/pglite"))
    ;({ pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm"))
    ;({ pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto"))
  } catch (err) {
    console.error("Could not load @electric-sql/pglite:", err.message)
    console.error("Install it (`bun install`) or pass --database-url to use a real Postgres.")
    process.exit(1)
  }
  const db = await PGlite.create({ extensions: { pg_trgm, pgcrypto } })
  const version = (await db.query("select version()")).rows[0].version
  return {
    kind: "pglite",
    version,
    needsBaseline: true,
    needsPgvectorShim: true,
    exec: (s) => db.exec(s),
    close: () => db.close(),
  }
}

async function openServerEngine(url) {
  const postgres = (await import("postgres")).default
  const sql = postgres(url, { max: 1, prepare: false })
  // Refuse a database that is not actually empty. This script creates
  // hundreds of objects; pointing it at a real environment by accident must
  // not be survivable.
  const [{ present }] = await sql`
    select count(*)::int as present from information_schema.schemata
    where schema_name in ('compliance', 'platform')`
  if (present > 0) {
    await sql.end()
    throw new Error(
      "refusing to run: the target database already has a compliance/platform schema. " +
        "This harness only runs against a genuinely empty database.",
    )
  }
  const [{ version }] = await sql`select version()`
  return {
    kind: "server",
    version,
    needsBaseline: false,
    needsPgvectorShim: false,
    exec: (s) => sql.unsafe(s),
    close: () => sql.end(),
  }
}

async function main() {
  const args = process.argv.slice(2)
  const report = args.includes("--report")
  const strict = args.includes("--strict")
  const urlArg = args.find((a) => a.startsWith("--database-url="))

  const engine = urlArg
    ? await openServerEngine(urlArg.slice("--database-url=".length))
    : await openPgliteEngine()

  console.log(`engine: ${engine.kind}`)
  console.log(`server: ${engine.version}`)

  if (engine.needsBaseline) {
    await engine.exec(SUPABASE_BASELINE_SQL)
    console.log("applied Supabase baseline (roles, extensions schema, auth schema + auth.uid())")
  } else {
    console.log("skipped Supabase baseline -- real server is assumed to provide it")
  }

  const journal = JSON.parse(readFileSync(`${drizzleDir}/meta/_journal.json`, "utf8"))
  console.log(`replaying ${journal.entries.length} journal entries in array order\n`)

  const failures = []
  const shimChanges = []

  for (let i = 0; i < journal.entries.length; i++) {
    const entry = journal.entries[i]
    const raw = readFileSync(`${drizzleDir}/${entry.tag}.sql`, "utf8")
    let text = raw
    if (engine.needsPgvectorShim) {
      const shimmed = applyPgvectorShim(raw, entry.tag)
      text = shimmed.sql
      shimChanges.push(...shimmed.changes)
    }
    const statements = splitStatements(text)
    for (let s = 0; s < statements.length; s++) {
      try {
        await engine.exec(statements[s])
      } catch (err) {
        const failure = {
          arrayPosition: i,
          idx: entry.idx,
          tag: entry.tag,
          statement: s + 1,
          statementCount: statements.length,
          message: String(err.message ?? err).split("\n")[0],
        }
        failures.push(failure)
        console.log(
          `FAIL  pos=${failure.arrayPosition} idx=${failure.idx} ${failure.tag} ` +
            `[stmt ${failure.statement}/${failure.statementCount}]`,
        )
        console.log(`      ${failure.message}`)
        if (!report) {
          // Faithful mode: drizzle wraps the whole run in ONE transaction, so
          // the first failure is where a real `db:migrate` would abort and
          // roll everything back. Stopping here reports that point exactly.
          console.log("\nStopped at the first failure (matches drizzle's single-transaction abort).")
          await engine.close()
          process.exit(1)
        }
      }
    }
  }

  const s = summarize(journal.entries.length, failures)
  console.log(`\n=== from-empty replay: ${s.passingEntries}/${s.totalEntries} entries applied cleanly ===`)
  console.log(`failing entries:    ${s.failingEntries}`)
  console.log(`failing statements: ${s.failingStatements}`)
  if (s.firstFailure) {
    console.log(
      `first failure:      pos=${s.firstFailure.arrayPosition} ${s.firstFailure.tag} -- ${s.firstFailure.message}`,
    )
  }
  if (s.topMessages.length > 0) {
    console.log("\nmost frequent errors:")
    for (const [msg, count] of s.topMessages) console.log(`  ${String(count).padStart(4)}  ${msg}`)
  }
  if (shimChanges.length > 0) {
    console.log(`\nengine compatibility substitutions applied (${shimChanges.length}):`)
    for (const c of shimChanges) console.log(`  ${c}`)
  }

  await engine.close()
  process.exit(strict && failures.length > 0 ? 1 : 0)
}

// Only run main() when executed directly, so the pure helpers above can be
// imported by the test file. pathToFileURL handles Windows argv[1] paths
// correctly, unlike a plain string comparison.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
