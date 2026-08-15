// VERIDIAN Review Framework gap-closure: Sales Pipeline (2026-08-07). Tests
// the pure predicate isValidStageTransition() -- every other crm-service.ts
// export touches the DB via withTenantContext, deliberately untested here
// per this repo's established pattern (see crm-accounts-service.test.ts's
// own header note).
//
// CRM & Sales Modules: Opportunities (merged in from a concurrent wave).
// Real gap found via a fresh audit: crm-accounts-service.ts got a real
// owner-or-manager RBAC gate in Wave 4 (17 Jul 2026, canEditAccount/
// canReassignOrDeleteAccount/canCreateCrmRecord) but crm_leads/
// crm_opportunities -- the sibling tables one wave earlier -- never did. Any
// authenticated org member, including viewer/client_viewer/external_auditor
// rank, could create/edit any lead or opportunity and could silently
// reassign ownership via a plain PATCH { ownerId } with zero rank check at
// all, through the native CRM UI's own /api/crm/leads* and
// /api/crm/opportunities* routes. This file also tests the pure gate
// functions added to close that gap -- same no-live-DB-from-a-.test.ts
// pattern as crm-accounts-service.test.ts (see that file's own note, and
// approval-workflow-service.test.ts).
//
// Task #46 (CRM feature-parity gap analysis, merged in alongside both of the
// above): also tests the pure predicates computeRoundRobinAssignment() and
// aggregateLeadSourceEffectiveness() -- rather than exercising the
// withTenantContext/live-DB-backed functions that call them
// (autoDistributeLeads/autoDistributeOpportunities/getAssignmentOverview/
// getLeadSourceEffectivenessReport). Same no-live-DB pattern throughout this
// file.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  isValidStageTransition,
  canEditLead, canReassignOrDeleteLead,
  canEditOpportunity, canReassignOrDeleteOpportunity,
  canCreateCrmRecord,
  computeRoundRobinAssignment, aggregateLeadSourceEffectiveness,
} from "./crm-service"

const STAGES = [
  { stageKey: "prospecting", isWon: false, isLost: false },
  { stageKey: "proposal", isWon: false, isLost: false },
  { stageKey: "negotiation", isWon: false, isLost: false },
  { stageKey: "won", isWon: true, isLost: false },
  { stageKey: "lost", isWon: false, isLost: true },
]
const MEMBER_RANK = 2
const MANAGER_RANK = 3

describe("isValidStageTransition", () => {
  test("allows moving between two non-terminal stages, forward", () => {
    expect(isValidStageTransition("prospecting", "negotiation", STAGES, MEMBER_RANK)).toEqual({ valid: true })
  })

  test("allows moving between two non-terminal stages, backward -- a deal cooling off is a real event", () => {
    expect(isValidStageTransition("negotiation", "proposal", STAGES, MEMBER_RANK)).toEqual({ valid: true })
  })

  test("allows a no-op (same stage)", () => {
    expect(isValidStageTransition("proposal", "proposal", STAGES, MEMBER_RANK)).toEqual({ valid: true })
  })

  test("allows any member to close a deal into won", () => {
    expect(isValidStageTransition("negotiation", "won", STAGES, MEMBER_RANK)).toEqual({ valid: true })
  })

  test("allows any member to close a deal into lost", () => {
    expect(isValidStageTransition("proposal", "lost", STAGES, MEMBER_RANK)).toEqual({ valid: true })
  })

  test("rejects a member reopening a won deal back into an active stage", () => {
    const result = isValidStageTransition("won", "negotiation", STAGES, MEMBER_RANK)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("manager approval")
  })

  test("rejects a member reopening a lost deal", () => {
    expect(isValidStageTransition("lost", "prospecting", STAGES, MEMBER_RANK).valid).toBe(false)
  })

  test("allows a manager to reopen a closed deal", () => {
    expect(isValidStageTransition("won", "negotiation", STAGES, MANAGER_RANK)).toEqual({ valid: true })
  })

  test("rejects an unknown target stage", () => {
    const result = isValidStageTransition("prospecting", "not-a-real-stage", STAGES, MANAGER_RANK)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Unknown pipeline stage")
  })

  test("falls back to hardcoded won/lost strings when stages config is empty (defensive)", () => {
    expect(isValidStageTransition("won", "prospecting", [{ stageKey: "prospecting", isWon: false, isLost: false }], MEMBER_RANK).valid).toBe(false)
  })
})

describe("canEditLead -- owner-or-manager RBAC gate", () => {
  test("denies a viewer regardless of ownership", () => {
    expect(canEditLead("viewer", null, "u1").ok).toBe(false)
  });

  test("allows a member who owns the lead", () => {
    expect(canEditLead("member", "u1", "u1").ok).toBe(true)
  });

  test("denies a member who does NOT own the lead", () => {
    const result = canEditLead("member", "u2", "u1")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/owner or a manager/)
  });

  test("allows a member on an unowned (ownerId null) lead", () => {
    expect(canEditLead("member", null, "u1").ok).toBe(true)
  });

  test("allows a manager to edit any lead regardless of owner", () => {
    expect(canEditLead("manager", "someone-else", "u1").ok).toBe(true)
  });

  test("allows veridian_admin (highest rank) to edit any lead", () => {
    expect(canEditLead("veridian_admin", "someone-else", "u1").ok).toBe(true)
  });

  test("denies an unrecognized/empty role (rank 0)", () => {
    expect(canEditLead("", "u1", "u1").ok).toBe(false)
  });
});

describe("canReassignOrDeleteLead -- manager-rank-only RBAC gate", () => {
  test("denies a member", () => {
    expect(canReassignOrDeleteLead("member").ok).toBe(false)
  });

  test("denies a viewer", () => {
    expect(canReassignOrDeleteLead("viewer").ok).toBe(false)
  });

  test("allows a manager", () => {
    expect(canReassignOrDeleteLead("manager").ok).toBe(true)
  });

  test("allows branch_manager (rank above manager)", () => {
    expect(canReassignOrDeleteLead("branch_manager").ok).toBe(true)
  });

  test("allows admin", () => {
    expect(canReassignOrDeleteLead("admin").ok).toBe(true)
  });
});

describe("canEditOpportunity -- owner-or-manager RBAC gate", () => {
  test("denies a viewer regardless of ownership", () => {
    expect(canEditOpportunity("viewer", null, "u1").ok).toBe(false)
  });

  test("allows a member who owns the opportunity", () => {
    expect(canEditOpportunity("member", "u1", "u1").ok).toBe(true)
  });

  test("denies a member who does NOT own the opportunity", () => {
    const result = canEditOpportunity("member", "u2", "u1")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/owner or a manager/)
  });

  test("allows a member on an unowned (ownerId null) opportunity", () => {
    expect(canEditOpportunity("member", null, "u1").ok).toBe(true)
  });

  test("allows a manager to edit any opportunity regardless of owner", () => {
    expect(canEditOpportunity("manager", "someone-else", "u1").ok).toBe(true)
  });

  test("allows senior_professional (same rank as manager) to edit any opportunity", () => {
    expect(canEditOpportunity("senior_professional", "someone-else", "u1").ok).toBe(true)
  });
});

describe("canReassignOrDeleteOpportunity -- manager-rank-only RBAC gate", () => {
  test("denies a member", () => {
    expect(canReassignOrDeleteOpportunity("member").ok).toBe(false)
  });

  test("denies a viewer", () => {
    expect(canReassignOrDeleteOpportunity("viewer").ok).toBe(false)
  });

  test("allows a manager", () => {
    expect(canReassignOrDeleteOpportunity("manager").ok).toBe(true)
  });

  test("allows veridian_admin", () => {
    expect(canReassignOrDeleteOpportunity("veridian_admin").ok).toBe(true)
  });
});

describe("canCreateCrmRecord -- member-rank-or-above gate for new leads/opportunities", () => {
  test("denies a viewer", () => {
    expect(canCreateCrmRecord("viewer").ok).toBe(false)
  });

  test("denies client_viewer (also rank 1)", () => {
    expect(canCreateCrmRecord("client_viewer").ok).toBe(false)
  });

  test("allows a member", () => {
    expect(canCreateCrmRecord("member").ok).toBe(true)
  });

  test("allows team_member (same rank as member)", () => {
    expect(canCreateCrmRecord("team_member").ok).toBe(true)
  });

  test("allows a manager", () => {
    expect(canCreateCrmRecord("manager").ok).toBe(true)
  });
});

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
