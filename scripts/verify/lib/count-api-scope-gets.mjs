// PROJEXA-BUILD-001 U-33 (BR-419). Counts the GET requests a TypeScript source file sends to /api/scope, for
// scripts/verify/projexa-boq-read-targets.sh. It reads the file as text: comments are ignored, text inside a string is never mistaken for a
// call, and a call is any `fetch(...)` or `fetchJson(...)` (a generic `fetchJson<T>(...)` too) whose first argument is a string or template
// literal that starts with /api/scope. The request is a GET when its options hold no `method` key or `method: "GET"`. A `method` that is
// not a plain string literal (a variable, or the shorthand `{ method }`) is counted as `dynamic` and not as a GET, because its value
// cannot be read from the text; the shell script reports the total so a reader sees it.
//
// Known limit: a regular expression literal that holds a quote character or two slashes in a row would confuse the comment and string
// scanner. Neither component this is run on has one, and the self-test (projexa-boq-read-targets.selftest.sh) pins the shapes it reads.
//
// CLI: node count-api-scope-gets.mjs <file>...   prints one `<file> gets=<n> scope_calls=<n> calls=<n> dynamic=<n>` line per file and a
// final `TOTAL gets=<n> scope_calls=<n> calls=<n> dynamic=<n>` line.
import { readFileSync } from "node:fs"

const MASK = "\u0001"

/** Splits source into `code` (comments blanked, strings kept) and `mask` (same length, string and template text replaced by MASK). */
export function scan(source) {
  const n = source.length
  const code = source.split("")
  const mask = source.split("")
  // states: "n" normal, "l" line comment, "b" block comment, "s" single-quote string, "d" double-quote string, "t" template text
  const stack = [] // for `${` inside a template: brace depth to return to
  let state = "n"
  let braceDepth = 0
  let i = 0
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (code[k] !== "\n") { code[k] = " "; mask[k] = " " }
  }
  while (i < n) {
    const c = source[i]
    const d = source[i + 1]
    if (state === "n") {
      if (c === "/" && d === "/") { const s = i; while (i < n && source[i] !== "\n") i++; blank(s, i); continue }
      if (c === "/" && d === "*") { const s = i; i += 2; while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++; i = Math.min(n, i + 2); blank(s, i); continue }
      if (c === "'") { state = "s"; i++; continue }
      if (c === '"') { state = "d"; i++; continue }
      if (c === "`") { state = "t"; i++; continue }
      if (c === "{") { braceDepth++; i++; continue }
      if (c === "}") {
        if (stack.length > 0 && braceDepth === stack[stack.length - 1]) { stack.pop(); braceDepth--; mask[i] = MASK; state = "t"; i++; continue }
        braceDepth--; i++; continue
      }
      i++
      continue
    }
    if (state === "s" || state === "d") {
      const quote = state === "s" ? "'" : '"'
      if (c === "\\") { mask[i] = MASK; if (i + 1 < n) mask[i + 1] = MASK; i += 2; continue }
      if (c === quote || c === "\n") { state = "n"; i++; continue }
      mask[i] = MASK
      i++
      continue
    }
    // template text
    if (c === "\\") { mask[i] = MASK; if (i + 1 < n) mask[i + 1] = MASK; i += 2; continue }
    if (c === "`") { state = "n"; i++; continue }
    if (c === "$" && d === "{") { braceDepth++; stack.push(braceDepth); mask[i] = MASK; mask[i + 1] = MASK; state = "n"; i += 2; continue }
    mask[i] = MASK
    i++
  }
  return { code: code.join(""), mask: mask.join("") }
}

function skipSpaces(text, i) {
  while (i < text.length && /\s/.test(text[i])) i++
  return i
}

/** Index just past the `>` that closes the `<` at `i`, or -1. `=>` inside a type does not close it. */
function skipAngles(mask, i) {
  let depth = 0
  // A type argument list is short. The cap keeps a stray `fetch < x` from being read to the end of the file.
  for (let k = i; k < mask.length && k < i + 2000; k++) {
    const c = mask[k]
    if (c === "<") depth++
    else if (c === ">" && mask[k - 1] !== "=") { depth--; if (depth === 0) return k + 1 }
  }
  return -1
}

/** Index of the `)` that closes the `(` at `open`, or -1. */
function matchParen(mask, open) {
  let depth = 0
  for (let k = open; k < mask.length; k++) {
    const c = mask[k]
    if (c === "(") depth++
    else if (c === ")") { depth--; if (depth === 0) return k }
  }
  return -1
}

/** Splits the text between a call's parentheses at its top-level commas, using `mask` to decide what is top level. */
function splitArgs(code, mask, from, to) {
  const parts = []
  let depth = 0
  let start = from
  for (let k = from; k < to; k++) {
    const c = mask[k]
    if (c === "(" || c === "[" || c === "{") depth++
    else if (c === ")" || c === "]" || c === "}") depth--
    else if (c === "," && depth === 0) { parts.push(code.slice(start, k)); start = k + 1 }
  }
  parts.push(code.slice(start, to))
  return parts
}

export function countApiScopeGets(source) {
  const { code, mask } = scan(source)
  const result = { calls: 0, scopeCalls: 0, gets: 0, dynamic: 0 }
  const callee = /(?<![\w$.])(fetchJson|fetch)\b/g
  let m
  while ((m = callee.exec(mask)) !== null) {
    let k = skipSpaces(mask, m.index + m[0].length)
    if (mask[k] === "<") {
      k = skipAngles(mask, k)
      if (k < 0) continue
      k = skipSpaces(mask, k)
    }
    if (mask[k] !== "(") continue
    const close = matchParen(mask, k)
    if (close < 0) continue
    result.calls += 1
    const args = splitArgs(code, mask, k + 1, close)
    const first = (args[0] ?? "").trim()
    if (!/^["'`]\/api\/scope/.test(first)) continue
    result.scopeCalls += 1
    const rest = args.slice(1).join(",")
    const literal = /\bmethod\s*:\s*(["'`])([A-Za-z]+)\1/.exec(rest)
    if (literal) {
      if (literal[2].toUpperCase() === "GET") result.gets += 1
    } else if (/\bmethod\b/.test(rest)) {
      result.dynamic += 1
    } else {
      result.gets += 1
    }
  }
  return result
}

if (process.argv[1]?.endsWith("count-api-scope-gets.mjs")) {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error("usage: node count-api-scope-gets.mjs <file>...")
    process.exit(2)
  }
  const total = { gets: 0, scopeCalls: 0, calls: 0, dynamic: 0 }
  for (const file of files) {
    const r = countApiScopeGets(readFileSync(file, "utf8"))
    console.log(`${file} gets=${r.gets} scope_calls=${r.scopeCalls} calls=${r.calls} dynamic=${r.dynamic}`)
    for (const key of Object.keys(total)) total[key] += r[key]
  }
  console.log(`TOTAL gets=${total.gets} scope_calls=${total.scopeCalls} calls=${total.calls} dynamic=${total.dynamic}`)
}
