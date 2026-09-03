/// <reference types="bun-types" />
// R68 Phase 2, items 2+3. Pure-function unit tests -- no DB (same
// no-live-DB-in-CI posture as every other test file touching this phase,
// see r48-six-tenant-tables-rls.test.ts's own header). The real, live
// succession-window proof (synthetic person_holds_role edges inserted
// against pcrjmlpuqsbocqfwoxod inside a rolled-back transaction) is run
// directly via the Supabase MCP and reported in this PR's description --
// it cannot run here for the same reason getMemoryRecordAsOf() itself has
// no live-DB test in this repo.
import { describe, expect, test } from "bun:test"
import {
  GRAPH_EDGE_TYPES_INSTANCE_V1,
  GRAPH_EDGE_TYPES_PLATFORM_V1,
  isRoleHeldAt,
  personHoldsRoleConstraintName,
  type PersonHoldsRoleAttrs,
} from "./edge-types"

describe("edge-type vocabulary", () => {
  test("the 7 net-new instance-tier v1 types are exactly the ones the migration documents", () => {
    expect(GRAPH_EDGE_TYPES_INSTANCE_V1).toEqual([
      "person_holds_role",
      "role_made_decision",
      "decision_cites_document",
      "document_has_chunk",
      "supersedes",
      "amends",
      "contradicts",
    ])
  })

  test("does not overload 'references' -- that string already means FK-derived across 867 existing rows", () => {
    expect(GRAPH_EDGE_TYPES_INSTANCE_V1).not.toContain("references")
    expect(GRAPH_EDGE_TYPES_PLATFORM_V1).toContain("references")
  })

  test("no overlap between the platform-tier and instance-tier vocabularies", () => {
    const overlap = GRAPH_EDGE_TYPES_INSTANCE_V1.filter((t) =>
      (GRAPH_EDGE_TYPES_PLATFORM_V1 as readonly string[]).includes(t)
    )
    expect(overlap).toEqual([])
  })
})

describe("isRoleHeldAt -- same half-open-interval semantics as getMemoryRecordAsOf()'s effective_from/effective_to window", () => {
  const openTenure: PersonHoldsRoleAttrs = { held_from: "2020-01-01T00:00:00Z", held_to: null }
  const closedTenure: PersonHoldsRoleAttrs = { held_from: "2015-01-01T00:00:00Z", held_to: "2019-01-01T00:00:00Z" }

  test("before held_from is not held", () => {
    expect(isRoleHeldAt(openTenure, new Date("2019-12-31T23:59:59Z"))).toBe(false)
  })

  test("exactly at held_from IS held (inclusive start, matches effective_from <= asOf)", () => {
    expect(isRoleHeldAt(openTenure, new Date("2020-01-01T00:00:00Z"))).toBe(true)
  })

  test("held_to null (current holder) is held arbitrarily far in the future", () => {
    expect(isRoleHeldAt(openTenure, new Date("2099-01-01T00:00:00Z"))).toBe(true)
  })

  test("strictly before held_to is held", () => {
    expect(isRoleHeldAt(closedTenure, new Date("2018-12-31T23:59:59Z"))).toBe(true)
  })

  test("exactly at held_to is NOT held (exclusive end, matches effective_to > asOf being false at equality)", () => {
    expect(isRoleHeldAt(closedTenure, new Date("2019-01-01T00:00:00Z"))).toBe(false)
  })

  test("a real succession: two non-overlapping tenures of the SAME role resolve to exactly one holder at any T, never zero or two, for a person who held it twice", () => {
    // Same person, same role, two non-contiguous tenures -- the case
    // graph_edge_uq needs constraint_name to disambiguate (see
    // personHoldsRoleConstraintName below).
    const firstTenure: PersonHoldsRoleAttrs = { held_from: "2010-01-01T00:00:00Z", held_to: "2012-01-01T00:00:00Z" }
    const secondTenure: PersonHoldsRoleAttrs = { held_from: "2020-01-01T00:00:00Z", held_to: null }

    expect(isRoleHeldAt(firstTenure, new Date("2011-01-01T00:00:00Z"))).toBe(true)
    expect(isRoleHeldAt(secondTenure, new Date("2011-01-01T00:00:00Z"))).toBe(false)

    // The gap between the two tenures (2012-2020): neither holds.
    expect(isRoleHeldAt(firstTenure, new Date("2015-01-01T00:00:00Z"))).toBe(false)
    expect(isRoleHeldAt(secondTenure, new Date("2015-01-01T00:00:00Z"))).toBe(false)

    expect(isRoleHeldAt(firstTenure, new Date("2021-01-01T00:00:00Z"))).toBe(false)
    expect(isRoleHeldAt(secondTenure, new Date("2021-01-01T00:00:00Z"))).toBe(true)
  })
})

describe("personHoldsRoleConstraintName -- graph_edge_uq discriminator for repeat tenures", () => {
  test("is deterministic for the same held_from instant", () => {
    expect(personHoldsRoleConstraintName("2020-01-01T00:00:00Z")).toBe(personHoldsRoleConstraintName("2020-01-01T00:00:00Z"))
  })

  test("differs across two distinct held_from instants for the same (person, role) pair", () => {
    const first = personHoldsRoleConstraintName("2010-01-01T00:00:00Z")
    const second = personHoldsRoleConstraintName("2020-01-01T00:00:00Z")
    expect(first).not.toBe(second)
  })

  test("normalizes equivalent timestamps to the same key (same instant, different string form)", () => {
    expect(personHoldsRoleConstraintName("2020-01-01T00:00:00Z")).toBe(personHoldsRoleConstraintName("2020-01-01T00:00:00.000Z"))
  })
})
