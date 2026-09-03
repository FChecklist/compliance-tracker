/// <reference types="bun-types" />
// R68 (Institutional Memory Graph) Phase 6 -- THE BARE-CLIENT REGRESSION GUARD.
//
// THE RULE, from R-IMG-07 (platform.crr_ruling, binding):
//
//   "THE REAL WRITE-PATH RISK IS NOT E-45, IT IS RLS ... Any IMG write path
//    must run inside withTenantContext() (or the platform-sentinel
//    equivalent), never on a bare client."
//
// WHY A TEST AND NOT A LINT RULE. The brief's own preference is a custom
// ESLint rule. This repo has no mechanism for one: eslint.config.mjs is a
// flat config composed entirely of published plugins (eslint-config-next,
// eslint-plugin-jsx-a11y) with no `plugins: { local: ... }` entry, no
// eslint-plugin-local-rules dependency in package.json, and no
// eslint-rules/ or tools/eslint/ directory anywhere in the tree -- all four
// checked on this branch before choosing. Adding a whole custom-rule
// mechanism to gate three tables would be a larger and less reviewable
// change than the fallback the brief itself sanctions: a static-analysis
// test in this repo's own already-established shape. The direct precedent is
// src/lib/supabase/org-guard-sweep.test.ts (E-52), which walks the real
// source tree, regex-detects a forbidden shape, and proves both directions
// against synthetic fixtures -- this file follows it deliberately, down to
// the honest limitation that it is textual detection and not a TS AST parse.
//
// WHAT COUNTS AS A VIOLATION. A write (INSERT / UPDATE / DELETE) against
// compliance.memory_records, compliance.memory_versions or
// compliance.memory_sources, issued through the bypass-RLS `db` client
// exported from "@/lib/db" -- i.e. the `postgres` table-owner role, which
// bypasses RLS AND is exempted from drizzle/0541's append-only trigger by
// that trigger's own `current_user <> 'app_runtime'` early return. Such a
// write is invisible to both of this table's real protections at once, which
// is precisely why it must never appear by accident.
//
// WHAT IS DELIBERATELY NOT A VIOLATION, and how the scanner tells:
//
//   - `tx.execute(...)`, where `tx: TenantDb` is the caller's open
//     withTenantContext transaction. This is the sanctioned path and is what
//     every write in memory-service.ts uses.
//   - A withTenantContext callback whose parameter is NAMED `db` -- e.g.
//     `withTenantContext(ctx, async (db) => { ... })` in chat-service.ts and
//     run-submission.ts. That `db` shadows the module import and IS a tenant
//     transaction. Flagging it would be a false positive on the two real
//     call sites this phase depends on, so the scanner walks outward from
//     each candidate call looking for an enclosing function whose parameter
//     list binds `db`, and treats that as shadowed.
//   - The ONE genuine, documented exception:
//     redactMemoryRecordLineage(), which must use the bypass client because
//     drizzle/0541's append-only trigger blocks app_runtime from ever
//     rewriting content/content_hash (exactly the columns a right-to-erasure
//     redaction has to rewrite) and because memory_versions grants
//     app_runtime no UPDATE at all. That exception is enumerated below by
//     file AND function name, and the test asserts the allow-list is exactly
//     that one entry -- so a second exception cannot be added by editing a
//     regex or by naming a new function something plausible; it takes a
//     deliberate, reviewable edit to this file.
import { describe, test, expect } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SRC_ROOT = join(import.meta.dir, "..", "..")

/** The three tables this guard protects. */
export const GUARDED_MEMORY_TABLES = ["memory_records", "memory_versions", "memory_sources"] as const

/**
 * The complete list of sanctioned bypass-client writes to those tables.
 * Deliberately keyed by function name as well as file: "somewhere in
 * memory-service.ts" would be a hole big enough to drive the whole write
 * path through.
 */
export const BYPASS_CLIENT_ALLOWLIST: readonly { file: string; functionName: string; why: string }[] = [
  {
    file: "lib/services/memory-service.ts",
    functionName: "redactMemoryRecordLineage",
    why:
      "Right-to-erasure redaction (R68 Phase 1 item 5 / R-IMG-05). Must rewrite content + content_hash on already-existing rows, which drizzle/0541's append-only trigger blocks for app_runtime, and must UPDATE memory_versions, on which app_runtime holds no UPDATE grant at all. Carries its own expectedOrgId defence-in-depth check in place of the RLS it cannot use.",
  },
]

const WRITE_TO_GUARDED_TABLE_RE = new RegExp(
  String.raw`(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+compliance\.(?:${GUARDED_MEMORY_TABLES.join("|")})\b`,
  "i"
)

/** Drizzle query-builder equivalents (`db.insert(memoryRecords)` etc.) --
 * the same defect wearing the ORM's clothes. schema.ts exports these three
 * tables under exactly these names. */
const DRIZZLE_WRITE_RE = /\b(?:insert|update|delete)\(\s*(memoryRecords|memoryVersions|memorySources)\b/

export type BareClientViolation = { file: string; line: number; functionName: string; snippet: string }

/** Balanced-paren capture of the call starting at `openParenIdx` (the index
 * of the `(` immediately after the callee). Same technique, and the same
 * honest limitation, as org-guard-sweep.test.ts's captureCall(). */
function captureCall(source: string, openParenIdx: number): string {
  let depth = 0
  for (let i = openParenIdx; i < source.length; i++) {
    const ch = source[i]
    if (ch === "(") depth++
    else if (ch === ")") {
      depth--
      if (depth === 0) return source.slice(openParenIdx, i + 1)
    }
  }
  return source.slice(openParenIdx)
}

/** Name of the nearest function declaration/expression enclosing `index`,
 * or "(top level)". Used both to attribute a violation and to key the
 * allow-list. */
function enclosingFunctionName(source: string, index: number): string {
  const before = source.slice(0, index)
  // Two real declaration forms only. The arrow/function-expression branch
  // deliberately requires a `=>` or the `function` keyword AFTER the
  // parameter list: without that, `const updatedRecords = (await
  // db.execute(...))` -- a plain parenthesised expression -- reads as a
  // function declaration and mis-attributes the violation to a local
  // variable name, which is exactly what the allow-list must not be keyed on.
  const re =
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^()]*\)\s*(?::[^=]*?)?=>)/g
  let name = "(top level)"
  let m: RegExpExecArray | null
  while ((m = re.exec(before))) name = m[1] ?? m[2] ?? name
  return name
}

/**
 * End index (exclusive) of the body of the callback whose parameter list
 * starts at `bindingEnd` -- i.e. how far the `db` it binds is actually in
 * scope. Two real shapes, both used in this repo:
 *
 *   withTenantContext(ctx, async (db) => { ... })   // block body
 *   withTenantContext(ctx, (db) => db.insert(...))  // concise body
 *
 * Returns -1 when neither shape is recognised.
 */
function callbackBodyEnd(source: string, bindingEnd: number): number {
  let i = bindingEnd
  while (i < source.length && /\s/.test(source[i])) i++
  if (source.startsWith("=>", i)) {
    i += 2
    while (i < source.length && /\s/.test(source[i])) i++
  }

  if (source[i] === "{") {
    let depth = 0
    for (let j = i; j < source.length; j++) {
      if (source[j] === "{") depth++
      else if (source[j] === "}") {
        depth--
        if (depth === 0) return j
      }
    }
    return source.length
  }

  // Concise body: runs to the `)` that closes the call the arrow was passed to.
  let parens = 0
  for (let j = i; j < source.length; j++) {
    const ch = source[j]
    if (ch === "(") parens++
    else if (ch === ")") {
      if (parens === 0) return j
      parens--
    }
  }
  return source.length
}

/**
 * True when `db` at `index` is bound by an ENCLOSING callback parameter --
 * i.e. it is a withTenantContext transaction handle, the sanctioned path --
 * rather than by the module-level `import { db } from "@/lib/db"`.
 *
 * "Enclosing" is the load-bearing word, and getting it wrong is how this
 * guard silently stops guarding: chat-service.ts and run-submission.ts each
 * contain a dozen `async (db) => { ... }` callbacks, so a naive "is there any
 * `(db)` binding earlier in this file" test marks EVERY later bare-client
 * write in those files as shadowed -- which is exactly what the mutation
 * proof in this PR's description caught on the first attempt. So each
 * candidate binding's real body extent is computed (callbackBodyEnd above)
 * and the binding only counts if `index` actually falls inside it.
 */
function dbIsShadowedByCallbackParam(source: string, index: number): boolean {
  // A parameter list binding `db`, in either arrow or function-expression
  // form. Deliberately anchored on `(` ... `db` ... `)` followed by `=>` or
  // `{`, so an ordinary CALL such as `helper(db)` is not mistaken for a
  // binding.
  const paramRe = /\(\s*db\s*(?::[^),]*)?\s*(?:,[^)]*)?\)\s*(?::[^=({]*)?(?==>|\{)/g
  let m: RegExpExecArray | null
  while ((m = paramRe.exec(source))) {
    if (m.index >= index) break
    if (index < callbackBodyEnd(source, m.index + m[0].length)) return true
  }
  return false
}

/**
 * Core pure scanner: finds bypass-client writes to the guarded tables in one
 * file's source text. Exported so the synthetic-fixture tests below can
 * prove both directions against the exact same logic the real tree scan uses.
 */
export function findBareClientMemoryWrites(filePath: string, source: string): BareClientViolation[] {
  const violations: BareClientViolation[] = []
  if (!/\bdb\s*\./.test(source)) return violations

  const callRe = /\bdb\s*\.\s*(execute|insert|update|delete)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(source))) {
    const matchStart = m.index

    // Skip a commented-out occurrence (same honest limitation as the E-52
    // sweep: textual, not AST).
    const lineStart = source.lastIndexOf("\n", matchStart) + 1
    const linePrefix = source.slice(lineStart, matchStart).trim()
    if (linePrefix.startsWith("//") || linePrefix.startsWith("*")) continue

    const openParenIdx = matchStart + m[0].length - 1
    // Includes the `db.insert` / `db.execute` head as well as the argument
    // list, so the drizzle form (`db.insert(memoryRecords)`) -- whose table
    // name is the argument but whose VERB is in the head -- is matchable by
    // one regex alongside the raw-SQL form.
    const call = source.slice(matchStart, openParenIdx) + captureCall(source, openParenIdx)
    if (!WRITE_TO_GUARDED_TABLE_RE.test(call) && !DRIZZLE_WRITE_RE.test(call)) continue

    // A `db` bound by an enclosing callback parameter IS a tenant tx.
    if (dbIsShadowedByCallbackParam(source, matchStart)) continue

    const line = source.slice(0, matchStart).split("\n").length
    violations.push({
      file: filePath,
      line,
      functionName: enclosingFunctionName(source, matchStart),
      snippet: source.slice(matchStart, Math.min(matchStart + 160, source.length)).replace(/\s+/g, " ").trim(),
    })
  }
  return violations
}

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full))
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full)
  }
  return out
}

function toRepoPath(absolute: string): string {
  return relative(SRC_ROOT, absolute).split(sep).join("/")
}

function isAllowlisted(v: BareClientViolation): boolean {
  return BYPASS_CLIENT_ALLOWLIST.some((a) => a.file === v.file && a.functionName === v.functionName)
}

describe("R68 Phase 6: no bare (non-withTenantContext) client may write to the memory tables", () => {
  test("the real src/ tree contains no un-allowlisted bypass-client write to memory_records / memory_versions / memory_sources", () => {
    const offenders: BareClientViolation[] = []
    for (const abs of listTsFiles(SRC_ROOT)) {
      // The guard must not flag its own documentation of the forbidden shape.
      if (abs.endsWith("memory-write-path-guard.test.ts")) continue
      const found = findBareClientMemoryWrites(toRepoPath(abs), readFileSync(abs, "utf8"))
      for (const v of found) if (!isAllowlisted(v)) offenders.push(v)
    }
    expect(
      offenders.map((v) => `${v.file}:${v.line} in ${v.functionName}() -- ${v.snippet}`)
    ).toEqual([])
  })

  test("the allow-list is exactly the one documented erasure exception", () => {
    // Pinned so a second bypass write cannot be legitimised by quietly
    // appending to the list -- adding one has to change this assertion too,
    // which is what puts it in front of a reviewer.
    expect(BYPASS_CLIENT_ALLOWLIST.map((a) => `${a.file}#${a.functionName}`)).toEqual([
      "lib/services/memory-service.ts#redactMemoryRecordLineage",
    ])
    for (const entry of BYPASS_CLIENT_ALLOWLIST) {
      expect(entry.why.length).toBeGreaterThan(80) // a real justification, not a TODO
    }
  })

  test("the allow-listed exception is still really there (the list cannot rot into fiction)", () => {
    const source = readFileSync(join(SRC_ROOT, "lib", "services", "memory-service.ts"), "utf8")
    const found = findBareClientMemoryWrites("lib/services/memory-service.ts", source)
    expect(found.length).toBeGreaterThan(0)
    for (const v of found) expect(v.functionName).toBe("redactMemoryRecordLineage")
  })

  // ── Both directions, against synthetic fixtures, so the scanner itself is
  // tested and not merely trusted (org-guard-sweep.test.ts's own discipline). ──

  test("CATCHES a bare-client INSERT into memory_records", () => {
    const bad = `
      import { db } from "@/lib/db"
      export async function rememberSomething(orgId: string) {
        await db.execute(sql\`
          INSERT INTO compliance.memory_records (id, org_id, content) VALUES ('x', \${orgId}, 'y')
        \`)
      }
    `
    const found = findBareClientMemoryWrites("lib/services/fake.ts", bad)
    expect(found.length).toBe(1)
    expect(found[0].functionName).toBe("rememberSomething")
  })

  test("CATCHES a bare-client UPDATE of memory_versions and DELETE from memory_sources", () => {
    const bad = `
      import { db } from "@/lib/db"
      export async function rewriteHistory() {
        await db.execute(sql\`UPDATE compliance.memory_versions SET content_snapshot = 'x'\`)
        await db.execute(sql\`DELETE FROM compliance.memory_sources WHERE id = 'y'\`)
      }
    `
    expect(findBareClientMemoryWrites("lib/services/fake.ts", bad).length).toBe(2)
  })

  test("CATCHES the drizzle query-builder form (db.insert(memoryRecords))", () => {
    const bad = `
      import { db, memoryRecords } from "@/lib/db"
      export async function sneaky() {
        await db.insert(memoryRecords).values({ id: "x" })
      }
    `
    expect(findBareClientMemoryWrites("lib/services/fake.ts", bad).length).toBe(1)
  })

  test("does NOT flag a write on the caller's tenant transaction (tx.execute)", () => {
    const good = `
      export async function ok(tx: TenantDb) {
        await tx.execute(sql\`INSERT INTO compliance.memory_records (id) VALUES ('x')\`)
      }
    `
    expect(findBareClientMemoryWrites("lib/services/fake.ts", good)).toEqual([])
  })

  test("does NOT flag a withTenantContext callback whose parameter is named `db` (the real chat-service / run-submission shape)", () => {
    const good = `
      import { db } from "@/lib/db"
      export async function ok(orgId: string) {
        await withTenantContext({ orgId }, async (db) => {
          await db.execute(sql\`INSERT INTO compliance.memory_records (id) VALUES ('x')\`)
        })
      }
    `
    expect(findBareClientMemoryWrites("lib/services/fake.ts", good)).toEqual([])
  })

  test("CATCHES a bare-client write in a file that ALSO contains earlier withTenantContext callbacks named `db`", () => {
    // This is the exact shape the mutation proof used, and the exact shape a
    // naive "is there any (db) binding earlier in this file" scanner misses.
    // chat-service.ts and run-submission.ts both look like this, which is why
    // it is pinned as its own test rather than left to the tree scan.
    const bad = `
      import { db } from "@/lib/db"
      export async function legitimate(orgId: string) {
        await withTenantContext({ orgId }, async (db) => {
          await db.execute(sql\`INSERT INTO compliance.memory_records (id) VALUES ('ok')\`)
        })
      }
      export async function sneakyLater(orgId: string) {
        await db.execute(sql\`INSERT INTO compliance.memory_records (id) VALUES ('bad')\`)
      }
    `
    const found = findBareClientMemoryWrites("lib/services/fake.ts", bad)
    expect(found.length).toBe(1)
    expect(found[0].functionName).toBe("sneakyLater")
  })

  test("does NOT flag a concise-body withTenantContext callback (`(db) => db.execute(...)`)", () => {
    const good = `
      import { db } from "@/lib/db"
      export async function ok(orgId: string) {
        return withTenantContext({ orgId }, (db) => db.execute(sql\`INSERT INTO compliance.memory_sources (id) VALUES ('x')\`))
      }
    `
    expect(findBareClientMemoryWrites("lib/services/fake.ts", good)).toEqual([])
  })

  test("does NOT flag a bypass-client write to some OTHER table", () => {
    const good = `
      import { db } from "@/lib/db"
      export async function ok() {
        await db.execute(sql\`INSERT INTO compliance.embeddings (id) VALUES ('x')\`)
      }
    `
    expect(findBareClientMemoryWrites("lib/services/fake.ts", good)).toEqual([])
  })

  test("does NOT flag a bypass-client READ of a guarded table", () => {
    const good = `
      import { db } from "@/lib/db"
      export async function ok() {
        await db.execute(sql\`SELECT id FROM compliance.memory_records WHERE id = 'x'\`)
      }
    `
    expect(findBareClientMemoryWrites("lib/services/fake.ts", good)).toEqual([])
  })
})
