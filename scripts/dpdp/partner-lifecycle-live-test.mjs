#!/usr/bin/env node
// Rolled-back rehearsal of drizzle/0674_dpdp_sales_partner_lifecycle.sql on the LIVE project, through the
// Supabase Management API (database/query). The request is the migration text followed by
// scripts/dpdp/partner-lifecycle-scenario.sql in ONE statement batch, which is one transaction; the scenario
// ends by RAISING its results, so the whole transaction -- the migration's tables and functions included -- is
// rolled back and nothing is left behind (no test rows, no new tables). It also runs the real
// dpdp_create_my_org attribution (the part PGlite cannot).
//
//   node scripts/dpdp/partner-lifecycle-live-test.mjs              migration + scenario (before the migration is applied)
//   node scripts/dpdp/partner-lifecycle-live-test.mjs --applied     scenario only (after the migration was applied live)
//
// The token is read from SUPABASE_ACCESS_TOKEN (environment), else from .env.local at the repository root. It is
// never printed. Exit code 0 = no FAIL line, 1 = at least one FAIL, 2 = the request itself failed.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const PROJECT = "pcrjmlpuqsbocqfwoxod"

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  for (const p of [join(ROOT, ".env.local"), "C:/ct/ct/.env.local"]) {
    try {
      for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = /^SUPABASE_ACCESS_TOKEN=(.*)$/.exec(l)
        if (m) return m[1].trim().replace(/^"|"$/g, "")
      }
    } catch { /* try the next place */ }
  }
  throw new Error("SUPABASE_ACCESS_TOKEN is not set")
}

const applied = process.argv.includes("--applied")
const migration = readFileSync(join(ROOT, "drizzle", "0674_dpdp_sales_partner_lifecycle.sql"), "utf8")
const scenario = readFileSync(join(ROOT, "scripts", "dpdp", "partner-lifecycle-scenario.sql"), "utf8")
const sql = (applied ? "" : migration + "\n") + scenario

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
})
const body = await res.text()
const m = /RESULT\\n([\s\S]*?)(?:"|$)/.exec(body)
if (!m) {
  console.error(`The request did not return the scenario's results (HTTP ${res.status}):`)
  console.error(body.slice(0, 2500))
  process.exit(2)
}
const lines = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').split("\n").filter((l) => l.trim())
for (const l of lines) console.log(l)
const fail = lines.filter((l) => l.startsWith("FAIL")).length
console.log(`\n${lines.filter((l) => l.startsWith("PASS")).length} PASS, ${fail} FAIL, ${lines.filter((l) => l.startsWith("SKIP")).length} SKIP (rolled back; nothing was kept)`)
process.exit(fail ? 1 : 0)
