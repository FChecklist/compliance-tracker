#!/usr/bin/env node
// register: AW-504 (BUILD-002 WP-09b, spec 9.8; write-path gap report section 2b, blockers B1 to B11).
//
// Computes the import closure of the entry of the ai-work-link-exec Edge function (src/lib/pipeline/link-exec-entry.ts) and FAILS when any module
// that cannot run in a Deno Edge Function, or that would put a model call on link traffic, is reachable from it: next/*, next-intl, resend, xlsx,
// pdf-parse, mathjs, a model client or provider, the task-execution engine. It then measures the size of the real bundle.
//
//   node scripts/verify/awl-exec-closure.mjs                 closure check, then bundle size (exit 0 = pass)
//   node scripts/verify/awl-exec-closure.mjs --list          also print every file in the closure with its size
//   node scripts/verify/awl-exec-closure.mjs --why <text>    print the import chain from the entry to every file or package whose name has <text>
//   node scripts/verify/awl-exec-closure.mjs --entry <path>  another entry (the self-test uses this)
//   node scripts/verify/awl-exec-closure.mjs --no-bundle     the static walk only (no bun needed)
//   node scripts/verify/awl-exec-closure.mjs --emit <file>   also write the bundle (the deploy step: app.bundle.mjs is generated, never committed)
//
// THE WALK is static and conservative: `import x from`, `export ... from`, side-effect imports, dynamic `import("...")` and `require("...")` all
// count, because a bundler follows every one. A pure type import (`import type`, or a clause whose names are all `type` names, or whose local
// names are never used in the file) is not followed, as TypeScript and the bundler drop it. `@/` and relative paths are followed; every other
// specifier is a package (a leaf). The bundle size comes from `bun build --target=node --minify` over the same entry; the limit is 5 MB (the API
// bundling limit of the Supabase Edge Function deploy, spec 9.8), the goal 2 MB.
//
// Exit 0 pass, 1 a forbidden module is reachable or the bundle is over the limit, 3 the entry does not exist yet (a row must not pass on a
// missing input).
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { FORBIDDEN_FILES, FORBIDDEN_PACKAGES, fileStub, packageStub } from "../awl-exec-aliases.mjs"

const root = process.cwd()
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const ENTRY = opt("--entry") ?? "src/lib/pipeline/link-exec-entry.ts"
const LIMIT_BYTES = 5_000_000
const GOAL_BYTES = 2_000_000

const norm = (f) => f.split(sep).join("/")
const rel = (f) => norm(f).replace(norm(root) + "/", "")
const EXT = ["", ".ts", ".tsx", "/index.ts", "/index.tsx", ".json"]

function resolveSpec(spec, from) {
  let base
  if (spec.startsWith("@/")) base = join(root, "src", spec.slice(2))
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec)
  else return null
  for (const e of EXT) {
    const f = base + e
    if (existsSync(f) && statSync(f).isFile()) {
      // the exec bundle maps some modules to stubs (scripts/awl-exec-aliases.mjs): the stub is what is reached, not the module
      const stub = fileStub(rel(norm(f)))
      return stub ? norm(join(root, stub)) : norm(f)
    }
  }
  return null
}

// `import <clause> from "x"`, `export <* | * as n | { a } | type { a }> from "x"` and the side-effect form `import "x"`. The clause is only
// names, braces, commas, stars and `as`: no quote, semicolon, `=` or `(` can be in it, so a `pgTable("name")` call is never read as an import.
const FROM_RE = /(?:^|[\n;])[ \t]*(import|export)[ \t]+(type[ \t]+)?([\w$*{}, \t\n]+?)[ \t\n]+from[ \t\n]*(['"])([^'"\n]+)\4/g
const SIDE_RE = /(?:^|[\n;])[ \t]*import[ \t]*(['"])([^'"\n]+)\1/g
const DYN_RE = /(?:\bimport|\brequire)\(\s*(['"])([^'"\n]+)\1\s*\)/g

function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1")
}

/** The specifiers this file pulls in at run time. A type-only import, or one whose bindings are never used, is dropped like the compiler does. */
export function importsOf(text) {
  const code = stripComments(text)
  const out = []
  let m
  FROM_RE.lastIndex = 0
  while ((m = FROM_RE.exec(code))) {
    const [whole, kind, typeOnly, clause, , spec] = m
    if (typeOnly) continue
    const c = clause.trim()
    if (kind === "import") {
      // named / default / namespace bindings: drop the import if every binding is a type or unused
      const locals = []
      let allType = true
      const named = /\{([^}]*)\}/.exec(c)
      if (named) {
        for (const part of named[1].split(",")) {
          const p = part.trim()
          if (!p) continue
          if (/^type\s/.test(p)) continue
          allType = false
          const asName = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(p)
          locals.push(asName ? asName[1] : p)
        }
      }
      const rest = c.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim()
      if (rest) {
        allType = false
        const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(rest)
        locals.push(ns ? ns[1] : rest.split(/\s+/)[0])
      }
      if (allType && locals.length === 0) continue
      const body = code.replace(whole, " ")
      const used = locals.some((n) => new RegExp("(^|[^\w$.])" + n.replace(/\$/g, "\$") + "([^\w$]|$)").test(body))
      if (!used) continue
    }
    out.push(spec)
  }
  SIDE_RE.lastIndex = 0
  while ((m = SIDE_RE.exec(code))) out.push(m[2])
  DYN_RE.lastIndex = 0
  while ((m = DYN_RE.exec(code))) out.push(m[2])
  return out
}

/** Walks the closure. Returns { files: Map(file -> parent), packages: Map(spec -> parent file) }. */
export function walk(entryFile) {
  const files = new Map([[norm(entryFile), null]])
  const packages = new Map()
  const queue = [norm(entryFile)]
  while (queue.length) {
    const f = queue.shift()
    if (f.endsWith(".json")) continue
    for (const spec of importsOf(readFileSync(f, "utf8"))) {
      const r = resolveSpec(spec, f)
      if (r) {
        if (!files.has(r)) {
          files.set(r, f)
          queue.push(r)
        }
      } else if (!spec.startsWith(".") && !spec.startsWith("@/")) {
        const stub = packageStub(spec)
        if (stub) {
          const sf = norm(join(root, stub))
          if (!files.has(sf)) {
            files.set(sf, f)
            queue.push(sf)
          }
        } else if (!packages.has(spec)) packages.set(spec, f)
      }
    }
  }
  return { files, packages }
}

function chainOf(files, f) {
  const path = []
  for (let cur = f; cur; cur = files.get(cur)) path.unshift(rel(cur))
  return path
}

function main() {
  const entry = resolve(root, ENTRY)
  if (!existsSync(entry)) {
    console.error("NOT BUILT " + ENTRY + " does not exist yet")
    process.exit(3)
  }
  const { files, packages } = walk(entry)
  let bytes = 0
  for (const f of files.keys()) bytes += statSync(f).size
  console.log(`CLOSURE entry=${ENTRY} files=${files.size} source_bytes=${bytes} packages=${packages.size}`)

  if (flag("--list")) for (const f of [...files.keys()].sort()) console.log(`  ${String(statSync(f).size).padStart(8)}  ${rel(f)}`)
  const why = opt("--why")
  if (why) {
    for (const f of files.keys()) if (rel(f).includes(why)) console.log("  WHY " + chainOf(files, f).join(" -> "))
    for (const [p, from] of packages) if (p.includes(why)) console.log("  WHY " + chainOf(files, from).join(" -> ") + " -> " + p)
  }

  const bad = []
  for (const [spec, from] of packages) {
    for (const [re, label] of FORBIDDEN_PACKAGES) if (re.test(spec)) bad.push(`${label}: ${chainOf(files, from).join(" -> ")} -> ${spec}`)
  }
  for (const f of files.keys()) {
    for (const [re, label] of FORBIDDEN_FILES) if (re.test(rel(f))) bad.push(`${label}: ${chainOf(files, f).join(" -> ")}`)
  }
  if (bad.length) {
    for (const b of bad) console.error("FORBIDDEN " + b)
    console.error(`FAIL ${bad.length} forbidden module(s) reachable from ${ENTRY}`)
    process.exit(1)
  }
  console.log("CLOSURE_OK no forbidden module is reachable")

  if (flag("--no-bundle")) return
  // the real bundle, built with the same table (scripts/build-ai-work-link-exec.ts), so the closure above is checked against what is deployed
  const outArgs = opt("--emit") ? ["--out", opt("--emit")] : ["--check"]
  const r = spawnSync(["bun", "run", "scripts/build-ai-work-link-exec.ts", ...outArgs].join(" "), { cwd: root, encoding: "utf8", shell: true })
  process.stdout.write(r.stdout ?? "")
  if (r.status !== 0) {
    console.error("FAIL the bundle did not build or is over the limit: " + (r.stderr || r.error?.message || "no output").split("\n").slice(0, 8).join(" | "))
    process.exit(1)
  }
  const size = Number(/BUNDLE_OK bytes=(\d+)/.exec(r.stdout ?? "")?.[1] ?? NaN)
  if (!(size < LIMIT_BYTES)) {
    console.error("FAIL no bundle size was reported")
    process.exit(1)
  }
  if (size >= GOAL_BYTES) console.log(`NOTE the bundle is over the ${GOAL_BYTES} byte goal (limit ${LIMIT_BYTES})`)
}

if (process.argv[1] && norm(resolve(process.argv[1])) === norm(fileURLToPath(import.meta.url))) main()
