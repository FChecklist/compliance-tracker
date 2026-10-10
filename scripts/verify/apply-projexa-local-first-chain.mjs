// Applies (or rehearses) the PROJEXA local-first migration chain 0678 .. 0687 on the live Supabase project, with the post-checks of
// ai-os/PROJEXA_LOCAL_FIRST_DEPLOY_RUNBOOK.md. It is NOT db:migrate (which applies every unregistered journal entry): it applies exactly these files, in number order.
//
//   node scripts/verify/apply-projexa-local-first-chain.mjs --check      read-only: what is applied now
//   node scripts/verify/apply-projexa-local-first-chain.mjs --rehearse   the whole chain in ONE request that ends in a deliberate exception: proves it applies cleanly on the
//                                                                         REAL database (real roles, real catalog, real locks) and leaves nothing behind (the exception rolls everything back)
//   node scripts/verify/apply-projexa-local-first-chain.mjs --apply      each file as its own request (the files carry their own BEGIN/COMMIT), then the checks
//
// SQL runs through the Supabase Management API (POST /v1/projects/<ref>/database/query), as the Supabase MCP does: with the project's admin rights, which the app's runtime
// role in DATABASE_URL does not have. The access token is read from the environment or the repo's .env.local and is never printed. The migrations were pre-approved by the
// owner's directive of 2026-10-02 (each file's first line). Refuses to run when the chain is partly applied.
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const PROJECT = process.env.SUPABASE_PROJECT_REF || "pcrjmlpuqsbocqfwoxod"
const MODE = process.argv.includes("--apply") ? "apply" : process.argv.includes("--rehearse") ? "rehearse" : process.argv.includes("--check") ? "check" : null
if (!MODE) {
  console.error("usage: --check | --rehearse | --apply")
  process.exit(2)
}

const CHAIN = [
  "0678_projexa_sync_keys_ids",
  "0679_projexa_record_versions",
  "0680_projexa_release_registry",
  "0681_projexa_sync_push",
  "0682_projexa_work_jobs",
  "0683_projexa_sync_more_kinds",
  "0684_projexa_sync_org_masters",
  "0685_awl_ai_crud",
  "0686_projexa_sync_hardening",
  "0687_awl_ai_crud_b5",
]

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  for (const p of [join(ROOT, ".env.local"), "C:/ct/ct/.env.local"]) {
    if (!existsSync(p)) continue
    const m = readFileSync(p, "utf8").match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, "")
  }
  throw new Error("SUPABASE_ACCESS_TOKEN is not set (environment or .env.local)")
}
const TOKEN = token()

/** One request = one batch of statements. Returns the rows of the last statement; throws with the database's message on error. */
async function q(query, { timeoutMs = 170_000 } = {}) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(json?.message ?? text).toString().slice(0, 1200)}`)
  return json
}
const one = async (query) => (await q(query))[0]

async function state() {
  const base = await one(`select
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','platform') and p.proname like 'projexa\\_%' escape '\\')::int as projexa_functions,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform' and c.relkind = 'r' and c.relname like 'projexa\\_%' escape '\\')::int as projexa_tables,
    (select count(*) from pg_trigger where tgname like 'projexa\\_track\\_%' escape '\\' and not tgisinternal)::int as track_triggers,
    to_regclass('platform.projexa_sync_key') is not null as has_0678,
    to_regclass('platform.projexa_record_head') is not null as has_0679,
    to_regclass('platform.projexa_release') is not null as has_0680,
    to_regclass('platform.projexa_sync_op') is not null as has_0681,
    to_regclass('platform.projexa_work_job') is not null as has_0682,
    to_regproc('public.projexa_sync_heads') is not null as has_0686,
    to_regproc('public.projexa_sync__kinds') is not null as has_kinds_fn,
    (select count(*) from platform.ai_work_link_functions)::int as awl_functions`)
  if (base.has_kinds_fn) base.sync_kinds = (await one(`select cardinality(public.projexa_sync__kinds())::int n`)).n
  return base
}

async function checks(label) {
  const s = await state()
  console.log(`[${label}]`, JSON.stringify(s))
  // the chain's functions must not be callable by anon / authenticated (service role only), apart from the two older read helpers
  const leaks = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'projexa\\_%' escape '\\'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
    order by 1`)
  console.log(`[${label}] projexa_* functions executable by anon/authenticated:`, leaks.map((r) => r.proname).join(", ") || "none")
  return s
}

const body = (name) => readFileSync(join(ROOT, "drizzle", `${name}.sql`), "utf8")

try {
  const before = await checks("before")
  if (MODE === "check") process.exit(0)
  if (before.has_0678 || before.has_0679 || before.has_0680 || before.has_0681 || before.has_0682 || before.has_0686) {
    console.error("REFUSING: part of the chain is already applied (0678..0682/0686 objects exist). Inspect first; nothing was changed.")
    process.exit(3)
  }
  if (MODE === "rehearse") {
    // ONE request = one implicit transaction: strip each file's own BEGIN/COMMIT, then end with a deliberate exception that carries the in-transaction state and rolls everything back
    const strip = (t) => t.replace(/^\s*BEGIN\s*;\s*$/gim, "").replace(/^\s*COMMIT\s*;\s*$/gim, "")
    const probe = `DO $rh$ BEGIN RAISE EXCEPTION 'REHEARSAL_OK %', (SELECT row_to_json(s)::text FROM (SELECT
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public','platform') AND p.proname LIKE 'projexa\\_%' ESCAPE '\\') AS projexa_functions,
      (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'projexa\\_track\\_%' ESCAPE '\\' AND NOT tgisinternal) AS track_triggers,
      (SELECT cardinality(public.projexa_sync__kinds())) AS sync_kinds,
      (SELECT count(*) FROM platform.ai_work_link_functions) AS awl_functions) s); END $rh$;`
    const t0 = Date.now()
    let outcome = "no error?!"
    try {
      await q(CHAIN.map((n) => `-- ${n}\n${strip(body(n))}`).join("\n") + "\n" + probe)
    } catch (e) {
      outcome = String(e.message)
    }
    console.log(`  whole chain in one transaction: ${Date.now() - t0} ms`)
    if (!outcome.includes("REHEARSAL_OK")) throw new Error("rehearsal did not reach its end: " + outcome)
    console.log("  inside the rehearsal:", outcome.slice(outcome.indexOf("REHEARSAL_OK")).slice(0, 400))
    const after = await checks("after rollback")
    if (after.has_0678 || after.has_0686) throw new Error("the rehearsal left objects behind")
    console.log("REHEARSAL OK: the whole chain applies cleanly on the live database and was rolled back.")
  } else {
    for (const name of CHAIN) {
      const t0 = Date.now()
      await q(body(name))
      console.log(`  applied ${name} (${Date.now() - t0} ms)`, JSON.stringify(await state()))
    }
    const after = await checks("after")
    console.log("APPLIED. sync kinds:", after.sync_kinds, "awl functions:", after.awl_functions)
  }
} catch (e) {
  console.error("FAILED:", e?.message || String(e))
  process.exitCode = 1
}
