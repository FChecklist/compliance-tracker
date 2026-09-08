/// <reference types="bun-types" />
// R81 -- THE STANDING GUARD FOR NESTED withTenantContext.
//
// WHAT THIS REPLACES. src/lib/db/tenant-scoped.ts has carried a hand-written
// list of "what is already known to nest" since 2026-09-02. Its own last line
// admits what it is: "This list is a snapshot, not a maintained registry."
// Nothing watched whether any entry on it became reachable. Two unrelated
// commits (754cef17, 19491a5) removed the `if (!item.itemId) continue` guard
// that had kept the submitPurchaseReceipt -> recordStockReceipt entry dormant,
// and it reached production -- PO stuck at draft, received_quantity 0, receipt
// stranded, zero stock ledger rows. A comment cannot fail. This can.
//
// WHAT IT DETECTS. A function that opens a withTenantContext transaction and
// then, from INSIDE that transaction's callback, calls another function which
// opens its own -- directly, or through any number of intermediate hops. The
// pool is `max: 5` for the whole application (tenant-scoped.ts's own
// appRuntimePoolOptions), so one request holding two connections is how it
// exhausts.
//
// WHY THIS IS NOT A LATENCY BUG, AND WHY THE TEST IS A HARD FAILURE.
// assertNotNested() throws ONLY when NODE_ENV is "development" or "test"
// (tenant-scoped.ts). In PRODUCTION it console.warn()s and lets the request
// proceed -- so the loud dev failure is the SAFE manifestation. In production
// these sites silently split one logical operation across two transactions and
// commit half of it if anything fails in between. Every site this file tracks
// is a financial, inventory, CRM or audit path. So this test asserts; it does
// not warn. A warning is exactly what the 2026-09-02 comment already was.
//
// WHY IT IS STATIC AND NOT A RUNTIME TEST. Two reasons, both load-bearing:
//   1. Several of these sites CANNOT fail at runtime even in test.
//      recordOrchestraExecution is fire-and-forget: assertNotNested's throw
//      becomes a rejected promise that its own .catch() swallows, so the audit
//      row is silently skipped in dev/test and written in a second transaction
//      in production. No runtime assertion anywhere can see that.
//   2. Reaching the ERP/CRM sites at runtime needs a live app_runtime
//      connection; the sibling erp-goods-receipt-nested-transaction.test.ts
//      does exactly that and therefore SKIPS in CI, which has only placeholder
//      DB env vars. This file needs no database and always runs.
// The two are complements, not substitutes: that one proves one path really
// breaks against a real database, this one proves no path anywhere has
// regrown.
//
// WHY IT FOLLOWS await import(). Two of the real R81 sites were invisible to a
// static-import grep because the callee arrives via `const { x } = await
// import("...")` -- that is precisely how the hand-written list missed them.
// This resolves dynamic imports as first-class edges (proven by the
// "await import() call sites are followed" fixture below), and when a local
// name is bound more than once -- typically a static import plus a lazy import
// of a DIFFERENT module -- it treats EVERY candidate as reachable rather than
// guessing which one a given call site uses.
//
// WHERE IT CANNOT DECIDE, IT FAILS CLOSED. A call inside a transaction whose
// callee resolves into this repo's own source but whose definition cannot be
// located is reported as UNRESOLVED and fails the test like any other finding.
// A false positive costs someone a minute; a false negative costs a production
// incident. Text/regex analysis, not a TS AST parse -- the same honest,
// reviewable limitation the sibling structural tests here declare
// (src/lib/supabase/org-guard-sweep.test.ts, authz-gap-inventory.test.ts).
import { describe, test, expect } from "bun:test"
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join, dirname, resolve, sep } from "node:path"
import { tmpdir } from "node:os"

// ===========================================================================
// SOURCE PREPARATION
// ===========================================================================

/**
 * Blanks comment bodies AND string/template-literal CONTENT while preserving
 * every byte offset. Both halves matter: tenant-scoped.ts's own known-nesting
 * list NAMES these functions in a comment, and several services embed SQL and
 * prompt text mentioning them in template literals. Without this the guard
 * would report the documentation of the defect as the defect.
 */
export function blankNonCode(src: string): string {
  const out = src.split("")
  const n = src.length
  let i = 0
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out[i] = " "; i++ }
      continue
    }
    if (c === "/" && d === "*") {
      out[i] = " "; out[i + 1] = " "; i += 2
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] !== "\n") out[i] = " "; i++ }
      if (i < n) { out[i] = " "; out[i + 1] = " "; i += 2 }
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c
      i++
      while (i < n) {
        if (src[i] === "\\") { out[i] = " "; if (i + 1 < n) out[i + 1] = " "; i += 2; continue }
        if (src[i] === quote) break
        if (src[i] !== "\n") out[i] = " "
        i++
      }
      i++
      continue
    }
    i++
  }
  return out.join("")
}

/** Blanks comments only. Import specifiers live in strings, so the import
 *  scanner needs a view that keeps string content. */
export function blankComments(src: string): string {
  const out = src.split("")
  const n = src.length
  let i = 0
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") { out[i] = " "; i++ }; continue }
    if (c === "/" && d === "*") {
      out[i] = " "; out[i + 1] = " "; i += 2
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] !== "\n") out[i] = " "; i++ }
      if (i < n) { out[i] = " "; out[i + 1] = " "; i += 2 }
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c
      i++
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue }
        if (src[i] === quote) break
        i++
      }
      i++
      continue
    }
    i++
  }
  return out.join("")
}

/** Index just past the bracket matching the opener at `open`; -1 if unbalanced. */
export function matchBracket(src: string, open: number): number {
  if (!"({[".includes(src[open])) return -1
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === "(" || c === "{" || c === "[") depth++
    else if (c === ")" || c === "}" || c === "]") { depth--; if (depth === 0) return i + 1 }
  }
  return -1
}

/** Splits an argument list body (text between the parens) at depth-0 commas. */
export function splitArgs(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "(" || c === "{" || c === "[") depth++
    else if (c === ")" || c === "}" || c === "]") depth--
    else if (c === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  if (text.slice(start).trim().length > 0) parts.push(text.slice(start))
  return parts
}

/**
 * End of the expression starting at `from`. THIS CODEBASE OMITS SEMICOLONS, so
 * a naive "scan to the next `;`" runs to the end of the enclosing function.
 * That is not merely noisy, it is UNSAFE: an over-long span marked
 * handle-conditional below would hide real nesting -- a false negative, the
 * expensive direction. So this applies the rule the language itself applies: a
 * newline ends the expression unless the next line opens with a token that can
 * only continue one.
 */
export function endOfExpression(src: string, from: number): number {
  let depth = 0
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (c === "(" || c === "{" || c === "[") { depth++; continue }
    if (c === ")" || c === "}" || c === "]") { depth--; if (depth < 0) return i; continue }
    if (depth > 0) continue
    if (c === ";") return i + 1
    if (c === "\n") {
      let j = i + 1
      while (j < src.length && /\s/.test(src[j])) j++
      if (j >= src.length) return src.length
      if (/^(\.|\?\.|\?|:|\)|\]|\}|,|&&|\|\||\+|-|\*|\/|=>|\?\?|==|!=|<|>)/.test(src.slice(j, j + 3))) { i = j - 1; continue }
      return i
    }
  }
  return src.length
}

// ===========================================================================
// MODULE INDEX
// ===========================================================================

export type FuncDef = {
  key: string
  module: string
  name: string
  paramNames: string[]
  /** Params that can carry an ALREADY-OPEN transaction handle. */
  handleParams: string[]
  bodyStart: number
  bodyEnd: number
}

export type ImportBinding = { local: string; exported: string; module: string; dynamic: boolean }

export type ModuleInfo = {
  module: string
  code: string
  codeNoStrings: string
  funcs: Map<string, FuncDef>
  imports: Map<string, ImportBinding[]>
  namespaces: Map<string, string>
  reexports: string[]
}

// Conventional handle names, used ONLY when a parameter carries no type
// annotation. When it has one, `TenantDb` is the real signal.
const HANDLE_NAME_RE = /^(existingDb|db|tx|trx|dbHandle|tdb)$/

function parseParams(paramsText: string): { names: string[]; handles: string[] } {
  const names: string[] = []
  const handles: string[] = []
  for (const raw of splitArgs(paramsText)) {
    const p = raw.trim()
    if (!p) continue
    const m = /^([A-Za-z_$][\w$]*)\s*\??\s*(?::([\s\S]*?))?(?:=[\s\S]*)?$/.exec(p)
    if (!m) continue
    names.push(m[1])
    const type = (m[2] ?? "").trim()
    if (/\bTenantDb\b/.test(type) || (type === "" && HANDLE_NAME_RE.test(m[1]))) handles.push(m[1])
  }
  return { names, handles }
}

export function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkSources(full, out)
    // Test files are excluded on purpose: a test may legitimately construct a
    // nested shape to prove the guard throws (tenant-scoped.test.ts does).
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) out.push(full)
  }
  return out
}

export function indexModule(module: string, raw: string): ModuleInfo {
  const code = blankComments(raw)
  const codeNoStrings = blankNonCode(raw)
  const funcs = new Map<string, FuncDef>()
  const imports = new Map<string, ImportBinding[]>()
  const namespaces = new Map<string, string>()
  const reexports: string[] = []
  const addImport = (b: ImportBinding) => {
    const list = imports.get(b.local)
    if (!list) { imports.set(b.local, [b]); return }
    if (!list.some((x) => x.module === b.module && x.exported === b.exported)) list.push(b)
  }
  const addNamed = (body: string, spec: string, dynamic: boolean, aliasRe: RegExp) => {
    for (const piece of body.split(",")) {
      const t = piece.trim()
      if (!t || t.startsWith("type ")) continue
      const alias = aliasRe.exec(t)
      if (alias) addImport({ local: alias[2], exported: alias[1], module: spec, dynamic })
      else if (/^[A-Za-z_$][\w$]*$/.test(t)) addImport({ local: t, exported: t, module: spec, dynamic })
    }
  }

  // The `[^{}]*` (not `[\s\S]*?`) matters: a lazy any-char class lets the
  // opening brace match some unrelated object literal far above and swallow
  // hundreds of lines of identifiers as if they were import bindings.
  let m: RegExpExecArray | null
  const staticRe = /import\s+(type\s+)?\{([^{}]*)\}\s*from\s*["']([^"']+)["']/g
  while ((m = staticRe.exec(code))) {
    if (m[1]) continue // `import type` carries no runtime behaviour
    addNamed(m[2], m[3], false, /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
  }
  const nsRe = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s*from\s*["']([^"']+)["']/g
  while ((m = nsRe.exec(code))) namespaces.set(m[1], m[2])
  const reexportRe = /export\s+\*\s+from\s*["']([^"']+)["']/g
  while ((m = reexportRe.exec(code))) reexports.push(m[1])

  // THE await import() EDGES. Both real R81 sites that a static-import grep
  // could not see arrive through one of these two shapes.
  const dynNamedRe = /(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*await\s+import\(\s*["']([^"']+)["']\s*\)/g
  while ((m = dynNamedRe.exec(code))) addNamed(m[1], m[2], true, /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/)
  const dynNsRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\(\s*["']([^"']+)["']\s*\)/g
  while ((m = dynNsRe.exec(code))) namespaces.set(m[1], m[2])

  const declRe = /(?:^|[\s;})])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g
  while ((m = declRe.exec(codeNoStrings))) {
    const openParen = codeNoStrings.lastIndexOf("(", m.index + m[0].length - 1)
    const closeParen = matchBracket(codeNoStrings, openParen)
    if (closeParen < 0) continue
    const bodyStart = codeNoStrings.indexOf("{", closeParen - 1)
    if (bodyStart < 0) continue
    const bodyEnd = matchBracket(codeNoStrings, bodyStart)
    if (bodyEnd < 0) continue
    const { names, handles } = parseParams(codeNoStrings.slice(openParen + 1, closeParen - 1))
    funcs.set(m[1], { key: `${module}#${m[1]}`, module, name: m[1], paramNames: names, handleParams: handles, bodyStart, bodyEnd })
  }

  const arrowRe = /(?:^|[\s;})])(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?:async\s*)?(?:<[^>]*>)?\(/g
  while ((m = arrowRe.exec(codeNoStrings))) {
    const openParen = codeNoStrings.lastIndexOf("(", m.index + m[0].length - 1)
    const closeParen = matchBracket(codeNoStrings, openParen)
    if (closeParen < 0) continue
    const arrow = /^\s*(?::[^=>]*)?=>/.exec(codeNoStrings.slice(closeParen))
    if (!arrow) continue
    const afterArrow = closeParen + arrow[0].length
    const { names, handles } = parseParams(codeNoStrings.slice(openParen + 1, closeParen - 1))
    const brace = /^\s*\{/.exec(codeNoStrings.slice(afterArrow))
    let bodyStart: number
    let bodyEnd: number
    if (brace) {
      bodyStart = afterArrow + brace[0].length - 1
      bodyEnd = matchBracket(codeNoStrings, bodyStart)
      if (bodyEnd < 0) continue
    } else {
      bodyStart = afterArrow
      bodyEnd = endOfExpression(codeNoStrings, afterArrow)
    }
    funcs.set(m[1], { key: `${module}#${m[1]}`, module, name: m[1], paramNames: names, handleParams: handles, bodyStart, bodyEnd })
  }

  return { module, code, codeNoStrings, funcs, imports, namespaces, reexports }
}

export type Graph = { mods: Map<string, ModuleInfo>; known: Set<string> }

/** Module keys are relative to the PARENT of `root`, so scanning the real
 *  `src` yields "src/lib/..." and a fixture tree rooted at `<tmp>/src` yields
 *  the same shape -- which is what lets `@/x` resolve identically in both. */
export function buildGraph(root: string): Graph {
  const base = dirname(root)
  const mods = new Map<string, ModuleInfo>()
  for (const file of walkSources(root)) {
    const key = file.slice(base.length + 1).split(sep).join("/")
    mods.set(key, indexModule(key, readFileSync(file, "utf8")))
  }
  return { mods, known: new Set(mods.keys()) }
}

export function resolveSpecifier(fromModule: string, spec: string, known: Set<string>): string | null {
  let base: string
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2)
  else if (spec.startsWith(".")) base = resolve("/" + dirname(fromModule), spec).slice(1).split(sep).join("/")
  else return null // a package, not our source
  for (const cand of [base + ".ts", base + ".tsx", base + "/index.ts", base + "/index.tsx", base]) {
    if (known.has(cand)) return cand
  }
  return null
}

// ===========================================================================
// CALL EXTRACTION AND SYMBOL RESOLUTION
// ===========================================================================

export type CallSite = { callee: string; nameOnly: string; argsText: string; start: number }

const NOT_CALLS = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "await", "function",
  "new", "super", "this", "import", "require", "yield", "void", "delete", "in", "of", "do", "else", "throw",
])

export function callsIn(src: string, from: number, to: number): CallSite[] {
  const out: CallSite[] = []
  const region = src.slice(from, to)
  const re = /(?:([A-Za-z_$][\w$]*)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>\s*)?\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(region))) {
    if (NOT_CALLS.has(m[2])) continue
    // A deeper member chain (a.b.c()) has no bare module binding to resolve.
    if (!m[1] && region.slice(0, m.index).trimEnd().endsWith(".")) continue
    const open = m.index + m[0].length - 1
    const close = matchBracket(region, open)
    if (close < 0) continue
    out.push({
      callee: m[1] ? `${m[1]}.${m[2]}` : m[2],
      nameOnly: m[2],
      argsText: region.slice(open + 1, close - 1),
      start: from + m.index,
    })
  }
  return out
}

export type Resolved =
  | { kind: "func"; mod: ModuleInfo; fn: FuncDef }
  | { kind: "external" }
  | { kind: "unresolved"; detail: string }

/**
 * Every function a call site could reach. A LIST, not one answer: a local name
 * can be bound twice in one file (a static import plus a lazy `await import()`
 * of a different module), and which binding a given call uses is a scoping
 * question text analysis does not answer. Returning all of them makes the
 * caller fail closed -- one candidate opening a transaction is enough.
 */
export function resolveCallee(g: Graph, mod: ModuleInfo, call: CallSite, depth = 0): Resolved[] {
  if (depth > 4) return [{ kind: "external" }]
  const dot = call.callee.indexOf(".")
  if (dot > 0) {
    const spec = mod.namespaces.get(call.callee.slice(0, dot))
    if (!spec) return [{ kind: "external" }]
    const target = resolveSpecifier(mod.module, spec, g.known)
    return target ? [lookupExport(g, target, call.nameOnly, depth)] : [{ kind: "external" }]
  }
  const local = mod.funcs.get(call.callee)
  if (local) return [{ kind: "func", mod, fn: local }]
  const bindings = mod.imports.get(call.callee)
  if (!bindings) return [{ kind: "external" }]
  return bindings.map((imp) => {
    const target = resolveSpecifier(mod.module, imp.module, g.known)
    return target ? lookupExport(g, target, imp.exported, depth) : ({ kind: "external" } as Resolved)
  })
}

export function lookupExport(g: Graph, module: string, name: string, depth: number): Resolved {
  if (depth > 8) return { kind: "external" }
  const mod = g.mods.get(module)
  if (!mod) return { kind: "external" }
  const fn = mod.funcs.get(name)
  if (fn) return { kind: "func", mod, fn }
  const bindings = mod.imports.get(name)
  if (bindings) {
    for (const imp of bindings) {
      const target = resolveSpecifier(module, imp.module, g.known)
      if (!target) return { kind: "external" }
      const r = lookupExport(g, target, imp.exported, depth + 1)
      if (r.kind === "func") return r
    }
    return { kind: "external" }
  }
  for (const spec of mod.reexports) {
    const target = resolveSpecifier(module, spec, g.known)
    // `export * from "<package>"` (db/index.ts re-exports drizzle operators
    // this way): the name is not ours, so it cannot open a transaction.
    if (!target) return { kind: "external" }
    const r = lookupExport(g, target, name, depth + 1)
    if (r.kind === "func") return r
  }
  // Named as a call, resolved into OUR source, definition not found. Reported
  // rather than assumed harmless -- this is the fail-closed branch.
  return { kind: "unresolved", detail: `${module} exports no locatable function named ${name}` }
}

// ===========================================================================
// "DOES THIS FUNCTION OPEN A TRANSACTION?"
// ===========================================================================

export type OpenMode = "standalone" | "threaded"

/**
 * Spans that run on only ONE side of a decision about the handle parameter --
 * `if (existingDb) { ... } else { ... }` and `existingDb ? A : B`. In
 * "threaded" mode (the caller passed its open handle) the standalone side is
 * not reached, so a withTenantContext sitting there does not count.
 *
 * THIS IS THE HALF 6b56c00b GOT WRONG, INVERTED. That commit threaded a handle
 * into recordStockReceipt's BODY and was reported as fixed. It was not: the
 * function opened with `await requireErpEnabled(ctx.orgId)`, which reaches
 * isBranchEnabledForOrg (product-branch-service.ts) and opens its OWN
 * transaction BEFORE the existingDb branch is ever reached -- so a nested
 * caller still tripped assertNotNested, just at a different line. Because an
 * unconditional enablement gate is NOT inside any of these spans, it is still
 * counted in threaded mode, and that shape is still reported. The
 * "an enablement gate ahead of the handle branch is still caught" fixture
 * below pins exactly that.
 */
export function handleConditionalSpans(src: string, fn: FuncDef): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  if (fn.handleParams.length === 0) return spans
  const body = src.slice(fn.bodyStart, fn.bodyEnd)
  const names = fn.handleParams.join("|")
  const mentions = new RegExp(`\\b(?:${names})\\b`)

  const ifRe = /\bif\s*\(/g
  let m: RegExpExecArray | null
  while ((m = ifRe.exec(body))) {
    const open = m.index + m[0].length - 1
    const close = matchBracket(body, open)
    if (close < 0) continue
    if (!mentions.test(body.slice(open + 1, close - 1))) continue
    let i = close
    while (i < body.length && /\s/.test(body[i])) i++
    let end = body[i] === "{" ? matchBracket(body, i) : endOfExpression(body, i)
    if (end < 0) end = body.length
    spans.push([fn.bodyStart + close, fn.bodyStart + end])
    const elseMatch = /^\s*else\b/.exec(body.slice(end))
    if (!elseMatch) continue
    let j = end + elseMatch[0].length
    while (j < body.length && /\s/.test(body[j])) j++
    let end2 = body[j] === "{" ? matchBracket(body, j) : endOfExpression(body, j)
    if (end2 < 0) end2 = body.length
    spans.push([fn.bodyStart + end, fn.bodyStart + end2])
  }

  const ternRe = new RegExp(`\\b(?:${names})\\b\\s*\\?`, "g")
  while ((m = ternRe.exec(body))) spans.push([fn.bodyStart + m.index, fn.bodyStart + endOfExpression(body, m.index)])
  return spans
}

export function inSpans(pos: number, spans: Array<[number, number]>): boolean {
  return spans.some(([a, b]) => pos >= a && pos < b)
}

export function argsMention(argsText: string, names: string[]): boolean {
  if (names.length === 0) return false
  return new RegExp(`\\b(?:${names.join("|")})\\b`).test(argsText)
}

function lineOf(src: string, pos: number): number {
  return src.slice(0, pos).split("\n").length
}

/**
 * Does calling `fn` open a transaction? `mode` says whether the caller handed
 * it an already-open handle. Returns the call path when it does, so the
 * failure message names every hop instead of just the endpoints -- the two-hop
 * paths in this repo (enforcePolicy -> recordOrchestraExecution,
 * dispatchTool -> dispatchGstTool -> listBatches) are unreadable without it.
 */
// Memoised per graph. Without this the sweep re-walks the same deep chains
// once per call site (dispatchTool alone is reached from six places) and the
// run takes over a minute -- slow enough that someone eventually excludes it,
// which is the same as not having it.
const openPathCache = new WeakMap<Graph, Map<string, string[] | null>>()

export function pathToOpen(
  g: Graph, mod: ModuleInfo, fn: FuncDef, mode: OpenMode,
  seen: Set<string> = new Set(), depth = 0,
): string[] | null {
  const key = `${fn.key}|${mode}`
  if (seen.has(key) || depth > 12) return null
  // Only cache top-level queries: a nested result is relative to the `seen`
  // set of the walk that produced it, and caching those would let one walk's
  // cycle-break masquerade as "does not open" for a later, independent walk.
  let cache = openPathCache.get(g)
  if (!cache) { cache = new Map(); openPathCache.set(g, cache) }
  if (depth === 0 && cache.has(key)) return cache.get(key) ?? null
  seen.add(key)
  const src = mod.codeNoStrings
  const skip = mode === "threaded" ? handleConditionalSpans(src, fn) : []
  const calls = callsIn(src, fn.bodyStart, fn.bodyEnd).filter((c) => !inSpans(c.start, skip))

  const done = (result: string[] | null): string[] | null => {
    if (depth === 0) cache!.set(key, result)
    return result
  }

  for (const call of calls) {
    if (call.nameOnly === "withTenantContext") {
      return done([`${mod.module}:${lineOf(src, call.start)} ${fn.name}() opens withTenantContext`])
    }
  }
  for (const call of calls) {
    for (const r of resolveCallee(g, mod, call)) {
      if (r.kind !== "func" || r.fn.key === fn.key) continue
      const passes = r.fn.handleParams.length > 0 && argsMention(call.argsText, fn.handleParams)
      const sub = pathToOpen(g, r.mod, r.fn, passes ? "threaded" : "standalone", seen, depth + 1)
      if (sub) return done([`${mod.module}:${lineOf(src, call.start)} ${fn.name}() -> ${r.fn.name}()${passes ? " [handle passed]" : ""}`, ...sub])
    }
  }
  return done(null)
}

// ===========================================================================
// THE SWEEP
// ===========================================================================

export type Finding = {
  /** Stable identity, independent of line numbers, used by the register. */
  site: string
  file: string
  line: number
  kind: "NESTED" | "NESTED_THROUGH_GATE" | "UNRESOLVED"
  path: string[]
}

type Region = { handle: string; start: number; end: number; owner: string }

/** Every withTenantContext callback body in a module, with the name its open
 *  handle is bound to. */
export function regionsIn(mod: ModuleInfo): Region[] {
  const src = mod.codeNoStrings
  const out: Region[] = []
  const re = /\bwithTenantContext\s*(?:<[^<>]*>\s*)?\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1
    const close = matchBracket(src, open)
    if (close < 0) continue
    const inner = src.slice(open + 1, close - 1)
    const args = splitArgs(inner)
    if (args.length < 2) continue
    const cb = args[1]
    const cbOffset = open + 1 + inner.indexOf(cb)
    const owner = ownerOf(mod, m.index)

    const arrow = /^\s*(?:async\s*)?\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*(?::[^=>]*)?=>/.exec(cb)
    if (arrow) {
      const after = cbOffset + arrow[0].length
      let i = after
      while (i < src.length && /\s/.test(src[i])) i++
      if (src[i] === "{") {
        const end = matchBracket(src, i)
        if (end > 0) out.push({ handle: arrow[1], start: i, end, owner })
      } else {
        out.push({ handle: arrow[1], start: after, end: cbOffset + cb.length, owner })
      }
      continue
    }
    // withTenantContext(ctx, run) -- the callback is a named local function, the
    // shape the threaded fixes in this repo use. Its body IS the region.
    const ident = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(cb)
    if (ident) {
      const fn = mod.funcs.get(ident[1])
      if (fn && fn.paramNames.length > 0) out.push({ handle: fn.paramNames[0], start: fn.bodyStart, end: fn.bodyEnd, owner })
    }
  }
  return out
}

function ownerOf(mod: ModuleInfo, pos: number): string {
  let best: FuncDef | null = null
  for (const fn of mod.funcs.values()) {
    if (pos >= fn.bodyStart && pos < fn.bodyEnd && (!best || fn.bodyStart > best.bodyStart)) best = fn
  }
  return best ? best.name : "(module scope)"
}

export function findNestingSites(g: Graph): Finding[] {
  const out: Finding[] = []
  const seenSites = new Set<string>()
  const push = (f: Finding) => {
    const dedupe = `${f.site}|${f.kind}`
    if (seenSites.has(dedupe)) return
    seenSites.add(dedupe)
    out.push(f)
  }
  for (const mod of [...g.mods.values()].sort((a, b) => a.module.localeCompare(b.module))) {
    const src = mod.codeNoStrings
    for (const region of regionsIn(mod)) {
      for (const call of callsIn(src, region.start, region.end)) {
        const line = lineOf(src, call.start)
        if (call.nameOnly === "withTenantContext") {
          push({
            site: `${mod.module}#${region.owner} -> src/lib/db/tenant-scoped.ts#withTenantContext`,
            file: mod.module, line, kind: "NESTED",
            path: [`${mod.module}:${line} ${region.owner}() opens a second withTenantContext inside its own`],
          })
          continue
        }
        for (const r of resolveCallee(g, mod, call)) {
          if (r.kind === "unresolved") {
            push({
              site: `${mod.module}#${region.owner} -> ?#${call.callee}`,
              file: mod.module, line, kind: "UNRESOLVED",
              path: [`${mod.module}:${line} ${region.owner}() -> ${call.callee}() -- ${r.detail}`],
            })
            continue
          }
          if (r.kind !== "func") continue
          const passes = r.fn.handleParams.length > 0 && argsMention(call.argsText, [region.handle])
          const path = pathToOpen(g, r.mod, r.fn, passes ? "threaded" : "standalone")
          if (!path) continue
          push({
            site: `${mod.module}#${region.owner} -> ${r.mod.module}#${r.fn.name}`,
            file: mod.module, line,
            kind: passes ? "NESTED_THROUGH_GATE" : "NESTED",
            path: [`${mod.module}:${line} ${region.owner}() is inside its own withTenantContext and calls ${r.fn.name}()${passes ? " WITH the open handle" : ""}`, ...path],
          })
        }
      }
    }
  }
  return out
}

// ===========================================================================
// THE REGISTER
// ===========================================================================
//
// READ THIS BEFORE ADDING A LINE. This is NOT an allow-list and nothing on it
// has been verified safe. Every entry is a REAL, currently-open nesting defect
// that this guard found on its first run, on 2026-09-08, AFTER the R81 fix
// pass -- which is the whole point: that pass threaded handles into the DIRECT
// call sites it knew about, and these are the ones that sat one hop further
// out. A hand-written list could not have told anyone that.
//
// The register exists so the guard can be a HARD failure today (anything not
// listed fails immediately) without pretending these are closed. It is
// enforced in BOTH directions:
//   - a nesting site that is not listed fails the sweep test;
//   - a listed site that is no longer detected fails the staleness test, so
//     fixing one is a visible, deliberate diff and the list can never quietly
//     drift out of step with the code the way the tenant-scoped.ts comment did.
//
// To close an entry: thread the caller's open handle into the callee, CHECK
// THE CALLEE'S FIRST STATEMENTS for an enablement gate (requireErpEnabled /
// requireSalesEnabled / any require*Enabled) and give the gate the handle too
// via its *WithDb variant, keeping the 403 wording byte-identical. The
// reference implementation is recordStockReceipt in
// src/lib/services/erp-inventory-service.ts. Then delete the line here.
type OpenSite = { site: string; rootCause: string; reason: string }

const KNOWN_OPEN_NESTING: OpenSite[] = [
  // --- ROOT CAUSE A: recordOrchestraExecution reached one hop indirectly.
  // The R81 pass gave recordOrchestraExecution an `existingDb` parameter and
  // threaded the handle at every DIRECT call site. These reach it through an
  // intermediate function that was not given a handle to pass on. All are AI
  // audit-trail writes (VERIDIAN_AI_CONSTITUTION #19 / SEC-03), and all are
  // fire-and-forget -- so in dev/test assertNotNested's throw lands in the
  // logger's own .catch() and the audit row is SILENTLY NEVER WRITTEN, while
  // in production it is written in a second transaction. No runtime test
  // anywhere can observe either outcome.
  { site: "src/lib/services/crm-service.ts#scoreLead -> src/lib/policy-enforcement-engine.ts#enforcePolicy", rootCause: "A", reason: "Inside scoreLead's own transaction; enforcePolicy -> recordOrchestraExecution opens a second one to log a policy denial." },
  { site: "src/lib/services/crm-service.ts#analyzeOpportunity -> src/lib/policy-enforcement-engine.ts#enforcePolicy", rootCause: "A", reason: "Inside analyzeOpportunity's own transaction; same enforcePolicy -> recordOrchestraExecution denial-logging hop." },
  { site: "src/lib/services/crm-accounts-service.ts#analyzeAccountHealth -> src/lib/policy-enforcement-engine.ts#enforcePolicy", rootCause: "A", reason: "Inside analyzeAccountHealth's own transaction; same enforcePolicy -> recordOrchestraExecution denial-logging hop." },
  { site: "src/lib/services/veri-meeting-service.ts#generateMeetingIntelligence -> src/lib/policy-enforcement-engine.ts#enforcePolicy", rootCause: "A", reason: "Inside generateMeetingIntelligence's own transaction; same enforcePolicy -> recordOrchestraExecution denial-logging hop." },
  { site: "src/lib/task-execution-engine.ts#executePackageDispatch -> src/lib/policy-enforcement-engine.ts#enforcePolicy", rootCause: "A", reason: "Inside executePackageDispatch's own transaction; same enforcePolicy -> recordOrchestraExecution denial-logging hop." },
  { site: "src/app/api/construction/ai/diff-drawings/route.ts#POST -> src/lib/services/construction-ai-service.ts#diffDrawingRevisions", rootCause: "A", reason: "Route opens a transaction to load both drawings, then calls diffDrawingRevisions -> describe() -> recordOrchestraExecution, which opens its own." },
  { site: "src/lib/services/gst-reconciliation-service.ts#generateReviewReport -> src/lib/services/gst-reconciliation-service.ts#generateReviewReportCore", rootCause: "A", reason: "Core takes the open handle but reaches generateAiReviewReport -> recordOrchestraExecution, which is never given it." },

  // --- ROOT CAUSE B: a dispatch table that RECEIVES an open handle and then
  // calls a whole outer service wrapper instead of that wrapper's *Core.
  // gst-tools.ts's own comment claims the list_* branches are "safe from
  // either dispatch path"; that reasoning is about atomicity, and it is
  // exactly the kind of hand-checked claim this guard exists to keep honest --
  // they still open a second connection while the dispatcher holds its own.
  { site: "src/lib/task-execution-engine.ts#executeStructuredDispatch -> src/lib/task-execution-engine.ts#dispatchTool", rootCause: "B", reason: "dispatchTool gets the open handle but its list_gst_* branches call listBatches/listReturns, which open their own transaction." },
  { site: "src/lib/task-execution-engine.ts#executeTask -> src/lib/task-execution-engine.ts#dispatchTool", rootCause: "B", reason: "Same dispatchTool -> dispatchGstTool -> listBatches/listReturns hop, from executeTask's own transaction." },
  { site: "src/app/api/v1/projexa/assistant/route.ts#POST -> src/lib/task-execution-engine.ts#dispatchTool", rootCause: "B", reason: "Same dispatchTool -> dispatchGstTool -> listBatches/listReturns hop, from the PROJEXA assistant route's own transaction." },
  { site: "src/lib/pipeline/executor.ts#makeDispatchExecutor -> src/lib/task-execution-engine.ts#dispatchTool", rootCause: "B", reason: "Same dispatchTool -> dispatchGstTool -> listBatches/listReturns hop, from the pipeline dispatch executor's own transaction." },
  { site: "src/lib/pipeline/executor.ts#makeOrgScopedExecutor -> src/lib/task-execution-engine.ts#dispatchTool", rootCause: "B", reason: "Same dispatchTool -> dispatchGstTool -> listBatches/listReturns hop, from the org-scoped executor's own transaction." },
  { site: "src/lib/services/fde-service.ts#respondToResolvedCapability -> src/lib/task-execution-engine.ts#dispatchTool", rootCause: "B", reason: "Same dispatchTool -> dispatchGstTool -> listBatches/listReturns hop, from respondToResolvedCapability's own transaction." },
  { site: "src/lib/task-execution-engine.ts#executeEngineDispatch -> src/lib/task-execution-engine.ts#dispatchEngine", rootCause: "B", reason: "dispatchEngine gets the open handle but dispatchCrmEngine calls createLead, the outer CRM wrapper, which opens its own." },

  // --- ROOT CAUSE C: a local helper that opens its own transaction, awaited
  // from inside one. The simplest shape, and the closest analogue of the
  // erp-goods-receipt entry that actually reached production.
  { site: "src/lib/services/veri-chat-service.ts#attachDocumentToMessage -> src/lib/services/veri-chat-service.ts#assertParticipant", rootCause: "C", reason: "assertParticipant opens its own transaction and is awaited inside attachDocumentToMessage's, so the membership check and the attachment insert are not one unit." },
  { site: "src/lib/services/veri-chat-service.ts#revokeShareLink -> src/lib/services/veri-chat-service.ts#assertParticipant", rootCause: "C", reason: "Same assertParticipant hop, awaited from inside revokeShareLink's own transaction." },
  { site: "src/lib/services/veri-chat-service.ts#revokeGuestAccess -> src/lib/services/veri-chat-service.ts#assertParticipant", rootCause: "C", reason: "Same assertParticipant hop, awaited from inside revokeGuestAccess's own transaction." },
  { site: "src/lib/services/mca-filing-service.ts#generateFormData -> src/lib/services/mca-filing-service.ts#loadCompanyParticulars", rootCause: "C", reason: "loadCompanyParticulars opens its own transaction and is awaited inside generateFormData's; no enablement gate, so threading the handle would be the whole fix." },
  { site: "src/lib/services/fm-asset-dedup-service.ts#findDuplicateCandidates -> src/lib/services/fm-asset-dedup-service.ts#scanForDuplicateAssets", rootCause: "C", reason: "scanForDuplicateAssets opens its own transaction and is awaited inside findDuplicateCandidates'; its own first statement is that withTenantContext, so there is no enablement gate to thread as well." },
]

const SRC_ROOT = join(import.meta.dir, "..", "..")

function render(f: Finding): string {
  return [`  [${f.kind}] ${f.file}:${f.line}`, `    site: ${f.site}`, ...f.path.map((p, i) => `      ${"  ".repeat(i)}${p}`)].join("\n")
}

describe("withTenantContext nesting -- standing guard", () => {
  const g = buildGraph(SRC_ROOT)
  const findings = findNestingSites(g)
  const registered = new Set(KNOWN_OPEN_NESTING.map((e) => e.site))

  test("the sweep actually reads this repo (a guard that scans nothing passes everything)", () => {
    expect(g.mods.size).toBeGreaterThan(1500)
    const tenantScoped = g.mods.get("src/lib/db/tenant-scoped.ts")
    expect(tenantScoped).toBeDefined()
    expect(tenantScoped!.funcs.has("withTenantContext")).toBe(true)
    // Several hundred real transaction bodies, or the region finder has
    // silently stopped matching the shapes this codebase actually writes.
    const regions = [...g.mods.values()].reduce((n, m) => n + regionsIn(m).length, 0)
    expect(regions).toBeGreaterThan(500)
  })

  test("no UNREGISTERED function opens a second withTenantContext inside an open one", () => {
    const untracked = findings.filter((f) => !registered.has(f.site))
    if (untracked.length > 0) {
      throw new Error(
        `${untracked.length} nested-withTenantContext site(s) found that are not in KNOWN_OPEN_NESTING.\n\n` +
          `Each of these holds two of the five app_runtime connections for one request, and in PRODUCTION\n` +
          `assertNotNested only warns -- so the operation silently splits across two transactions and commits\n` +
          `half of itself if anything fails in between (src/lib/db/tenant-scoped.ts).\n\n` +
          untracked.map(render).join("\n\n") +
          `\n\nFix it by threading the caller's open db handle into the callee. CHECK THE CALLEE'S FIRST\n` +
          `STATEMENTS: if it calls an enablement gate (requireErpEnabled / requireSalesEnabled / any\n` +
          `require*Enabled), threading into the body is NOT enough -- the gate opens its own transaction\n` +
          `before the handle branch is ever reached. Use the gate's *WithDb variant and keep the 403 wording\n` +
          `byte-identical. Reference: recordStockReceipt in src/lib/services/erp-inventory-service.ts.\n`,
      )
    }
    expect(untracked).toEqual([])
  })

  test("every KNOWN_OPEN_NESTING entry still names a real, still-detected site", () => {
    const found = new Set(findings.map((f) => f.site))
    const stale = KNOWN_OPEN_NESTING.filter((e) => !found.has(e.site))
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} KNOWN_OPEN_NESTING entr(ies) no longer correspond to a detected site.\n` +
          `If you fixed them, delete the lines -- the register must never drift out of step with the code,\n` +
          `which is the exact failure mode of the hand-written list this guard replaced.\n\n` +
          stale.map((e) => `  ${e.site}\n    reason on file: ${e.reason}`).join("\n"),
      )
    }
    expect(stale).toEqual([])
  })

  test("every KNOWN_OPEN_NESTING entry carries a reason and a root cause", () => {
    for (const e of KNOWN_OPEN_NESTING) {
      expect(e.reason.trim().length).toBeGreaterThan(30)
      expect(["A", "B", "C"]).toContain(e.rootCause)
    }
    expect(new Set(KNOWN_OPEN_NESTING.map((e) => e.site)).size).toBe(KNOWN_OPEN_NESTING.length)
  })
})

// ===========================================================================
// THE DETECTOR'S OWN PROOFS
// ===========================================================================
//
// A drift guard that cannot be shown to fail is indistinguishable from one
// that always passes. These run the identical analysis over a synthetic tree
// on disk, so both directions are proven without editing the real repo.
describe("the detector itself", () => {
  function analyze(files: Record<string, string>): Finding[] {
    const dir = mkdtempSync(join(tmpdir(), "nesting-guard-"))
    try {
      for (const [rel, body] of Object.entries(files)) {
        const full = join(dir, "src", ...rel.split("/"))
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, body, "utf8")
      }
      return findNestingSites(buildGraph(join(dir, "src")))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const TENANT_SCOPED = `
export type TenantDb = unknown
export async function withTenantContext<T>(ctx: { orgId: string }, fn: (db: TenantDb) => Promise<T>): Promise<T> {
  return fn(null as TenantDb)
}
`

  test("a planted nesting is caught", () => {
    const findings = analyze({
      "lib/db/tenant-scoped.ts": TENANT_SCOPED,
      "lib/inner.ts": `
import { withTenantContext } from "@/lib/db/tenant-scoped"
export async function readThing(orgId: string) {
  return withTenantContext({ orgId }, async (db) => db)
}
`,
      "lib/outer.ts": `
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { readThing } from "@/lib/inner"
export async function doWork(orgId: string) {
  return withTenantContext({ orgId }, async (db) => {
    const thing = await readThing(orgId)
    return thing
  })
}
`,
    })
    expect(findings.map((f) => f.site)).toContain("src/lib/outer.ts#doWork -> src/lib/inner.ts#readThing")
  })

  test("the same call is NOT reported once the open handle is threaded", () => {
    const findings = analyze({
      "lib/db/tenant-scoped.ts": TENANT_SCOPED,
      "lib/inner.ts": `
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
export async function readThing(orgId: string, existingDb?: TenantDb) {
  const run = async (db: TenantDb) => db
  return existingDb ? run(existingDb) : withTenantContext({ orgId }, run)
}
`,
      "lib/outer.ts": `
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { readThing } from "@/lib/inner"
export async function doWork(orgId: string) {
  return withTenantContext({ orgId }, async (db) => {
    const thing = await readThing(orgId, db)
    return thing
  })
}
`,
    })
    expect(findings).toEqual([])
  })

  // THE 6b56c00b SHAPE. The handle is threaded into the body and the fix looks
  // right, but an unconditional enablement gate ahead of the branch opens its
  // own transaction first. This is the failure that shipped as "fixed".
  test("an enablement gate ahead of the handle branch is still caught", () => {
    const findings = analyze({
      "lib/db/tenant-scoped.ts": TENANT_SCOPED,
      "lib/gate.ts": `
import { withTenantContext } from "@/lib/db/tenant-scoped"
export async function isEnabledForOrg(orgId: string) {
  return withTenantContext({ orgId }, async (db) => true)
}
export async function requireErpEnabled(orgId: string) {
  if (!(await isEnabledForOrg(orgId))) throw new Error("403")
}
`,
      "lib/inner.ts": `
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { requireErpEnabled } from "@/lib/gate"
export async function recordThing(orgId: string, existingDb?: TenantDb) {
  await requireErpEnabled(orgId)
  const run = async (db: TenantDb) => db
  return existingDb ? run(existingDb) : withTenantContext({ orgId }, run)
}
`,
      "lib/outer.ts": `
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { recordThing } from "@/lib/inner"
export async function submit(orgId: string) {
  return withTenantContext({ orgId }, async (db) => {
    return recordThing(orgId, db)
  })
}
`,
    })
    const hit = findings.find((f) => f.site === "src/lib/outer.ts#submit -> src/lib/inner.ts#recordThing")
    expect(hit).toBeDefined()
    // Reported as the gate variant, and the path names the gate -- the point
    // being that "I threaded the handle" is visibly not the same as "fixed".
    expect(hit!.kind).toBe("NESTED_THROUGH_GATE")
    expect(hit!.path.join("\n")).toContain("requireErpEnabled")
  })

  test("await import() call sites are followed", () => {
    const findings = analyze({
      "lib/db/tenant-scoped.ts": TENANT_SCOPED,
      "lib/inner.ts": `
import { withTenantContext } from "@/lib/db/tenant-scoped"
export async function listBatches(ctx: { orgId: string }) {
  return withTenantContext(ctx, async (db) => db)
}
`,
      "lib/outer.ts": `
import { withTenantContext } from "@/lib/db/tenant-scoped"
export async function dispatch(orgId: string) {
  return withTenantContext({ orgId }, async (db) => {
    const { listBatches } = await import("@/lib/inner")
    return listBatches({ orgId })
  })
}
`,
    })
    expect(findings.map((f) => f.site)).toContain("src/lib/outer.ts#dispatch -> src/lib/inner.ts#listBatches")
  })

  test("a sequential call OUTSIDE the transaction is not reported", () => {
    // getReorderSuggestions/getItemValuation is the real instance of this: a
    // handle threaded there is a type error, and was reverted once already.
    const findings = analyze({
      "lib/db/tenant-scoped.ts": TENANT_SCOPED,
      "lib/inner.ts": `
import { withTenantContext } from "@/lib/db/tenant-scoped"
export async function getItemValuation(orgId: string) {
  return withTenantContext({ orgId }, async (db) => db)
}
`,
      "lib/outer.ts": `
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { getItemValuation } from "@/lib/inner"
export async function getReorderSuggestions(orgId: string) {
  const rows = await withTenantContext({ orgId }, async (db) => [1, 2, 3])
  const valuation = await getItemValuation(orgId)
  return { rows, valuation }
}
`,
    })
    expect(findings).toEqual([])
  })

  test("a call into this repo whose definition cannot be found fails CLOSED", () => {
    const findings = analyze({
      "lib/db/tenant-scoped.ts": TENANT_SCOPED,
      "lib/inner.ts": `export const notAFunctionDeclaration = someFactory()\n`,
      "lib/outer.ts": `
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { notAFunctionDeclaration } from "@/lib/inner"
export async function doWork(orgId: string) {
  return withTenantContext({ orgId }, async (db) => notAFunctionDeclaration(db))
}
`,
    })
    expect(findings.map((f) => f.kind)).toContain("UNRESOLVED")
  })

  test("a nesting site named only in a comment or a string is NOT reported", () => {
    const findings = analyze({
      "lib/db/tenant-scoped.ts": TENANT_SCOPED,
      "lib/inner.ts": `
import { withTenantContext } from "@/lib/db/tenant-scoped"
export async function readThing(orgId: string) {
  return withTenantContext({ orgId }, async (db) => db)
}
`,
      "lib/outer.ts": `
import { withTenantContext } from "@/lib/db/tenant-scoped"
export async function doWork(orgId: string) {
  // known to nest: doWork -> readThing(orgId)
  const note = "doWork calls readThing(orgId) inside its transaction"
  return withTenantContext({ orgId }, async (db) => note)
}
`,
    })
    expect(findings).toEqual([])
  })
})
