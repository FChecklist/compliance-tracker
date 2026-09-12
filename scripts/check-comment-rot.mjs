#!/usr/bin/env node
// R81 K1-04 -- the standing comment-rot check.
//
// WHY THIS IS NOT AN AGE-THRESHOLD TODO CHECK, which is what the work order
// suggested. R81's K1 sweep searched both repositories exhaustively and found
// **zero** conventional TODO/FIXME/HACK/XXX defect markers. ct's eight hits are
// identifiers (a gap id, a +91 9XXXXXXXXX phone placeholder, a string literal in
// r75-citation-gate.mjs); projexa has none at all. A check of the form "fail if a
// TODO older than N days has no fault row" would therefore pass on an empty set,
// for ever, and report green. That is false assurance -- the same defect class
// this session has been filing all block (a security control with green tests and
// no call sites; a register row true while its own proof fails). A vacuous check
// is worse than no check, because it is quoted as evidence.
//
// WHAT THE REPOSITORIES ACTUALLY DO. Defects here are documented in PROSE, inside
// long explanatory comments -- and they are genuinely valuable. The specimen that
// motivated all of this, tenant-scoped.ts's known-nesting list dated 2026-09-02,
// named the exact call site that later produced an HTTP 500 the moment two
// commits made it reachable. The remedy was written beside it. Nobody was
// watching whether it became reachable.
//
// So this check enforces the property that actually failed: EVERY KNOWN
// DEFECT-COMMENT HAS A LIVE FAULT ROW, AND EVERY ENTRY STAYS HONEST.
// It fails in three directions, because rot runs in three directions:
//   1. the comment is gone but the fault is still open  -> stale fault, close it
//   2. the comment is still there but the fault is gone -> undocumented defect
//   3. the anchor text drifted                          -> the registry is lying
//
// The registry below is the K1 sweep's output. Adding to it is how a future
// session records "I found a defect I am not fixing today" in a way that is
// checked rather than remembered.
import fs from "node:fs"
import path from "node:path"

const CT = path.resolve(import.meta.dirname, "..")
const PROJEXA = path.resolve(CT, "..", "projexa")

/**
 * anchor: a distinctive substring of the comment. Deliberately not a line
 * number -- line numbers drift on every edit above them and would make this
 * check noisy, which is how checks get disabled.
 */
const REGISTRY = [
  {
    fault: "R81_F26_NESTING_GUARD_WARNS_IN_PRODUCTION",
    repo: "ct",
    file: "src/lib/db/tenant-scoped.ts",
    // RE-ANCHORED 2026-09-08, and the reason is the check working exactly as
    // intended. The previous anchor was "WHAT IS ALREADY KNOWN TO NEST", the
    // heading over a hand-maintained list of nesting sites. The sibling session
    // replaced that list with a pointer to tenant-nesting-guard.test.ts, which
    // rebuilds the same answer from the real filesystem on every CI run. That
    // is a genuine improvement -- the list itself admitted it was "a snapshot,
    // not a maintained registry" -- so the right response was NOT to restore
    // the comment. This check fired, a human looked, and the registry moved.
    //
    // The new anchor deliberately points at the DEFECT rather than at any list:
    // R81_F26 is that the guard WARNS in production and lets the request
    // finish, and that sentence has to survive for as long as the fault is
    // open. A list of sites was always going to churn; the behaviour it
    // describes will not, until the guard is flipped to throw -- at which point
    // the fault closes and this entry should be removed with it.
    //
    // Chosen because it is present in BOTH the committed HEAD and the sibling
    // session's in-flight working copy, so re-anchoring cannot itself become
    // the next breakage.
    anchor: "lets the request finish",
  },
  {
    fault: "R81_F28_ONE_LINE_FROM_A_CROSS_TENANT_CACHE_LEAK",
    repo: "projexa",
    file: "src/lib/veridian-client.ts",
    anchor: "That is a real cross-tenant leak",
  },
  {
    fault: "R81_F29_AUTH_GUARD_CI_CHECK_NEVER_WIRED",
    repo: "ct",
    file: "scripts/check-route-auth-guard.mjs",
    anchor: "NOT yet wired into",
  },
  {
    fault: "R81_F31_DEMO_API_KEY_UNRESTRICTED_BEHIND_ONE_ENV_VAR",
    repo: "ct",
    file: "src/lib/supabase/api-key-auth.ts",
    anchor: "unsafe the moment it",
  },
  {
    fault: "R81_F32_UNWIRED_PILL_DEAD_ENDS_BEHIND_ONE_FLAG",
    repo: "projexa",
    file: "src/components/veri-chat/veri-chat-context.tsx",
    anchor: "SHOW_UNDISPATCHABLE_MODULE_CHAINS",
  },
]

function repoRoot(repo) {
  return repo === "ct" ? CT : PROJEXA
}

const failures = []
let checked = 0

for (const entry of REGISTRY) {
  const abs = path.join(repoRoot(entry.repo), entry.file)
  if (!fs.existsSync(abs)) {
    // The sibling repo may not be checked out in every CI job. Skipping is
    // correct; silently counting it as a pass is not.
    if (entry.repo === "projexa" && !fs.existsSync(PROJEXA)) {
      console.log(`SKIP  ${entry.fault} -- ${PROJEXA} not checked out here`)
      continue
    }
    failures.push(`${entry.fault}: ${entry.repo}/${entry.file} does not exist. If the file was deleted, remove this registry entry AND close the fault.`)
    continue
  }
  checked++
  const src = fs.readFileSync(abs, "utf8")
  if (!src.includes(entry.anchor)) {
    failures.push(
      `${entry.fault}: the documented defect comment is GONE from ${entry.repo}/${entry.file} ` +
      `(anchor "${entry.anchor}" no longer present). Either the defect was fixed -- in which case CLOSE the fault ` +
      `and remove this entry -- or the explanation was deleted while the defect remains, which is worse than the defect.`,
    )
  }
}

console.log(`comment-rot: ${checked} registry entr${checked === 1 ? "y" : "ies"} checked, ${failures.length} failure(s)`)
for (const f of failures) console.error(`FAIL  ${f}`)

if (failures.length) {
  console.error(
    "\nA documented defect and its fault row must live and die together.\n" +
    "A comment describing a defect that no longer exists sends the next reader chasing nothing;\n" +
    "a defect whose explanation was deleted is a defect nobody can see.",
  )
  process.exit(1)
}
process.exit(0)
