// ARTICLE-050 memory-tier registry -- pure-function coverage only, matching
// this codebase's established convention of not exercising a live DB from a
// .test.ts file (see exception-taxonomy.test.ts's own header). This file was
// added by the audit198 wave-3 REUSE_COMPONENTIZATION gap closure alongside
// memory-tier-registry.ts itself -- it had zero prior test coverage since
// the module is brand new.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { classifyMemoryTier, tablesForTier, MEMORY_TIER_REGISTRY } from "./memory-tier-registry"

describe("classifyMemoryTier", () => {
  test("classifies a known OPERATIONAL table", () => {
    expect(classifyMemoryTier("messages")).toBe("OPERATIONAL")
    expect(classifyMemoryTier("conversations")).toBe("OPERATIONAL")
    expect(classifyMemoryTier("activity_log")).toBe("OPERATIONAL")
    expect(classifyMemoryTier("assistant_sessions")).toBe("OPERATIONAL")
  })

  test("classifies a known LONG_TERM_KNOWLEDGE table", () => {
    expect(classifyMemoryTier("assistant_memories")).toBe("LONG_TERM_KNOWLEDGE")
    expect(classifyMemoryTier("task_capabilities")).toBe("LONG_TERM_KNOWLEDGE")
    expect(classifyMemoryTier("instruction_packages")).toBe("LONG_TERM_KNOWLEDGE")
    expect(classifyMemoryTier("platform_assets")).toBe("LONG_TERM_KNOWLEDGE")
  })

  test("returns null for a table not yet declared in the registry", () => {
    expect(classifyMemoryTier("not_a_real_table")).toBeNull()
  })
})

describe("tablesForTier", () => {
  test("returns exactly the OPERATIONAL-tier table names", () => {
    expect(tablesForTier("OPERATIONAL").sort()).toEqual(
      ["activity_log", "assistant_sessions", "conversations", "messages"].sort()
    )
  })

  test("returns exactly the LONG_TERM_KNOWLEDGE-tier table names", () => {
    expect(tablesForTier("LONG_TERM_KNOWLEDGE").sort()).toEqual(
      ["assistant_memories", "instruction_packages", "platform_assets", "task_capabilities"].sort()
    )
  })
})

describe("MEMORY_TIER_REGISTRY structural invariants", () => {
  test("every entry has a non-empty table, service, and reason", () => {
    for (const entry of MEMORY_TIER_REGISTRY) {
      expect(entry.table.length).toBeGreaterThan(0)
      expect(entry.service.length).toBeGreaterThan(0)
      expect(entry.reason.length).toBeGreaterThan(0)
      expect(["OPERATIONAL", "LONG_TERM_KNOWLEDGE"]).toContain(entry.tier)
    }
  })

  test("no table name is declared twice", () => {
    const tables = MEMORY_TIER_REGISTRY.map((e) => e.table)
    expect(new Set(tables).size).toBe(tables.length)
  })
})
