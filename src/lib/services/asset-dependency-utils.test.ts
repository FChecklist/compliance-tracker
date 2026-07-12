/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { mergeDependency } from "./asset-dependency-utils"

describe("mergeDependency", () => {
  test("appends a new dependency to an empty array", () => {
    expect(mergeDependency([], "AST-000002")).toEqual(["AST-000002"])
  })

  test("appends a new dependency after existing ones, preserving order", () => {
    expect(mergeDependency(["AST-000001", "AST-000002"], "AST-000003")).toEqual([
      "AST-000001",
      "AST-000002",
      "AST-000003",
    ])
  })

  test("is idempotent -- re-linking the same dependency does not duplicate it", () => {
    const existing = ["AST-000001", "AST-000002"]
    const result = mergeDependency(existing, "AST-000002")
    expect(result).toEqual(["AST-000001", "AST-000002"])
    expect(result.length).toBe(2)
  })

  test("never mutates the input array (returns a new reference when it appends)", () => {
    const existing = ["AST-000001"]
    const result = mergeDependency(existing, "AST-000002")
    expect(result).not.toBe(existing)
    expect(existing).toEqual(["AST-000001"])
  })

  test("returns the exact same array reference when the dependency is already present (no-op short circuit)", () => {
    const existing = ["AST-000001", "AST-000002"]
    expect(mergeDependency(existing, "AST-000001")).toBe(existing)
  })
})
