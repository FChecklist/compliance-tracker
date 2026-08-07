// CRM & Sales Modules: Opportunities (this wave). Real gap found via a fresh
// audit: crm-accounts-service.ts got a real owner-or-manager RBAC gate in
// Wave 4 (2026-07-17, canEditAccount/canReassignOrDeleteAccount/
// canCreateCrmRecord) but crm_leads/crm_opportunities -- the sibling tables
// one wave earlier -- never did. Any authenticated org member, including
// viewer/client_viewer/external_auditor rank, could create/edit any lead or
// opportunity and could silently reassign ownership via a plain
// PATCH { ownerId } with zero rank check at all, through the native CRM UI's
// own /api/crm/leads* and /api/crm/opportunities* routes. This file tests
// the pure gate functions added to close that gap -- same
// no-live-DB-from-a-.test.ts pattern as crm-accounts-service.test.ts (see
// that file's own note, and approval-workflow-service.test.ts).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  canEditLead, canReassignOrDeleteLead,
  canEditOpportunity, canReassignOrDeleteOpportunity,
  canCreateCrmRecord,
} from "./crm-service"

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
