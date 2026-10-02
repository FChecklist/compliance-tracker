// node scripts/verify/sql/run-probe.mjs <file.sql>
// Runs one probe file (a DO block ending in `RAISE EXCEPTION 'PROBE_RESULT %', <jsonb>::text`) on the live project through the Management API and
// prints the JSON it carries. The deliberate exception rolls the whole probe back, so a probe leaves nothing behind. The token is never printed.
import { readFileSync, existsSync } from "node:fs"
const file = process.argv[2]
if (!file) throw new Error("usage: run-probe.mjs <file.sql>")
function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  for (const p of ["C:/ct/ct/.env.local", ".env.local"]) {
    if (!existsSync(p)) continue
    const m = readFileSync(p, "utf8").match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, "")
  }
  throw new Error("SUPABASE_ACCESS_TOKEN is not set")
}
const res = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF || "pcrjmlpuqsbocqfwoxod"}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: readFileSync(file, "utf8") }),
  signal: AbortSignal.timeout(120_000),
})
const text = await res.text()
let message = text
try {
  message = String(JSON.parse(text).message ?? text)
} catch {
  /* not JSON: keep the raw text */
}
const m = message.match(/PROBE_RESULT (\{.*?\})\s*(?:\nCONTEXT|$)/s)
if (!m) {
  console.log("NO PROBE RESULT:", message.slice(0, 1500))
  process.exit(1)
}
console.log(JSON.stringify(JSON.parse(m[1]), null, 1))
