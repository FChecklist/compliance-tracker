// Records migrations 0678 .. 0687 in Supabase's own migration history (supabase_migrations.schema_migrations), the way the Supabase MCP's
// apply_migration does, so `list_migrations` shows what is live and nobody re-applies a file. They were applied by
// scripts/verify/apply-projexa-local-first-chain.mjs (Management API), which writes DDL but no history row.
// Metadata only: no DDL, no data. Idempotent (a name already recorded is skipped). Not the repo's drizzle ledger: that ledger is far behind the
// live database for every file since ~0640 (applied through the MCP), see CLAUDE.md "No local database..." and scripts/migration-ledger.mjs.
//   node scripts/verify/record-projexa-local-first-migrations.mjs          show what would be recorded
//   node scripts/verify/record-projexa-local-first-migrations.mjs --apply  record it
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const PROJECT = process.env.SUPABASE_PROJECT_REF || "pcrjmlpuqsbocqfwoxod"
const APPLY = process.argv.includes("--apply")
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
  for (const p of ["C:/ct/ct/.env.local", join(ROOT, ".env.local")]) {
    if (!existsSync(p)) continue
    const m = readFileSync(p, "utf8").match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, "")
  }
  throw new Error("SUPABASE_ACCESS_TOKEN is not set")
}
const TOKEN = token()
async function q(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 600)}`)
  return JSON.parse(text)
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

const have = new Set((await q(`select name from supabase_migrations.schema_migrations`)).map((r) => r.name))
const live = await q(`select (to_regclass('platform.projexa_sync_key') is not null) a, (to_regproc('public.projexa_sync_heads') is not null) b, (to_regclass('platform.projexa_work_job') is not null) c`)
if (!(live[0].a && live[0].b && live[0].c)) throw new Error("the chain is not applied on this project: refusing to record it")

// versions are timestamps; the chain's own order is kept by giving each file the next second after now
const base = new Date()
let n = 0
for (const tag of CHAIN) {
  const name = tag.replace(/^(\d{4})_(.*)$/, "$2_$1") // projexa_sync_keys_ids_0678, the shape 0676 was recorded in
  if (have.has(name)) {
    console.log(`  already recorded: ${name}`)
    continue
  }
  const t = new Date(base.getTime() + n++ * 1000)
  const version = t.toISOString().replace(/[-:T]/g, "").slice(0, 14)
  const body = readFileSync(join(ROOT, "drizzle", `${tag}.sql`), "utf8")
  console.log(`  ${APPLY ? "recording" : "would record"}: ${version} ${name}`)
  if (APPLY) {
    await q(
      `insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values (${lit(version)}, ${lit(name)}, array[${lit(body)}]::text[], 'claude-code-pm (owner directive 2026-10-02)') on conflict (version) do nothing`,
    )
  }
}
if (APPLY) {
  const rows = await q(`select version, name from supabase_migrations.schema_migrations where name ~ '_06(7[8-9]|8[0-7])$' order by version`)
  console.log(`recorded now: ${rows.length}`, rows.map((r) => r.name).join(", "))
}
