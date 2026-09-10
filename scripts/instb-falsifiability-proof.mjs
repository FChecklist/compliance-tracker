#!/usr/bin/env node
// INST-B falsifiability proof (D56 hard requirement: "an unfalsified
// instrument is worth nothing here" -- four instruments today already
// failed this exact bar). Plants a route with a DELIBERATELY BROKEN guard
// (the guard call is textually present, so the enumerator finds it and
// declares a minimum role -- but the code ignores the check's result, so a
// below-minimum caller is NOT actually rejected) directly in the real
// src/app/api tree, runs the full real pipeline (enumerate -> generate
// table -> the sweep test) against it, and asserts the sweep CATCHES it --
// proving the instrument can fail, not just that it can pass.
//
// Cleans up after itself unconditionally (try/finally) so the fixture never
// survives this script, whether it passes or throws.
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, "..")
const FIXTURE_DIR = path.join(REPO_ROOT, "src", "app", "api", "__instb_falsifiability_fixture__")
const FIXTURE_FILE = path.join(FIXTURE_DIR, "route.ts")

const BROKEN_ROUTE_SOURCE = `// INST-B FALSIFIABILITY FIXTURE -- planted and removed by
// scripts/instb-falsifiability-proof.mjs. If you are reading this in a
// committed tree, the proof script did not clean up correctly; delete this
// directory.
//
// DELIBERATE BUG: requireRole is called (so the enumerator's textual scan
// finds a real "admin" guard here, same as any real route) but its return
// value is thrown away instead of being returned to reject the caller --
// the exact bug class DOD-C7 exists to catch: a below-minimum caller is NOT
// actually rejected despite the guard call being present in the source.
import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"

export async function POST() {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  requireRole(dbUser!, "admin") // BUG: result discarded, never returned/checked
  return NextResponse.json({ ok: true, note: "a viewer just deleted something an admin-only route should have refused" })
}
`

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: REPO_ROOT, encoding: "utf8" })
}

console.log("=== INST-B falsifiability proof: planting a deliberately-broken guard ===")
fs.mkdirSync(FIXTURE_DIR, { recursive: true })
fs.writeFileSync(FIXTURE_FILE, BROKEN_ROUTE_SOURCE)

let caught = false
let proofLog = ""
try {
  proofLog += run("node", ["scripts/enumerate-api-routes.mjs"])
  proofLog += run("node", ["scripts/generate-authz-gate-table.mjs"])

  // Confirm the enumerator actually found the planted guard as "admin" --
  // if it didn't, the rest of this proof would be vacuous.
  const table = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "kt-instb", "authz-gate-table.json"), "utf8"))
  const planted = table.find((e) => e.specifier.includes("__instb_falsifiability_fixture__"))
  if (!planted) throw new Error("PROOF FAILED AT STEP 1: the enumerator did not even detect the planted guard -- fixture setup is broken, not the harness under test")
  console.log(`Step 1 OK: enumerator found the planted route with role="${planted.role}" (methods: ${planted.methods.join(",")})`)

  try {
    run("bun", ["test", "./src/lib/supabase/instb-authz-gate-full-sweep.test.ts", "-t", "__instb_falsifiability_fixture__"])
    // If bun test exits 0, the sweep did NOT catch the broken gate -- proof fails
    console.log("PROOF FAILED: the sweep test PASSED against a deliberately-broken guard. The instrument cannot fail. Do not trust its results.")
  } catch (e) {
    // Non-zero exit from bun test IS the expected, correct outcome here --
    // it means the sweep caught the broken gate and reported a real failure.
    caught = true
    proofLog += (e.stdout ?? "") + (e.stderr ?? "")
    console.log("Step 2 OK: the sweep test FAILED against the planted broken guard -- the instrument correctly caught it.")
  }
} finally {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true })
  console.log("Cleanup: fixture removed.")
  run("node", ["scripts/enumerate-api-routes.mjs"])
  run("node", ["scripts/generate-authz-gate-table.mjs"])
  console.log("Cleanup: real enumeration/table regenerated from the clean tree (fixture no longer present in either).")
}

const outFile = path.join(REPO_ROOT, "kt-instb", "falsifiability-proof-result.txt")
fs.writeFileSync(
  outFile,
  `INST-B DOD-C7 falsifiability proof\nresult: ${caught ? "PASS -- instrument correctly failed against a deliberately-broken guard" : "FAIL -- instrument did NOT catch a deliberately-broken guard, results are not trustworthy"}\n\n${proofLog}`
)
console.log(`Wrote ${outFile}`)

if (!caught) {
  console.error("FALSIFIABILITY PROOF FAILED -- do not report DOD-C7 sweep results as evidence until this is fixed.")
  process.exit(1)
}
console.log("=== FALSIFIABILITY PROOF PASSED ===")
