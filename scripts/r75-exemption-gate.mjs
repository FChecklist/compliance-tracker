#!/usr/bin/env node
// R75 Part 2 Phase 0 (V0-03): the anti-fabrication exemption gate.
//
// GV-24: tenant-scoping is NOT role restriction. A route that scopes a query
// by org (withTenantContext / org-scoped / RLS on org_id) but lets ANY role
// within that org act is still a real authz gap, not an exemption. This gate
// mechanically re-applies the exact distinction used to reject 5 of the
// agent's own "exempt" verdicts in W2-01 (compliance/[id]/comments,
// construction/ai/diff-drawings, construction/ai/estimate-progress,
// compliance/export-event, ai/orchestrate) -- their evidence cited ONLY
// tenant-scoping, never a role/permission/ownership/participant mechanism.
//
// Rule: an exemption's `reason` text must name a REAL restriction beyond
// tenant/org scoping and beyond "the caller must be authenticated" --
// a role check, a permission check, an ownership/self-scoping check, or a
// participant/membership check. Citing ONLY withTenantContext / org-scoped /
// RLS / "authenticated" is rejected outright, regardless of how confident
// the wording sounds.
//
// Usage: node scripts/r75-exemption-gate.mjs <exemptions.json>
// exemptions.json shape: [{ path, reason }, ...] (or a single {path, reason})
// Exit 0 = every entry names a real restriction. Exit 1 = at least one
// rests on tenant-scoping/authentication alone; prints which.
import fs from "node:fs"

// Signals that indicate a REAL restriction on WHICH caller may act, not just
// WHERE (which org) the data lives.
const REAL_RESTRICTION_SIGNALS = [
  /\brole\b/i, /\bRole\b/, /requireRole/i, /requireRoleOrScope/i, /hasRole/i, /requireAdmin/i,
  /requirePermissionForUser/i, /requirePromptPermissionForUser/i, /permission/i,
  /assertGate/i, /canCreate/i, /canEdit/i, /canReassign/i, /canDelete/i,
  /assertParticipant/i, /participant/i, /membership/i,
  /\bowner(ship)?\b/i, /ownedBy/i, /self-scop/i, /self scop/i,
  /\brank\b/i, /MEMBER_RANK/i, /MANAGER_RANK/i,
  /\.userId\s*===?\s*ctx\.userId/i, /ctx\.userId\s*===?\s*.*\.userId/i,
  /caller'?s own/i, /the caller'?s? own/i,
  // Found missing during V2-05 (re-running this gate over the real 85):
  // these idioms are just as real an ownership/self-scoping restriction as
  // the ones above, the regex list was simply incomplete, not the 10
  // flagged routes -- confirmed by reading every one of their reason texts
  // before broadening this list, not assumed.
  /!==?\s*ctx\.userId/i, /!==?\s*dbUser\.id/i, /!==?\s*.*\.userId\)/i,
  /current_user_id\(\)/i, /can only .*themself/i, /scoped to userId/i,
  /userId:\s*dbUser\.id/i, /userId:\s*ctx\.userId/i,
  /eq\([^)]*\.userId,\s*(dbUser|ctx)\./i, // drizzle eq(table.userId, dbUser.id) ownership filter
]

// Signals that, on their OWN, are NOT sufficient -- tenant isolation is a
// baseline every mutating route already has, not evidence of role
// restriction. An exemption citing ONLY these is rejected.
const SCOPING_ONLY_SIGNALS = [
  /withTenantContext/i, /org-?scoped/i, /orgId filtering/i, /tenant.?isolat/i,
  /\bRLS\b/i, /row-level security/i, /\bauthenticated\b(?!.{0,40}(role|permission|owner))/i,
]

function evaluate(entry) {
  const reason = entry.reason ?? ""
  const hasReal = REAL_RESTRICTION_SIGNALS.some(rx => rx.test(reason))
  const hasScopingOnly = SCOPING_ONLY_SIGNALS.some(rx => rx.test(reason))
  const verdict = hasReal ? "PASS" : "FAIL"
  const detail = hasReal
    ? `names a real restriction beyond tenant-scoping (matched a role/permission/ownership/participant signal)`
    : hasScopingOnly
      ? `rests ONLY on tenant-scoping/authentication ("${reason.slice(0, 140)}") -- REJECTED per GV-24, this is a real gap, not an exemption`
      : `no real-restriction signal found and no recognizable scoping-only phrase either -- reason text is too vague to accept as an exemption ("${reason.slice(0, 140)}")`
  return { path: entry.path, verdict, detail }
}

const argv = process.argv.slice(2)
const inputPath = argv[0]
if (!inputPath) {
  console.error("usage: node scripts/r75-exemption-gate.mjs <exemptions.json>")
  process.exit(2)
}
const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"))
const entries = Array.isArray(raw) ? raw : [raw]

let anyFail = false
const flagged = []
for (const e of entries) {
  const r = evaluate(e)
  console.log(`${r.verdict} | ${r.path} | ${r.detail}`)
  if (r.verdict === "FAIL") { anyFail = true; flagged.push(r.path) }
}
console.log(`--- ${entries.length} exemptions checked, ${flagged.length} flagged ---`)
if (flagged.length) console.log("FLAGGED (reclassify as real gaps, do not leave in EXEMPT_ROUTES): " + flagged.join(", "))
process.exit(anyFail ? 1 : 0)
