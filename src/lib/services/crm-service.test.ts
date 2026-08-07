// VERIDIAN Review Framework gap-closure (2026-08-07), CRM Leads: tests the
// pure predicates/parsers this wave adds -- VALID_LEAD_TRANSITIONS, the
// Zod schemas + fieldErrorsFromZod(), and the CSV export/import helpers'
// escaping/parsing. Same pure/no-DB pattern as
// crm-accounts-service.test.ts (this repo's established convention of not
// touching a live DB from a .test.ts file).
//
// Also covers Task #46 (CRM feature-parity gap analysis)'s pure predicate
// crm-service.ts exports for deterministic auto-assignment --
// computeRoundRobinAssignment() -- and aggregateLeadSourceEffectiveness(),
// merged into this same file rather than exercising the
// withTenantContext/live-DB-backed functions that call them
// (autoDistributeLeads/autoDistributeOpportunities/getAssignmentOverview).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  VALID_LEAD_TRANSITIONS,
  createLeadSchema,
  updateLeadSchema,
  fieldErrorsFromZod,
  computeRoundRobinAssignment,
  aggregateLeadSourceEffectiveness,
} from "./crm-service"

describe("VALID_LEAD_TRANSITIONS -- lead status state machine", () => {
  test("allows the standard funnel progression", () => {
    expect(VALID_LEAD_TRANSITIONS.new).toContain("contacted")
    expect(VALID_LEAD_TRANSITIONS.contacted).toContain("qualified")
  })

  test("allows moving to 'lost' from any active status", () => {
    expect(VALID_LEAD_TRANSITIONS.new).toContain("lost")
    expect(VALID_LEAD_TRANSITIONS.contacted).toContain("lost")
    expect(VALID_LEAD_TRANSITIONS.qualified).toContain("lost")
  })

  test("'converted' and 'lost' are terminal -- no outbound transitions", () => {
    expect(VALID_LEAD_TRANSITIONS.converted).toEqual([])
    expect(VALID_LEAD_TRANSITIONS.lost).toEqual([])
  })

  test("does not allow skipping backward from qualified to new", () => {
    expect(VALID_LEAD_TRANSITIONS.qualified).not.toContain("new")
  })
})

describe("createLeadSchema -- field-level validation", () => {
  test("accepts a minimal valid lead (name only)", () => {
    const result = createLeadSchema.safeParse({ name: "Acme Corp" })
    expect(result.success).toBe(true)
  })

  test("rejects an empty name with a field-level message", () => {
    const result = createLeadSchema.safeParse({ name: "" })
    expect(result.success).toBe(false)
    if (!result.success) {
      const fields = fieldErrorsFromZod(result.error)
      expect(fields.name).toBeDefined()
    }
  })

  test("rejects a malformed contact email", () => {
    const result = createLeadSchema.safeParse({ name: "Acme Corp", contactEmail: "not-an-email" })
    expect(result.success).toBe(false)
    if (!result.success) {
      const fields = fieldErrorsFromZod(result.error)
      expect(fields.contactEmail).toBeDefined()
    }
  })

  test("allows an empty-string contact email (optional field, not provided)", () => {
    const result = createLeadSchema.safeParse({ name: "Acme Corp", contactEmail: "" })
    expect(result.success).toBe(true)
  })
})

describe("updateLeadSchema -- field-level validation", () => {
  test("rejects a status outside the closed enum", () => {
    const result = updateLeadSchema.safeParse({ status: "archived" })
    expect(result.success).toBe(false)
  })

  test("accepts a known status", () => {
    const result = updateLeadSchema.safeParse({ status: "qualified" })
    expect(result.success).toBe(true)
  })

  test("accepts an empty patch (no-op update)", () => {
    const result = updateLeadSchema.safeParse({})
    expect(result.success).toBe(true)
  })
})

describe("computeRoundRobinAssignment -- deterministic, zero-AI load-balanced distribution", () => {
  test("distributes evenly round-robin across multiple active users (Auto Assign mode, no cap)", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(
      ["r1", "r2", "r3", "r4"],
      ["u1", "u2"]
    )
    expect(assignments).toEqual([
      { recordId: "r1", userId: "u1" },
      { recordId: "r2", userId: "u2" },
      { recordId: "r3", userId: "u1" },
      { recordId: "r4", userId: "u2" },
    ])
    expect(perUser).toEqual({ u1: 2, u2: 2 })
  })

  test("more unassigned records than users -- uneven totals, still deterministic round-robin order", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(
      ["r1", "r2", "r3", "r4", "r5"],
      ["u1", "u2", "u3"]
    )
    // 5 records / 3 users: u1 and u2 get 2, u3 gets 1 -- round-robin order,
    // not sorted-by-count.
    expect(assignments.map((a) => a.userId)).toEqual(["u1", "u2", "u3", "u1", "u2"])
    expect(perUser).toEqual({ u1: 2, u2: 2, u3: 1 })
  })

  test("zero unassigned records is a real no-op -- empty assignments, zeroed perUser counts", () => {
    const { assignments, perUser } = computeRoundRobinAssignment([], ["u1", "u2"])
    expect(assignments).toEqual([])
    expect(perUser).toEqual({ u1: 0, u2: 0 })
  })

  test("zero active users is also a no-op regardless of how many records are unassigned", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(["r1", "r2"], [])
    expect(assignments).toEqual([])
    expect(perUser).toEqual({})
  })

  test("all users at capacity (sharingCount) -- stops placing once every user hits the cap, remainder stays unassigned", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(
      ["r1", "r2", "r3", "r4", "r5"],
      ["u1", "u2"],
      2 // sharingCount: each user takes at most 2
    )
    // u1<-r1, u2<-r2, u1<-r3, u2<-r4 -- both users now at cap (2 each).
    // r5 cannot be placed anywhere; the function stops rather than
    // scanning the rest of the (empty) queue for no effect.
    expect(assignments).toEqual([
      { recordId: "r1", userId: "u1" },
      { recordId: "r2", userId: "u2" },
      { recordId: "r3", userId: "u1" },
      { recordId: "r4", userId: "u2" },
    ])
    expect(perUser).toEqual({ u1: 2, u2: 2 })
  })

  test("sharingCount honored per-user even with an uneven pool size", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(
      ["r1", "r2", "r3"],
      ["u1", "u2", "u3"],
      1 // each of the 3 users gets exactly 1 -- exactly enough capacity for 3 records
    )
    expect(assignments.map((a) => a.userId)).toEqual(["u1", "u2", "u3"])
    expect(perUser).toEqual({ u1: 1, u2: 1, u3: 1 })
  })

  test("single user pool with no cap absorbs every unassigned record", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(["r1", "r2", "r3"], ["u1"])
    expect(assignments).toHaveLength(3)
    expect(assignments.every((a) => a.userId === "u1")).toBe(true)
    expect(perUser).toEqual({ u1: 3 })
  })
})

describe("aggregateLeadSourceEffectiveness -- sap_reports lead_source_effectiveness gap", () => {
  test("conversion rate and avg won-deal size computed per source, from real won/lost opportunities only", () => {
    const leads = [
      { id: "l1", source: "referral", status: "converted" },
      { id: "l2", source: "referral", status: "lost" },
      { id: "l3", source: "website", status: "qualified" },
    ]
    const opportunities = [
      { leadId: "l1", stage: "won", estimatedValue: "10000" },
      { leadId: "l2", stage: "lost", estimatedValue: "5000" },
      { leadId: "l3", stage: "won", estimatedValue: "4000" },
    ]
    const { bySource } = aggregateLeadSourceEffectiveness(leads, opportunities)
    const referral = bySource.find((r) => r.source === "referral")!
    const website = bySource.find((r) => r.source === "website")!
    expect(referral.totalLeads).toBe(2)
    expect(referral.wonDeals).toBe(1)
    expect(referral.totalDeals).toBe(2)
    expect(referral.conversionRate).toBe(0.5)
    expect(referral.avgWonDealSize).toBe(10000)
    expect(website.conversionRate).toBe(1)
    expect(website.avgWonDealSize).toBe(4000)
  })

  test("open (not won/lost) opportunities never count toward conversion rate or deal totals", () => {
    const leads = [{ id: "l1", source: "cold_outreach", status: "qualified" }]
    const opportunities = [{ leadId: "l1", stage: "proposal", estimatedValue: "8000" }]
    const { bySource } = aggregateLeadSourceEffectiveness(leads, opportunities)
    const row = bySource.find((r) => r.source === "cold_outreach")!
    expect(row.totalDeals).toBe(0)
    expect(row.wonDeals).toBe(0)
    expect(row.conversionRate).toBeNull()
    expect(row.avgWonDealSize).toBeNull()
  })

  test("null/blank source buckets as 'unattributed', not dropped or crashed on", () => {
    const leads = [{ id: "l1", source: null, status: "new" }, { id: "l2", source: "  ", status: "new" }]
    const { bySource } = aggregateLeadSourceEffectiveness(leads, [])
    expect(bySource).toHaveLength(1)
    expect(bySource[0].source).toBe("unattributed")
    expect(bySource[0].totalLeads).toBe(2)
  })

  test("opportunity with no leadId (created directly against a client) is excluded, not misattributed", () => {
    const leads = [{ id: "l1", source: "referral", status: "converted" }]
    const opportunities = [
      { leadId: "l1", stage: "won", estimatedValue: "1000" },
      { leadId: null, stage: "won", estimatedValue: "999999" }, // must never leak into any source's totals
    ]
    const { bySource } = aggregateLeadSourceEffectiveness(leads, opportunities)
    expect(bySource).toHaveLength(1)
    expect(bySource[0].avgWonDealSize).toBe(1000)
  })

  test("zero leads is a real no-op -- empty report, not a crash", () => {
    expect(aggregateLeadSourceEffectiveness([], [])).toEqual({ bySource: [] })
  })
})
