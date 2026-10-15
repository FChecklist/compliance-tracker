#!/usr/bin/env node
// AUDIT-100 G-09: ONE-OFF, REVIEWED backfill. Copies the existing rows of PROJEXA's public.veridian_credentials into the compliance-side
// compliance.projexa_org_credentials (drizzle/0729) through public.projexa_org_credential_put. NEVER run by a migration or by CI.
//
//   dry run (default): reads the legacy rows and reports COUNTS only: how many rows, how many have a well-formed organisation id / VERIDIAN org id / key.
//   --apply:           calls projexa_org_credential_put once per row and reports COUNTS per outcome:
//        stored          written
//        exists          already there (a re-run is safe: first writer wins, nothing is overwritten)
//        key_mismatch    the key's SHA-256 is not an active api_keys row of that VERIDIAN organisation: NOT written (a row that would point at a key that
//                        does not belong to the organisation it names is refused by the SQL itself)
//        bad_input / error
//
// SECRETS: the four environment variables below are read from the process environment and used only in request headers. Keys, organisation ids and
// credentials are never printed, logged or written anywhere: the output is counts. Set them for ONE command, e.g. (PowerShell / bash) from your own secret store:
//   PROJEXA_SUPABASE_URL=https://evpckeuxgvahguwsaeul.supabase.co  PROJEXA_SERVICE_ROLE_KEY=...  \
//   VERIDIAN_SUPABASE_URL=https://pcrjmlpuqsbocqfwoxod.supabase.co   VERIDIAN_SERVICE_ROLE_KEY=...  node scripts/g09-backfill-credentials.mjs [--apply]
const apply = process.argv.includes("--apply")
const need = ["PROJEXA_SUPABASE_URL", "PROJEXA_SERVICE_ROLE_KEY", "VERIDIAN_SUPABASE_URL", "VERIDIAN_SERVICE_ROLE_KEY"]
const missing = need.filter((n) => !process.env[n])
if (missing.length) {
  console.error(`missing environment: ${missing.join(", ")}`)
  process.exit(2)
}
const strip = (u) => u.replace(/\/+$/, "")
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const read = await fetch(`${strip(process.env.PROJEXA_SUPABASE_URL)}/rest/v1/veridian_credentials?select=organization_id,veridian_org_id,veridian_api_key&order=organization_id.asc`, {
  headers: { apikey: process.env.PROJEXA_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.PROJEXA_SERVICE_ROLE_KEY}`, Accept: "application/json" },
})
if (!read.ok) {
  console.error(`could not read the legacy table: HTTP ${read.status}`)
  process.exit(1)
}
const rows = await read.json()
const counts = { legacy_rows: rows.length, well_formed: 0, malformed: 0 }
const good = []
for (const r of rows) {
  if (UUID.test(String(r.organization_id)) && typeof r.veridian_org_id === "string" && r.veridian_org_id.trim() && typeof r.veridian_api_key === "string" && r.veridian_api_key.trim()) {
    counts.well_formed++
    good.push(r)
  } else counts.malformed++
}
if (!apply) {
  console.log(JSON.stringify({ mode: "dry-run", ...counts }))
  process.exit(0)
}
const out = {}
for (const r of good) {
  let outcome
  try {
    const res = await fetch(`${strip(process.env.VERIDIAN_SUPABASE_URL)}/rest/v1/rpc/projexa_org_credential_put`, {
      method: "POST",
      headers: { apikey: process.env.VERIDIAN_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.VERIDIAN_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_projexa_org_id: r.organization_id, p_veridian_org_id: r.veridian_org_id, p_api_key: r.veridian_api_key }),
    })
    outcome = res.ok ? String(await res.json()) : "error"
  } catch {
    outcome = "error"
  }
  out[outcome] = (out[outcome] ?? 0) + 1
}
console.log(JSON.stringify({ mode: "apply", ...counts, outcomes: out }))
