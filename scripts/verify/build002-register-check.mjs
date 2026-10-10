#!/usr/bin/env node
// register: AW-002, AW-003, AW-004, AW-312, AW-511 (BUILD-002, ai-os/projexa-build-002/)
//
// Checks the BUILD-002 acceptance register and the files its rows point at.
//   --lint             the register parses; ids AW-nnn are unique; every verify_command is one line; every row names a work package
//   --shared-boundary  the objects BUILD-002 creates are named in ai-os/SHARED_BOUNDARY.md
//   --coverage-111     ai-os/projexa-build-002/COVERAGE_111.csv maps every requirement id of REQUIREMENTS_111_REGISTER.csv (built by WP-05)
//   --exceptions       COVERAGE_111.csv gives every EXC-ITEM row a function or a recorded reason (WP-05f)
//   --owner-kit        the prepared enable-writes migration, its down file and the owner guide exist (WP-09)
// Exit 0 pass, 1 fail, 3 not built yet (a row must never pass because its input does not exist).
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const dir = join(root, "ai-os", "projexa-build-002")
const mode = process.argv[2]

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ",") { row.push(cell); cell = "" }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = "" }
    else if (c !== "\r") cell += c
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.length > 1 || r[0] !== "")
}

function fail(msg) { console.error("FAIL " + msg); process.exitCode = 1 }
function notBuilt(msg) { console.error("NOT BUILT " + msg); process.exit(3) }

function lint() {
  const file = join(dir, "ACCEPTANCE_REGISTER.csv")
  if (!existsSync(file)) return notBuilt("ACCEPTANCE_REGISTER.csv missing")
  const [head, ...body] = parseCsv(readFileSync(file, "utf8"))
  const want = ["id", "area", "title", "source", "verify_command", "expected_output", "status", "evidence_ref", "owner_blocked"]
  if (head.join(",") !== want.join(",")) fail("header is " + head.join(","))
  const seen = new Set()
  for (const r of body) {
    if (r.length !== want.length) { fail((r[0] || "?") + " has " + r.length + " columns"); continue }
    const [id, , title, source, cmd, , status, , blocked] = r
    if (!/^AW-\d{3}$/.test(id)) fail(id + " is not AW-nnn")
    if (seen.has(id)) fail(id + " duplicated")
    seen.add(id)
    if (!title.trim()) fail(id + " empty title")
    if (!/^WP-\d\d/.test(source)) fail(id + " source names no work package (WP-nn)")
    if (!cmd.trim() || /\n/.test(cmd)) fail(id + " verify_command empty or multi-line")
    if (!["pending", "pass", "fail", "blocked_owner"].includes(status)) fail(id + " status " + status)
    if (!["yes", "no"].includes(blocked)) fail(id + " owner_blocked " + blocked)
    if (blocked === "yes" && status === "pass") fail(id + " owner-blocked row cannot be marked pass by the PM")
  }
  if (!process.exitCode) console.log("OK " + body.length + " rows")
}

function sharedBoundary() {
  const text = readFileSync(join(root, "ai-os", "SHARED_BOUNDARY.md"), "utf8")
  for (const name of ["ai-work-link-exec", "ai_work_link_"]) if (!text.includes(name)) fail("SHARED_BOUNDARY.md does not name " + name)
  if (!process.exitCode) console.log("OK")
}

function coverage(exceptionsOnly) {
  const cov = join(dir, "COVERAGE_111.csv")
  if (!existsSync(cov)) return notBuilt("COVERAGE_111.csv is created by WP-05")
  const reg = parseCsv(readFileSync(join(root, "ai-os", "projexa-build-001", "REQUIREMENTS_111_REGISTER.csv"), "utf8"))
  const ids = reg.slice(1).map((r) => r[0]).filter((x) => /^(R-|EXC-ITEM-)/.test(x))
  const [head, ...rows] = parseCsv(readFileSync(cov, "utf8"))
  const iId = head.indexOf("requirement_id")
  const iFn = head.indexOf("function_ids")
  const iWhy = head.indexOf("exclusion_reason")
  if (iId < 0 || iFn < 0 || iWhy < 0) return fail("COVERAGE_111.csv needs columns requirement_id,function_ids,exclusion_reason")
  const byId = new Map(rows.map((r) => [r[iId], r]))
  let unmapped = 0
  for (const id of ids) {
    if (exceptionsOnly && !id.startsWith("EXC-ITEM-")) continue
    const r = byId.get(id)
    if (!r || (!r[iFn].trim() && !r[iWhy].trim())) { console.error("unmapped " + id); unmapped++ }
  }
  if (unmapped) fail("unmapped = " + unmapped)
  else console.log("OK unmapped = 0")
}

function ownerKit() {
  // AW-511 (WP-09b): the guide, the prepared enable-writes migration and its down file (outside drizzle/, in no journal, so nothing applies them), the
  // pre-flight and the kill-switch drill exist, the guide names every owner step, and nothing outside the prepared file sets the switch on.
  const rel = (p) => join(root, p)
  const guide = join(dir, "OWNER_SWITCH_ON_GUIDE.md")
  const prepared = join(dir, "prepared")
  const enable = join(prepared, "0645_build002_awl_enable_writes.sql")
  const disable = join(prepared, "0645_build002_awl_enable_writes.down.sql")
  const files = [guide, enable, disable, rel("scripts/verify/awl-exec-preflight.sh"), rel("scripts/verify/awl-killswitch-drill.sh"), rel("scripts/awl-local-exec-host.ts"), rel("scripts/verify/awl-exec-closure.mjs")]
  const miss = files.filter((f) => !existsSync(f))
  if (miss.length) return notBuilt("owner kit missing: " + miss.map((f) => f.slice(root.length + 1)).join(", "))
  const guideText = readFileSync(guide, "utf8")
  for (const term of ["AWL_EXEC_INTERNAL_SECRET", "APP_RUNTIME_DATABASE_URL", "awl-exec-preflight.sh", "AWL_EXEC_READY db_role=app_runtime", "EXEC_FUNCTION_PRESENT", "0645_build002_awl_enable_writes.sql", "writes_enabled = false", "awl-killswitch-drill.sh"]) {
    if (!guideText.includes(term)) fail("OWNER_SWITCH_ON_GUIDE.md does not name " + term)
  }
  if (!/SET writes_enabled = true/.test(readFileSync(enable, "utf8"))) fail("the prepared migration does not set writes_enabled = true")
  if (!/SET writes_enabled = false/.test(readFileSync(disable, "utf8"))) fail("the down file does not set writes_enabled = false")
  // unapplied: not in drizzle/ and not in its journal
  const drizzleDir = join(root, "drizzle")
  if (existsSync(drizzleDir) && readdirSync(drizzleDir).some((f) => /awl_enable_writes/.test(f))) fail("an enable-writes migration is inside drizzle/ (it must stay outside, unapplied)")
  const journal = join(drizzleDir, "meta", "_journal.json")
  if (existsSync(journal) && readFileSync(journal, "utf8").includes("awl_enable_writes")) fail("the journal names the enable-writes migration")
  if (!process.exitCode) console.log("OK")
}

switch (mode) {
  case "--lint": lint(); break
  case "--shared-boundary": sharedBoundary(); break
  case "--coverage-111": coverage(false); break
  case "--exceptions": coverage(true); break
  case "--owner-kit": ownerKit(); break
  default: console.error("usage: build002-register-check.mjs --lint | --shared-boundary | --coverage-111 | --exceptions | --owner-kit"); process.exit(2)
}
