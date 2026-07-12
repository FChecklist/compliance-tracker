/// <reference types="bun-types" />
// ai-os/tree4-unified/10-merged-governance-layer.yaml U-D2.B1.S1 (escalation
// level tags) and U-D2.B4.S1 (audit-organization independence). Pure,
// deterministic checks against the roster array -- no DB access.
import { describe, expect, test } from "bun:test"
import { AI_TEAM_ROSTER, getRole, isAuditOrganizationRole, rolesByEscalationLevel, allAuditOrganizationRoles } from "./roster"

describe("isAuditOrganizationRole -- U-D2.B4.S1", () => {
  test("chief_audit_officer (AUDIT_EXECUTIVE) is an audit-organization role", () => {
    expect(isAuditOrganizationRole("chief_audit_officer")).toBe(true)
  })

  test("every division head and specialist auditor across all 5 audit divisions is an audit-organization role", () => {
    for (const role of allAuditOrganizationRoles()) {
      expect(isAuditOrganizationRole(role.roleKey)).toBe(true)
    }
  })

  test("an ordinary operational engineering role is NOT an audit-organization role", () => {
    expect(isAuditOrganizationRole("senior_backend_engineer")).toBe(false)
  })

  test("a GUARDRAIL_* role is NOT an audit-organization role (governance guardrails are a distinct layer from the audit organization)", () => {
    expect(isAuditOrganizationRole("chief_governance_officer")).toBe(false)
  })

  test("an unknown roleKey is NOT an audit-organization role (fails closed to false, not a throw)", () => {
    expect(isAuditOrganizationRole("not_a_real_role")).toBe(false)
  })
})

describe("escalationLevel tags -- U-D2.B1.S1", () => {
  test("chief_execution_engine is tagged L0 (the spec's literal 'L0 Execution Agent (GPT-OSS-120B)')", () => {
    expect(getRole("chief_execution_engine")?.escalationLevel).toBe("L0")
  })

  test("chief_operating_officer is tagged L3", () => {
    expect(getRole("chief_operating_officer")?.escalationLevel).toBe("L3")
  })

  test("super_boss is tagged L4", () => {
    expect(getRole("super_boss")?.escalationLevel).toBe("L4")
  })

  test("founder_ceo is tagged L5 (Owner, terminal rung)", () => {
    expect(getRole("founder_ceo")?.escalationLevel).toBe("L5")
  })

  test("chief_software_engineering_officer is deliberately untagged -- it belongs to a different source document's ladder, not U-D2.B1.S1's L0-L5 spec", () => {
    expect(getRole("chief_software_engineering_officer")?.escalationLevel).toBeUndefined()
  })

  test("rolesByEscalationLevel('L0') returns exactly the roles tagged L0", () => {
    const l0Roles = rolesByEscalationLevel("L0")
    expect(l0Roles.map((r) => r.roleKey)).toEqual(["chief_execution_engine"])
  })

  test("no role is tagged with anything other than L0/L3/L4/L5 (L1/L2 are process gates, not roles)", () => {
    const taggedLevels = new Set(AI_TEAM_ROSTER.map((r) => r.escalationLevel).filter(Boolean))
    for (const level of taggedLevels) {
      expect(["L0", "L3", "L4", "L5"]).toContain(level)
    }
  })
})
