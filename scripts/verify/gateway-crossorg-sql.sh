#!/usr/bin/env bash
# register: BR-320
# PROJEXA-BUILD-001 phase 3 (U-25, PMD-01, E-07): the gateway's query path is tenant-isolated by the database itself. As the pooled
# role app_runtime (VERIFY_DATABASE_URL), with app.current_org_id set to organisation A, the rows of organisation B in
# compliance.construction_boq_line_items and compliance.construction_boqs are invisible (0), while A's own BOQ lines are visible
# (more than 0); then the same with A and B swapped. Row-level security (FORCE on both tables, policy app_runtime_tenant_isolation
# keyed on compliance.current_org_id()) is what hides them; the script adds no filter of its own on the organisation being hidden.
#
# READ ONLY: one transaction, BEGIN READ ONLY, statement_timeout 8 s, and it always ends in ROLLBACK (the work is done inside
# postgres.js sql.begin, whose callback always throws a sentinel at the end, which makes the driver roll back). The only thing it
# sets is the transaction-local setting app.current_org_id (set_config(..., true)); it writes no row.
#
# HOW IT CHOOSES A AND B (two organisations that really have BOQ lines) -- the role can only see rows of the organisation in the
# setting, so it cannot simply list organisations that have lines:
#   1. ORG_A and ORG_B from the environment, if both are set (each must then have lines, or the run cannot prove anything: exit 2);
#   2. otherwise candidates are read with the setting empty: compliance.organisations first (under its app_runtime policy
#      `id = current_org_id()` it returns no row when the setting is empty, which is expected and reported), then the distinct
#      org_id of compliance.users (its policy app_runtime_preauth_read_users lets app_runtime read users while no organisation is
#      set, the pre-authentication lookup the app itself does); each candidate, in id order, is set as the organisation in turn
#      and asked how many BOQ lines IT can see, and the first two with more than 0 are A and B.
#
# Refuses to run (exit 2) when the connected role bypasses row-level security (postgres, service_role): the check would be vacuous.
#
# stdout last line on success: CROSS_ORG_ROWS=0 OWN_ORG_ROWS_NONZERO=yes (exit 0).
# Exit 1: a row of the other organisation was visible, or an organisation's own lines were not (last line CROSS_ORG_ROWS=<n>
#   OWN_ORG_ROWS_NONZERO=<yes|no>). Exit 2: cannot run (no VERIFY_DATABASE_URL, no connection, an RLS-bypassing role, fewer than two
#   organisations with lines). Organisation ids are printed as 8-character prefixes only.
#
# Usage: bash scripts/verify/gateway-crossorg-sql.sh      (VERIFY_DATABASE_URL = the pooled app_runtime connection string; optional
#        ORG_A, ORG_B). Needs node and the repo's postgres dependency (bun install).
set -u

ID="BR-320"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

command -v node >/dev/null 2>&1 || { printf 'FAIL %s: node is not available on PATH\n' "$ID" >&2; exit 2; }
[ $# -eq 0 ] || { printf 'FAIL %s: this script takes no arguments\n' "$ID" >&2; exit 2; }
[ -n "${VERIFY_DATABASE_URL:-}" ] || { printf 'cannot run: VERIFY_DATABASE_URL is not set\nFAIL %s: cannot run\n' "$ID" >&2; exit 2; }

cd "$ROOT" || exit 2
node --input-type=module - <<'JS'
import postgres from "postgres"

const ROLLBACK = Symbol("always roll back")
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const p8 = (s) => String(s).slice(0, 8)
const cannot = (why) => { console.error(`cannot run: ${why}`); console.error("FAIL BR-320: cannot run"); return 2 }

async function main() {
  const envA = process.env.ORG_A ?? ""
  const envB = process.env.ORG_B ?? ""
  if ((envA || envB) && !(ID_RE.test(envA) && ID_RE.test(envB) && envA !== envB)) return cannot("ORG_A and ORG_B must both be set, differ, and be plain ids")

  const sql = postgres(process.env.VERIFY_DATABASE_URL, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 15 })
  let result = null
  try {
    await sql.begin("read only", async (tx) => {
      await tx`set local statement_timeout = 8000`
      const [me] = await tx`select current_user as role, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`
      console.log(`role=${me.role} bypassrls=${me.bypass}`)
      if (me.bypass) { result = { cannot: `role ${me.role} bypasses row-level security, so hidden rows would be visible anyway` }; throw ROLLBACK }

      const setOrg = (org) => tx`select set_config('app.current_org_id', ${org}, true)`
      const visibleLines = async (org) => { await setOrg(org); const [r] = await tx`select count(*)::int as n from compliance.construction_boq_line_items`; return r.n }

      let a = envA
      let b = envB
      if (!a) {
        await setOrg("")
        const [orgs] = await tx`select count(*)::int as n from compliance.organisations`
        console.log(`candidates: compliance.organisations visible with no organisation set = ${orgs.n} (0 expected under its app_runtime policy)`)
        const users = await tx`select distinct org_id from compliance.users where org_id is not null order by 1`
        console.log(`candidates: distinct compliance.users.org_id visible with no organisation set = ${users.length}`)
        const found = []
        let tried = 0
        for (const { org_id } of users) {
          tried++
          await setOrg(org_id)
          const [h] = await tx`select count(*)::int as n from compliance.construction_boqs`
          if (h.n === 0) continue
          if ((await visibleLines(org_id)) > 0) found.push(org_id)
          if (found.length === 2) break
        }
        console.log(`candidates tried: ${tried}; organisations with visible BOQ lines found: ${found.length}`)
        if (found.length < 2) { result = { cannot: "fewer than two organisations with BOQ lines are visible to this role" }; throw ROLLBACK }
        ;[a, b] = found
      }

      const pass = async (own, other) => {
        await setOrg(own)
        const [r] = await tx`
          select (select count(*)::int from compliance.construction_boq_line_items where org_id = ${other}) as other_lines,
                 (select count(*)::int from compliance.construction_boqs where org_id = ${other}) as other_headers,
                 (select count(*)::int from compliance.construction_boq_line_items where org_id = ${own}) as own_lines`
        console.log(`as ${p8(own)}: other org ${p8(other)} lines=${r.other_lines} boq headers=${r.other_headers}; own lines=${r.own_lines}`)
        return r
      }
      const ab = await pass(a, b)
      const ba = await pass(b, a)
      const cross = ab.other_lines + ab.other_headers + ba.other_lines + ba.other_headers
      const own = ab.own_lines > 0 && ba.own_lines > 0
      result = { cross, own }
      throw ROLLBACK
    })
  } catch (e) {
    if (e !== ROLLBACK) return cannot(`query or connection error: ${String(e && e.message ? e.message : e).split("\n")[0]}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
  if (!result) return cannot("no result")
  if (result.cannot) return cannot(result.cannot)
  console.log("transaction rolled back (read only; nothing written)")
  console.log(`CROSS_ORG_ROWS=${result.cross} OWN_ORG_ROWS_NONZERO=${result.own ? "yes" : "no"}`)
  if (result.cross === 0 && result.own) { console.error("PASS BR-320"); return 0 }
  console.error(`FAIL BR-320: ${result.cross} row(s) of the other organisation visible${result.own ? "" : "; an organisation's own lines were not visible"}`)
  return 1
}

main().then((code) => { process.exitCode = code })
JS
