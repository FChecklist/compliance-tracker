/// <reference types="bun-types" />
// VERIDIAN Review Framework gap-closure, "Impact Analysis Before
// Modification" / "Dependency Graph Accuracy": tests the pure graph-
// building core (extractImportSpecifiers / resolveImportPath /
// buildDependencyGraph / computeImpact) against fake source text and a fake
// filesystem, matching this repo's established pure-core/shell split
// (model-scorecard-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import { extractImportSpecifiers, resolveImportPath, buildDependencyGraph, computeImpact } from "./build-dependency-index"

describe("extractImportSpecifiers", () => {
  test("finds a plain named import", () => {
    expect(extractImportSpecifiers(`import { foo } from "@/lib/foo"`)).toEqual(["@/lib/foo"])
  })

  test("finds a type-only import", () => {
    expect(extractImportSpecifiers(`import type { Foo } from "@/lib/foo"`)).toEqual(["@/lib/foo"])
  })

  test("finds a re-export", () => {
    expect(extractImportSpecifiers(`export { bar } from "./bar"`)).toEqual(["./bar"])
  })

  test("finds export * re-exports", () => {
    expect(extractImportSpecifiers(`export * from "../baz"`)).toEqual(["../baz"])
  })

  test("finds a dynamic import", () => {
    expect(extractImportSpecifiers(`const mod = await import("@/lib/dynamic-thing")`)).toEqual(["@/lib/dynamic-thing"])
  })

  test("ignores external packages equally as internal -- just extracts, doesn't classify", () => {
    expect(extractImportSpecifiers(`import { z } from "zod"\nimport { db } from "@/lib/db"`)).toEqual(["zod", "@/lib/db"])
  })

  test("returns an empty array for source with no imports", () => {
    expect(extractImportSpecifiers(`export const x = 1`)).toEqual([])
  })

  test("handles multiple imports across several lines", () => {
    const source = [
      `import { a } from "@/lib/a"`,
      `import { b } from "./b"`,
      `import type { C } from "../c"`,
    ].join("\n")
    expect(extractImportSpecifiers(source)).toEqual(["@/lib/a", "./b", "../c"])
  })
})

describe("resolveImportPath", () => {
  const exists = (p: string) => ["src/lib/foo.ts", "src/lib/services/bar-service.ts", "src/lib/utils/index.ts"].includes(p)

  test("resolves an '@/' alias to src/", () => {
    expect(resolveImportPath("src/app/api/foo/route.ts", "@/lib/foo", exists)).toBe("src/lib/foo.ts")
  })

  test("resolves a relative import from the importing file's directory", () => {
    expect(resolveImportPath("src/lib/services/other-service.ts", "./bar-service", exists)).toBe("src/lib/services/bar-service.ts")
  })

  test("resolves a directory import to its index file", () => {
    expect(resolveImportPath("src/app/api/foo/route.ts", "@/lib/utils", exists)).toBe("src/lib/utils/index.ts")
  })

  test("returns null for an external package (no leading @/, ./, or ../)", () => {
    expect(resolveImportPath("src/lib/foo.ts", "zod", exists)).toBeNull()
  })

  test("returns null when nothing on disk matches any candidate extension", () => {
    expect(resolveImportPath("src/lib/foo.ts", "@/lib/does-not-exist", exists)).toBeNull()
  })
})

describe("buildDependencyGraph", () => {
  const exists = (p: string) => ["src/lib/services/a-service.ts", "src/lib/services/b-service.ts", "src/app/api/a/route.ts"].includes(p)

  test("builds forward edges from real internal imports only", () => {
    const files = [
      { path: "src/app/api/a/route.ts", content: `import { doA } from "@/lib/services/a-service"\nimport { z } from "zod"` },
      { path: "src/lib/services/a-service.ts", content: `export function doA() {}` },
      { path: "src/lib/services/b-service.ts", content: `export function doB() {}` },
    ]
    const graph = buildDependencyGraph(files, exists)
    expect(graph.forward["src/app/api/a/route.ts"]).toEqual(["src/lib/services/a-service.ts"])
    expect(graph.forward["src/lib/services/a-service.ts"]).toEqual([])
  })

  test("builds the reverse graph as the exact inverse of forward", () => {
    const files = [
      { path: "src/app/api/a/route.ts", content: `import { doA } from "@/lib/services/a-service"` },
      { path: "src/lib/services/a-service.ts", content: `import { doB } from "./b-service"` },
      { path: "src/lib/services/b-service.ts", content: `export function doB() {}` },
    ]
    const graph = buildDependencyGraph(files, exists)
    expect(graph.reverse["src/lib/services/a-service.ts"]).toEqual(["src/app/api/a/route.ts"])
    expect(graph.reverse["src/lib/services/b-service.ts"]).toEqual(["src/lib/services/a-service.ts"])
  })

  test("an import that resolves outside the scanned file set is dropped, not fabricated as a node", () => {
    const files = [
      { path: "src/app/api/a/route.ts", content: `import { x } from "@/lib/not-scanned"` },
    ]
    const existsIncludingUnscanned = (p: string) => p === "src/lib/not-scanned.ts"
    const graph = buildDependencyGraph(files, existsIncludingUnscanned)
    expect(graph.forward["src/app/api/a/route.ts"]).toEqual([])
    expect(graph.reverse["src/lib/not-scanned.ts"]).toBeUndefined()
  })
})

describe("computeImpact", () => {
  test("returns direct dependents with no transitive layer when nothing chains further", () => {
    const graph = { forward: {}, reverse: { "src/lib/services/a-service.ts": ["src/app/api/a/route.ts"] } }
    const { direct, transitive } = computeImpact(graph, "src/lib/services/a-service.ts")
    expect(direct).toEqual(["src/app/api/a/route.ts"])
    expect(transitive).toEqual([])
  })

  test("walks multiple transitive layers via BFS", () => {
    // c-service is imported by b-service, which is imported by a-service, which is imported by the route.
    const graph = {
      forward: {},
      reverse: {
        "src/lib/services/c-service.ts": ["src/lib/services/b-service.ts"],
        "src/lib/services/b-service.ts": ["src/lib/services/a-service.ts"],
        "src/lib/services/a-service.ts": ["src/app/api/a/route.ts"],
      },
    }
    const { direct, transitive } = computeImpact(graph, "src/lib/services/c-service.ts")
    expect(direct).toEqual(["src/lib/services/b-service.ts"])
    expect(transitive).toEqual(["src/app/api/a/route.ts", "src/lib/services/a-service.ts"])
  })

  test("a diamond dependency is not double-counted", () => {
    // both b-service and c-service import shared-service; a-route imports both b and c.
    const graph = {
      forward: {},
      reverse: {
        "src/lib/services/shared-service.ts": ["src/lib/services/b-service.ts", "src/lib/services/c-service.ts"],
        "src/lib/services/b-service.ts": ["src/app/api/a/route.ts"],
        "src/lib/services/c-service.ts": ["src/app/api/a/route.ts"],
      },
    }
    const { direct, transitive } = computeImpact(graph, "src/lib/services/shared-service.ts")
    expect(direct.sort()).toEqual(["src/lib/services/b-service.ts", "src/lib/services/c-service.ts"])
    expect(transitive).toEqual(["src/app/api/a/route.ts"])
  })

  test("a file nothing imports has zero direct and zero transitive dependents", () => {
    const graph = { forward: {}, reverse: {} }
    const { direct, transitive } = computeImpact(graph, "src/lib/services/orphan-service.ts")
    expect(direct).toEqual([])
    expect(transitive).toEqual([])
  })
})
