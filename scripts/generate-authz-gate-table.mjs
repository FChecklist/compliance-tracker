#!/usr/bin/env node
// INST-B step 2: turns kt-instb/route-enumeration.json's GUARDED rows (only
// -- routes with a detected requireRole/requireRoleOrScope call; the
// no-guard bucket is a separate triage output, not in scope for a
// below/at-minimum boundary test that has no minimum to test) into the same
// {specifier, guard, role, methods} TABLE shape
// src/lib/supabase/authz-gate-coverage.test.ts already uses and already
// proved works for its original 189-route slice (R75 Phase 2). Generalizes
// it from that fixed historical list to every guarded route this repo has
// today.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, "..")
const enumPath = path.join(REPO_ROOT, "kt-instb", "route-enumeration.json")

if (!fs.existsSync(enumPath)) {
  console.error(`error: ${enumPath} not found -- run scripts/enumerate-api-routes.mjs first`)
  process.exit(1)
}

const enumeration = JSON.parse(fs.readFileSync(enumPath, "utf8"))
const guardedRows = enumeration.rows.filter((r) => r.guard)

const groups = new Map() // key: specifier|guard|role -> methods[]
for (const row of guardedRows) {
  const key = `${row.specifier}|${row.guard}|${row.role}`
  if (!groups.has(key)) groups.set(key, { specifier: row.specifier, guard: row.guard, role: row.role, methods: [] })
  groups.get(key).methods.push(row.method)
}

const table = [...groups.values()].sort((a, b) => a.specifier.localeCompare(b.specifier))

const outFile = path.join(REPO_ROOT, "kt-instb", "authz-gate-table.json")
fs.writeFileSync(outFile, JSON.stringify(table, null, 2))
console.log(`generate-authz-gate-table: ${guardedRows.length} guarded methods -> ${table.length} (specifier,guard,role) groups. Wrote ${outFile}`)
