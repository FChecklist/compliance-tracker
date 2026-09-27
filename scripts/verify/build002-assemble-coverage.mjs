#!/usr/bin/env node
// BUILD-002 WP-15: assembles ai-os/projexa-build-002/COVERAGE_111.csv (the coverage matrix AW-004 and AW-312 check) from the per-wave fragments
// (coverage-fragments/*.csv: requirement_id,function_ids,way,note) and the recorded exclusions (COVERAGE_EXCLUSIONS.csv), in the order of
// ai-os/projexa-build-001/REQUIREMENTS_111_REGISTER.csv. A requirement in a fragment keeps the union of its functions, ways and notes. One that is in
// no fragment must be in the exclusions file; one that is in neither is listed and the script exits 1 (nothing is written), so the matrix cannot be
// completed by guessing. --check compares the committed file with what would be written and exits 1 when they differ.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const dir = join(root, "ai-os", "projexa-build-002")

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
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = "" }
    else cell += c
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row) }
  return rows.filter((r) => r.some((c) => c !== ""))
}
const q = (s) => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s)
const uniq = (a) => [...new Set(a.filter(Boolean))]

const reg = parseCsv(readFileSync(join(root, "ai-os", "projexa-build-001", "REQUIREMENTS_111_REGISTER.csv"), "utf8"))
const ids = reg.slice(1).map((r) => r[0]).filter((x) => /^(R-|EXC-ITEM-)/.test(x))

const frag = new Map()
const fragDir = join(dir, "coverage-fragments")
for (const f of readdirSync(fragDir).filter((n) => n.endsWith(".csv")).sort()) {
  const [head, ...rows] = parseCsv(readFileSync(join(fragDir, f), "utf8"))
  const [iId, iFn, iWay, iNote] = ["requirement_id", "function_ids", "way", "note"].map((h) => head.indexOf(h))
  if ([iId, iFn, iWay, iNote].some((i) => i < 0)) { console.error(f + " needs columns requirement_id,function_ids,way,note"); process.exit(1) }
  for (const r of rows) {
    const cur = frag.get(r[iId]) ?? { fns: [], ways: [], notes: [] }
    cur.fns.push(...r[iFn].split(";").map((s) => s.trim()))
    cur.ways.push(...r[iWay].split(";").map((s) => s.trim()))
    cur.notes.push(r[iNote].trim())
    frag.set(r[iId], cur)
  }
}

const exc = new Map()
const exFile = join(dir, "COVERAGE_EXCLUSIONS.csv")
if (existsSync(exFile)) {
  const [head, ...rows] = parseCsv(readFileSync(exFile, "utf8"))
  const [iId, iFn, iWay, iWhy] = ["requirement_id", "function_ids", "way", "exclusion_reason"].map((h) => head.indexOf(h))
  for (const r of rows) exc.set(r[iId], { fns: r[iFn].split(";").map((s) => s.trim()), way: r[iWay], why: r[iWhy] })
}

const out = [["requirement_id", "function_ids", "exclusion_reason", "way", "note"]]
const missing = []
for (const id of ids) {
  const f = frag.get(id)
  const e = exc.get(id)
  if (f) out.push([id, uniq(f.fns).join(";"), "", uniq(f.ways).join(";"), uniq(f.notes).join(" / ")])
  else if (e && (e.fns.filter(Boolean).length || e.why)) out.push([id, uniq(e.fns).join(";"), e.why, e.way, ""])
  else missing.push(id)
}
const extra = [...frag.keys(), ...exc.keys()].filter((k) => !ids.includes(k))
if (missing.length || extra.length) {
  if (missing.length) console.error("in neither a fragment nor the exclusions: " + missing.join(", "))
  if (extra.length) console.error("not a requirement of the register: " + extra.join(", "))
  process.exit(1)
}
const text = out.map((r) => r.map(q).join(",")).join("\n") + "\n"
const target = join(dir, "COVERAGE_111.csv")
if (process.argv[2] === "--check") {
  if (!existsSync(target) || readFileSync(target, "utf8") !== text) { console.error("COVERAGE_111.csv is stale: run node scripts/verify/build002-assemble-coverage.mjs"); process.exit(1) }
  console.log("COVERAGE_111.csv is current (" + (out.length - 1) + " rows)")
} else {
  writeFileSync(target, text)
  console.log("wrote COVERAGE_111.csv (" + (out.length - 1) + " rows)")
}
