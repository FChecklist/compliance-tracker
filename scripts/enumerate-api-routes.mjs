#!/usr/bin/env node
// INST-B step 1: route enumeration, filesystem/router-derived only -- D56/PM
// directive is explicit that a hand-written list "inherits the same blind
// spot as the thing it measures." Walks the REAL src/app/api/** tree (Next.js
// App Router: a route.ts file IS a route, its exported HTTP-method functions
// ARE its methods -- no separate registry to drift out of sync with, unlike
// the page-route PROTECTED_APP_ROUTE_PREFIXES problem generate-protected-
// routes.mjs already fixed for a different surface).
//
// For each exported method (GET/POST/PUT/PATCH/DELETE), finds the first
// requireRole(...)/requireRoleOrScope(...) call inside that method's own
// function body and records its literal minimum-role argument -- the same
// "grepped out of each file, not re-typed by hand" method
// src/lib/supabase/authz-gate-coverage.test.ts's own header already
// describes and already proved works for 189 routes (R75 Phase 2). This
// script generalizes that from a fixed historical list to the live tree.
//
// LIMITATION, STATED NOT HIDDEN: this is a regex-based body slice, not a
// real AST/type-checker parse. It finds the guard call textually within the
// slice between one `export async function X(` and the next, which is
// correct for this codebase's own established convention (guard call as the
// first real statement in the handler, verified against the 189-route
// TABLE's own generation note) but would miss: a guard call inside a helper
// the handler calls (not inline), a guard behind unusual control flow, or a
// non-standard function declaration style. Routes where no guard is found
// are reported as NO_GUARD_DETECTED, not silently dropped and not silently
// accused of being unguarded -- see the "no_guard" bucket note in the output
// for why these need human triage, not an automatic verdict.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, "..")
const API_DIR = path.join(REPO_ROOT, "src", "app", "api")

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile() && (entry.name === "route.ts" || entry.name === "route.tsx")) out.push(full)
  }
  return out
}

// src/app/api/foo/[id]/route.ts -> @/app/api/foo/[id]/route (matches the
// tsconfig path alias + specifier convention authz-gate-coverage.test.ts's
// own TABLE already uses, verified against its literal entries)
function toSpecifier(absPath) {
  const rel = path.relative(path.join(REPO_ROOT, "src"), absPath).replace(/\\/g, "/").replace(/\.tsx?$/, "")
  return `@/${rel}`
}

function findMethodBodies(source) {
  // Slice the file at each `export async function METHOD(` (or the
  // non-async form, both appear in this codebase) up to the next export or
  // EOF, so each method's own guard call can't be confused with a sibling
  // method's.
  const boundaryRe = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g
  const hits = []
  let m
  while ((m = boundaryRe.exec(source))) hits.push({ method: m[1], start: m.index })
  const bodies = {}
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : source.length
    bodies[hits[i].method] = source.slice(hits[i].start, end)
  }
  return bodies
}

// Strips // line comments and /* */ block comments (not string/template
// literal contents -- naive but sufficient here since the only thing being
// searched for afterward is a bare identifier + call syntax, never
// something that would appear inside a real string literal in this
// codebase's guard-call convention). CAUGHT BY THE HARNESS'S OWN OUTPUT: a
// first version of this function didn't exist, and this codebase's own
// extensive-comment house style means a route's comment can say things like
// "the closest actually-gated sibling is POST /api/documents
// (requireRole(dbUser, \"member\"))" purely as documentation/precedent,
// which the naive regex matched as if it were this route's own guard call --
// 6 false "guarded" rows and 1 wrong-role row, all traced to exactly this,
// confirmed by reading conversations/route.ts's GET handler directly (real
// code: requireAuth() only, no requireRole at all; the "member" match came
// from a comment three lines below the function, discussing a DIFFERENT
// route entirely).
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

function findGuard(body) {
  // requireRole(<anything>, 'role') or requireRole(<anything>, "role") --
  // first occurrence in the slice, matching the established one-guard-per-
  // handler convention. requireRoleOrScope has the same (ctx, role) shape.
  const re = /(requireRole|requireRoleOrScope)\s*\([^,]*,\s*["']([a-z_]+)["']/
  const m = re.exec(stripComments(body))
  if (!m) return null
  return { guard: m[1], role: m[2] }
}

const files = walk(API_DIR).sort()
const rows = []
let noGuardCount = 0
let guardedCount = 0

for (const file of files) {
  const source = fs.readFileSync(file, "utf8")
  const bodies = findMethodBodies(source)
  const specifier = toSpecifier(file)
  const relFile = path.relative(REPO_ROOT, file).replace(/\\/g, "/")
  for (const [method, body] of Object.entries(bodies)) {
    const guard = findGuard(body)
    if (guard) {
      guardedCount++
      rows.push({ specifier, file: relFile, method, guard: guard.guard, role: guard.role })
    } else {
      noGuardCount++
      rows.push({ specifier, file: relFile, method, guard: null, role: null })
    }
  }
}

const outDir = path.join(REPO_ROOT, "kt-instb")
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, "route-enumeration.json")
fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      generated_by: "scripts/enumerate-api-routes.mjs",
      source_dir: "src/app/api",
      route_files_scanned: files.length,
      methods_total: rows.length,
      methods_guarded: guardedCount,
      methods_no_guard_detected: noGuardCount,
      note_on_no_guard: "NO_GUARD_DETECTED means this script's regex found no requireRole/requireRoleOrScope call directly in the method body -- it is NOT a security verdict by itself. Real reasons this happens: (1) genuinely public/token-authenticated routes (share links, invite tokens, webhooks -- by design, not a gap), (2) a guard delegated to a helper function this regex doesn't follow, (3) a genuine missing gate. Triage each no_guard row by hand before treating any single one as a finding.",
      rows,
    },
    null,
    2
  )
)
console.log(`enumerate-api-routes: scanned ${files.length} route files, ${rows.length} methods total, ${guardedCount} with a detected requireRole/requireRoleOrScope guard, ${noGuardCount} NO_GUARD_DETECTED (triage required, not an automatic finding). Wrote ${outFile}`)
