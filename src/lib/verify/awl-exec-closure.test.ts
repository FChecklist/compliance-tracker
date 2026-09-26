/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09b (register row AW-504): the import-closure check of the ai-work-link-exec bundle (scripts/verify/awl-exec-closure.mjs) and the table
// it applies (scripts/awl-exec-aliases.mjs). The real entry must be clean, and the check must FAIL when a module that cannot run in the Edge function (or
// that would put a model call on link traffic) is reachable. Fixtures are written to a temp directory; the real repository is never modified.
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. awl-exec-aliases.mjs: drop the "src/lib/llm-client.ts" entry from FILE_STUBS        -> "the real entry is clean ..." fails (the model client is reachable)
//   2. awl-exec-aliases.mjs: drop the { test: /^next\/server$/ } package stub                -> "the real entry is clean ..." fails (next/server is reachable)
//   3. awl-exec-closure.mjs: stop following dynamic import()                                 -> "a dynamic import() is followed ..." fails
//   4. awl-exec-closure.mjs: treat every import as used (skip the unused-binding drop)       -> "importsOf drops ..." fails
//   5. link-exec-entry.ts: import the Level 1 lane directly                                  -> "the real entry is clean ..." fails
//
// Run: bun test --isolate src/lib/verify/awl-exec-closure.test.ts
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { importsOf } from "../../../scripts/verify/awl-exec-closure.mjs"
import { FILE_STUBS, PACKAGE_STUBS, fileStub, packageStub } from "../../../scripts/awl-exec-aliases.mjs"

setDefaultTimeout(60_000)

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const SCRIPT = join(ROOT, "scripts/verify/awl-exec-closure.mjs")
let dir = ""
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "awl-closure-"))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function closure(entry: string) {
  const p = Bun.spawn(["node", SCRIPT, "--no-bundle", "--entry", entry], { cwd: ROOT, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, out, err }
}
function fixture(name: string, body: string): string {
  const f = join(dir, name)
  writeFileSync(f, body)
  return f
}

describe("the real entry", () => {
  test("the real entry is clean: no next/*, next-intl, resend, xlsx, pdf-parse, mathjs, model client, embedding provider or spawned process is reachable", async () => {
    const r = await closure("src/lib/pipeline/link-exec-entry.ts")
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    expect(r.out).toContain("CLOSURE_OK")
    const files = Number(/files=(\d+)/.exec(r.out)?.[1])
    expect(files).toBeGreaterThan(50)
    expect(files).toBeLessThan(400)
  })

  test("a missing entry is exit 3 (a row never passes on a missing input)", async () => {
    expect((await closure(join(dir, "does-not-exist.ts"))).code).toBe(3)
  })
})

describe("what fails it", () => {
  test("a package that cannot run in the Edge function fails: openai, resend, mathjs are FORBIDDEN unless stubbed (resend and mathjs are stubbed, openai is not)", async () => {
    const bad = await closure(fixture("openai.ts", 'import OpenAI from "openai"\nexport const x = OpenAI\n'))
    expect(bad.code).toBe(1)
    expect(bad.err).toContain("FORBIDDEN a model client (openai)")
    // stubbed packages are replaced, so they pass
    const ok = await closure(fixture("stubbed.ts", 'import { Resend } from "resend"\nimport { after } from "next/server"\nexport const x = [Resend, after]\n'))
    expect(ok.code).toBe(0)
  })

  test("a repository module on the forbidden list that is not stubbed fails, with the chain that reaches it", async () => {
    const bad = await closure(fixture("guard.ts", 'import { requireAuth } from "@/lib/supabase/auth-guard"\nexport const x = requireAuth\n'))
    expect(bad.code).toBe(1)
    expect(bad.err).toContain("auth-guard")
    expect(bad.err).toMatch(/guard\.ts -> src\/lib\/supabase\/auth-guard\.ts/)
  })

  test("a dynamic import() is followed, and so is a side-effect import and an export-from", async () => {
    for (const body of [
      'export const x = async () => import("openai")\n',
      'import "openai"\n',
      'export * from "openai"\n',
      'export { default } from "openai"\n',
      'const y = require("openai")\nexport const x = y\n',
    ]) {
      const r = await closure(fixture("dyn.ts", body))
      expect({ body, code: r.code }).toEqual({ body, code: 1 })
    }
  })
})

describe("importsOf", () => {
  test("importsOf drops a type-only import and an import whose bindings are never used, and keeps the rest", () => {
    const src = [
      'import type { A } from "type-only"',
      'import { type B } from "all-type"',
      'import { unusedThing } from "unused"',
      'import { used } from "used"',
      'import def from "default-used"',
      'import * as ns from "namespace-used"',
      'import "side-effect"',
      'export * from "reexport"',
      'export type { T } from "type-reexport"',
      'const pgTable = (n: string) => n; export const t = pgTable("not-an-import")',
      'export const z = [used, def, ns]',
    ].join("\n")
    expect(importsOf(src).sort()).toEqual(["default-used", "namespace-used", "reexport", "side-effect", "used"])
  })

  test("importsOf ignores an import that only appears in a comment", () => {
    expect(importsOf('// import x from "commented"\n/* import y from "block" */\nexport const a = 1\n')).toEqual([])
  })
})

describe("the alias table", () => {
  test("every stub file the table names exists and is the leaf it claims: a stub imports nothing but ./unavailable or the schema", () => {
    const names = [...PACKAGE_STUBS.map((p: { stub: string }) => p.stub), ...Object.values(FILE_STUBS as Record<string, { stub: string }>).map((e) => e.stub)]
    for (const n of names) {
      const rel = n.includes("/") ? n : `src/lib/pipeline/link-exec-stubs/${n}`
      const text = readFileSync(join(ROOT, rel), "utf8")
      const imports = [...text.matchAll(/^\s*(?:import|export)[^"'\n]*from\s+["']([^"']+)["']/gm)].map((m) => m[1])
      for (const spec of imports) expect(`${rel} ${spec}`).toMatch(/\.\/unavailable|@\/lib\/db\/schema|@\/lib\/errors\/error-catalog/)
    }
  })

  test("packageStub and fileStub answer what the table says, and null for anything else", () => {
    expect(packageStub("next/server")).toBe("src/lib/pipeline/link-exec-stubs/next-server.ts")
    expect(packageStub("next-intl/server")).toBe("src/lib/pipeline/link-exec-stubs/next-intl.ts")
    expect(packageStub("drizzle-orm")).toBeNull()
    expect(fileStub("src/lib/llm-client.ts")).toBe("src/lib/pipeline/link-exec-stubs/llm-client.ts")
    expect(fileStub("src/lib/services/compliance-service.ts")).toBe("src/lib/services/service-error.ts")
    expect(fileStub("src/lib/services/pms-time-service.ts")).toBeNull()
  })
})
