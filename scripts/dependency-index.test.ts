/// <reference types="bun-types" />
// Tests the pure functions dependency-index.ts's real filesystem walk/CLI
// delegates to -- extractImportSpecifiers/resolveSpecifierPath/
// resolveToRealFile/buildDependencyGraph/findDependents/findDependencies --
// against small in-memory fixtures, no real filesystem or DB touched. Same
// pure-core testing discipline as model-scorecard-service.test.ts.
import { describe, expect, test } from "bun:test"
import {
  extractImportSpecifiers,
  resolveSpecifierPath,
  resolveToRealFile,
  buildDependencyGraph,
  findDependents,
  findDependencies,
  type SourceFile,
} from "./dependency-index"

describe("extractImportSpecifiers", () => {
  test("finds a named import with @/ alias", () => {
    expect(extractImportSpecifiers(`import { db } from "@/lib/db"`)).toEqual(["@/lib/db"])
  })

  test("finds a relative import", () => {
    expect(extractImportSpecifiers(`import { foo } from "./foo-service"`)).toEqual(["./foo-service"])
  })

  test("finds a side-effect import with no `from`", () => {
    expect(extractImportSpecifiers(`import "./side-effect"`)).toEqual(["./side-effect"])
  })

  test("finds a re-export", () => {
    expect(extractImportSpecifiers(`export { thing } from "../other"`)).toEqual(["../other"])
    expect(extractImportSpecifiers(`export * from "../other-2"`)).toEqual(["../other-2"])
  })

  test("finds require() and dynamic import()", () => {
    expect(extractImportSpecifiers(`const x = require("./x")`)).toEqual(["./x"])
    expect(extractImportSpecifiers(`const y = await import("./y")`)).toEqual(["./y"])
  })

  test("finds multiple imports across a file, ignores external packages the same way (they're filtered later, not here)", () => {
    const content = `
import { db } from "@/lib/db"
import { z } from "zod"
import type { Foo } from "./types"
export function run() {}
`
    expect(extractImportSpecifiers(content)).toEqual(["@/lib/db", "zod", "./types"])
  })

  test("does not false-positive on prose containing the word 'from' without a following quote", () => {
    expect(extractImportSpecifiers(`// migrate data from the old table to the new one`)).toEqual([])
  })

  test("empty content yields no specifiers", () => {
    expect(extractImportSpecifiers("")).toEqual([])
  })
})

describe("resolveSpecifierPath", () => {
  test("resolves an @/ alias against src/", () => {
    expect(resolveSpecifierPath("src/app/api/foo/route.ts", "@/lib/services/foo-service")).toBe(
      "src/lib/services/foo-service"
    )
  })

  test("resolves a same-directory relative import", () => {
    expect(resolveSpecifierPath("src/lib/services/foo-service.ts", "./foo-helpers")).toBe(
      "src/lib/services/foo-helpers"
    )
  })

  test("resolves a parent-directory relative import", () => {
    expect(resolveSpecifierPath("src/lib/services/foo-service.ts", "../db")).toBe("src/lib/db")
  })

  test("returns null for an external (bare specifier) package", () => {
    expect(resolveSpecifierPath("src/lib/services/foo-service.ts", "drizzle-orm")).toBeNull()
    expect(resolveSpecifierPath("src/lib/services/foo-service.ts", "next/server")).toBeNull()
  })
})

describe("resolveToRealFile", () => {
  const known = new Set(["src/lib/services/foo-service.ts", "src/lib/db/index.ts"])

  test("matches an exact path with extension already present", () => {
    expect(resolveToRealFile("src/lib/services/foo-service.ts", known)).toBe("src/lib/services/foo-service.ts")
  })

  test("appends .ts when the raw path has no extension", () => {
    expect(resolveToRealFile("src/lib/services/foo-service", known)).toBe("src/lib/services/foo-service.ts")
  })

  test("falls back to /index.ts for a directory import", () => {
    expect(resolveToRealFile("src/lib/db", known)).toBe("src/lib/db/index.ts")
  })

  test("returns null when nothing matches (e.g. an external package leaked through)", () => {
    expect(resolveToRealFile("src/lib/services/does-not-exist", known)).toBeNull()
  })
})

describe("buildDependencyGraph", () => {
  const files: SourceFile[] = [
    {
      path: "src/app/api/foo/route.ts",
      content: `import { getFoo } from "@/lib/services/foo-service"\nimport { requireAuth } from "@/lib/supabase/auth-guard"\n`,
    },
    {
      path: "src/lib/services/foo-service.ts",
      content: `import { db } from "@/lib/db"\nimport { z } from "zod"\n`,
    },
    { path: "src/lib/db.ts", content: `export const db = {}\n` },
    { path: "src/lib/supabase/auth-guard.ts", content: `export function requireAuth() {}\n` },
  ]

  test("builds forward edges resolving @/ aliases, dropping external packages", () => {
    const graph = buildDependencyGraph(files)
    expect(graph.edges["src/app/api/foo/route.ts"]).toEqual([
      "src/lib/services/foo-service.ts",
      "src/lib/supabase/auth-guard.ts",
    ])
    expect(graph.edges["src/lib/services/foo-service.ts"]).toEqual(["src/lib/db.ts"])
  })

  test("a file with no internal imports gets an empty edge list, not a missing key", () => {
    const graph = buildDependencyGraph(files)
    expect(graph.edges["src/lib/db.ts"]).toEqual([])
  })

  test("never includes a self-edge even if a file re-imports its own path somehow", () => {
    const selfImporting: SourceFile[] = [
      { path: "src/lib/weird.ts", content: `import "./weird"\n` },
    ]
    const graph = buildDependencyGraph(selfImporting)
    expect(graph.edges["src/lib/weird.ts"]).toEqual([])
  })
})

describe("findDependencies / findDependents -- impact analysis", () => {
  // route -> serviceA -> shared ; serviceB -> shared ; route2 -> serviceB
  const files: SourceFile[] = [
    { path: "src/app/api/a/route.ts", content: `import { a } from "@/lib/services/service-a"\n` },
    { path: "src/app/api/b/route.ts", content: `import { b } from "@/lib/services/service-b"\n` },
    { path: "src/lib/services/service-a.ts", content: `import { shared } from "@/lib/shared"\n` },
    { path: "src/lib/services/service-b.ts", content: `import { shared } from "@/lib/shared"\n` },
    { path: "src/lib/shared.ts", content: `export const shared = {}\n` },
  ]
  const graph = buildDependencyGraph(files)

  test("findDependencies returns what a file itself imports", () => {
    expect(findDependencies(graph, "src/lib/services/service-a.ts")).toEqual(["src/lib/shared.ts"])
  })

  test("findDependencies on an unknown file returns an empty array, not a crash", () => {
    expect(findDependencies(graph, "src/lib/does-not-exist.ts")).toEqual([])
  })

  test("findDependents(transitive=false) returns only direct importers", () => {
    expect(findDependents(graph, "src/lib/shared.ts", false)).toEqual([
      "src/lib/services/service-a.ts",
      "src/lib/services/service-b.ts",
    ])
  })

  test("findDependents(transitive=true) walks the full reverse graph -- both routes are impacted by changing the shared file", () => {
    const impacted = findDependents(graph, "src/lib/shared.ts", true)
    expect(impacted.sort()).toEqual(
      [
        "src/app/api/a/route.ts",
        "src/app/api/b/route.ts",
        "src/lib/services/service-a.ts",
        "src/lib/services/service-b.ts",
      ].sort()
    )
  })

  test("a leaf file with nothing importing it has no dependents", () => {
    expect(findDependents(graph, "src/app/api/a/route.ts", true)).toEqual([])
  })
})
