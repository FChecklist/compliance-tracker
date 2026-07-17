// VERIDIAN Review Framework remediation (2026-07-17): unit tests for the
// shared ERP permission-check utility (permission-service.ts). Exercises
// the REAL requireRole()/requireRoleOrScope()/hasRole() primitives from
// auth-guard.ts through requirePermissionForUser()/requirePermission() --
// not a reimplementation or a mock of the rank comparison -- matching this
// codebase's own established pattern of testing gates directly against the
// live enum (see erp-fixed-assets-service.test.ts's disposal-gate describe
// block, studied before writing this file). No DB access needed: neither
// requireRole nor requireRoleOrScope touches the database.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  ERP_ACTION_ROLES,
  requirePermission,
  requirePermissionForUser,
  type ErpAction,
} from "./permission-service"
import type { users } from "@/lib/db"
import type { UserRole, CombinedAuthContext } from "@/lib/supabase/auth-guard"

type DbUser = typeof users.$inferSelect

function userWithRole(role: UserRole): DbUser {
  return { role } as unknown as DbUser
}

function sessionCtx(role: UserRole): CombinedAuthContext {
  return { orgId: "org-1", dbUser: userWithRole(role), apiKey: null, response: null }
}

function apiKeyCtx(scopes: string[]): CombinedAuthContext {
  return { orgId: "org-1", dbUser: null, apiKey: { id: "key-1", name: "test key", scopes }, response: null }
}

describe("ERP_ACTION_ROLES -- policy table integrity", () => {
  test("every action registered so far is present with a real UserRole value", () => {
    // Extended by the HR Attendance & Manpower wave (same
    // REVIEW-FRAMEWORK-WAVE4 effort, a concurrent sibling track to the one
    // that introduced this file) to also cover
    // erp.hr_attendance.mark_other / erp.hr_attendance.holiday_manage --
    // see permission-service.ts's own ERP_ACTION_ROLES comment on why
    // every module extending this table is expected to also extend its
    // own integrity tests, rather than leaving them to silently drift.
    const expected: ErpAction[] = [
      "erp.fixed_assets.create",
      "erp.fixed_assets.update",
      "erp.fixed_assets.movement",
      "erp.fixed_assets.category_manage",
      "erp.fixed_assets.capitalize",
      "erp.fixed_assets.depreciation_run",
      "erp.fixed_assets.dispose",
      "erp.sales_orders.create",
      "erp.sales_orders.update_status",
      "erp.quotations.create",
      "erp.quotations.revise",
      "erp.quotations.convert",
      "erp.quotations.update_status",
      "erp.quotations.approve",
      "erp.hr_attendance.mark_other",
      "erp.hr_attendance.holiday_manage",
      // General Ledger / Journal Entries
      "erp.general_ledger.create",
      "erp.general_ledger.submit",
      // Chart of Accounts
      "erp.chart_of_accounts.create",
      // Fiscal Year & Periods
      "erp.fiscal_year.create",
      "erp.fiscal_year.generate_periods",
      "erp.fiscal_year.close_period",
      "erp.fiscal_year.reopen_period",
      "erp.fiscal_year.sign_off_period",
      "erp.fiscal_year.checklist_add",
      "erp.fiscal_year.checklist_complete",
      // Banking / Bank Reconciliation
      "erp.banking.import",
      "erp.banking.match",
      "erp.banking.ignore",
    ]
    for (const action of expected) {
      expect(typeof ERP_ACTION_ROLES[action]).toBe("string")
    }
  })

  test("the elevated (manager-gated) actions are exactly the ones that touch the GL, dispose an asset, reverse a commitment, or correct/manage another employee's HR records", () => {
    const managerGated = (Object.keys(ERP_ACTION_ROLES) as ErpAction[]).filter((a) => ERP_ACTION_ROLES[a] === "manager")
    expect(managerGated.sort()).toEqual([
      "erp.chart_of_accounts.create",
      "erp.fixed_assets.capitalize",
      "erp.fixed_assets.category_manage",
      "erp.fixed_assets.depreciation_run",
      "erp.fixed_assets.dispose",
      "erp.fiscal_year.checklist_add",
      "erp.fiscal_year.checklist_complete",
      "erp.fiscal_year.close_period",
      "erp.fiscal_year.create",
      "erp.fiscal_year.generate_periods",
      "erp.fiscal_year.reopen_period",
      "erp.fiscal_year.sign_off_period",
      "erp.general_ledger.submit",
      "erp.banking.match",
      "erp.hr_attendance.mark_other",
      "erp.hr_attendance.holiday_manage",
      "erp.quotations.approve",
      "erp.sales_orders.update_status",
    ].sort())
  })
})

describe("requirePermissionForUser -- session-only (requireAuth) routes, e.g. every native /api/erp/fixed-assets/** route", () => {
  test("a member-gated action (create) refuses a viewer-rank user", () => {
    expect(requirePermissionForUser(userWithRole("viewer"), "erp.fixed_assets.create")).not.toBeNull()
  })

  test("a member-gated action (create) allows a member-rank user", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.fixed_assets.create")).toBeNull()
  })

  test("a manager-gated action (dispose) refuses a member-rank user -- the exact real-world case the review flagged: a data-entry clerk should not be able to dispose an asset", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.fixed_assets.dispose")).not.toBeNull()
  })

  test("a manager-gated action (dispose) allows a manager-rank user", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.fixed_assets.dispose")).toBeNull()
  })

  test("a manager-gated action (dispose) allows every role at or above manager rank, matching ROLE_RANK's own ordering", () => {
    const rolesManagerOrAbove: UserRole[] = ["manager", "senior_professional", "branch_manager", "admin", "veridian_admin"]
    for (const role of rolesManagerOrAbove) {
      expect(requirePermissionForUser(userWithRole(role), "erp.fixed_assets.dispose")).toBeNull()
    }
  })

  test("a manager-gated action refuses every role below manager rank", () => {
    const rolesBelowManager: UserRole[] = ["viewer", "client_viewer", "external_auditor", "member", "team_member"]
    for (const role of rolesBelowManager) {
      expect(requirePermissionForUser(userWithRole(role), "erp.fixed_assets.capitalize")).not.toBeNull()
    }
  })

  test("a null dbUser (no session) is always refused, even for a member-gated action", () => {
    expect(requirePermissionForUser(null, "erp.fixed_assets.create")).not.toBeNull()
  })

  test("an unregistered action throws instead of silently allowing everything through", () => {
    expect(() => requirePermissionForUser(userWithRole("veridian_admin"), "erp.fixed_assets.not_a_real_action" as ErpAction)).toThrow()
  })
})

describe("requirePermission -- CombinedAuthContext (requireAuthOrApiKey) routes, e.g. every /api/v1/projexa/* alias", () => {
  test("a real session at the required rank is allowed", () => {
    expect(requirePermission(sessionCtx("manager"), "erp.sales_orders.update_status")).toBeNull()
  })

  test("the real gap this wave closes: a member-rank session can no longer push a sales order through every status transition (e.g. cancelling a confirmed order) -- only manager rank or above can now", () => {
    expect(requirePermission(sessionCtx("member"), "erp.sales_orders.update_status")).not.toBeNull()
    expect(requirePermission(sessionCtx("manager"), "erp.sales_orders.update_status")).toBeNull()
  })

  test("a write-scoped API key is allowed through a member-gated action (create), matching requireRoleOrScope's own documented API-key behavior", () => {
    expect(requirePermission(apiKeyCtx(["write"]), "erp.quotations.create")).toBeNull()
  })

  test("a read-only-scoped API key is refused a write action even though the action's minimum role is only member", () => {
    expect(requirePermission(apiKeyCtx(["read"]), "erp.quotations.create")).not.toBeNull()
  })

  test("documents a real, pre-existing limitation this wave does not change: requireRoleOrScope's API-key branch checks write-scope only, not rank, so a write-scoped API key currently passes even a manager-gated action -- this is why quotations/[id]/route.ts's own 'approved' transition adds an EXTRA explicit ctx.dbUser-required check on top of requireRoleOrScope for that one transition (see that route's own comment), and why PROJEXA-IDENTITY-BRIDGE-01 in CONTROLLER.yaml tracks this as a separate, not-yet-decided architecture gap. requirePermission()/requireRoleOrScope() alone do not close this -- a caller gating a manager-only action against a route also reachable by a shared API key must add that same explicit dbUser check itself, the same way quotations already does.", () => {
    expect(requirePermission(apiKeyCtx(["write"]), "erp.quotations.approve")).toBeNull()
  })

  test("neither a session nor an API key present is refused", () => {
    expect(requirePermission({ orgId: null, dbUser: null, apiKey: null, response: null }, "erp.quotations.create")).not.toBeNull()
  })
})

// --- wave4-erp-rbac-batch1 tests: General Ledger, Chart of Accounts, Fiscal Year & Periods, Banking ---

describe("General Ledger / Journal Entries -- RBAC", () => {
  test("member is allowed to create a draft journal entry (member-gated)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.general_ledger.create")).toBeNull()
  })

  test("member is blocked from submitting a journal entry to the GL (manager-gated)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.general_ledger.submit")).not.toBeNull()
  })

  test("manager is allowed to submit a journal entry to the GL", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.general_ledger.submit")).toBeNull()
  })

  test("projexa (CombinedAuthContext): member session can create a draft journal entry", () => {
    expect(requirePermission(sessionCtx("member"), "erp.general_ledger.create")).toBeNull()
  })

  test("projexa (CombinedAuthContext): member session is blocked from submitting to GL", () => {
    expect(requirePermission(sessionCtx("member"), "erp.general_ledger.submit")).not.toBeNull()
  })
})

describe("Chart of Accounts -- RBAC", () => {
  test("member is blocked from creating a GL account (manager-gated master data)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.chart_of_accounts.create")).not.toBeNull()
  })

  test("manager is allowed to create a GL account", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.chart_of_accounts.create")).toBeNull()
  })
})

describe("Fiscal Year & Periods -- RBAC", () => {
  test("member is blocked from creating a fiscal year (manager-gated)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.fiscal_year.create")).not.toBeNull()
  })

  test("manager is allowed to create a fiscal year", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.fiscal_year.create")).toBeNull()
  })

  test("member is blocked from closing a period (manager-gated)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.fiscal_year.close_period")).not.toBeNull()
  })

  test("manager is allowed to close a period", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.fiscal_year.close_period")).toBeNull()
  })

  test("member is blocked from reopening a period (manager-gated)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.fiscal_year.reopen_period")).not.toBeNull()
  })

  test("manager is allowed to reopen a period", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.fiscal_year.reopen_period")).toBeNull()
  })

  test("member is blocked from signing off a period (manager-gated)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.fiscal_year.sign_off_period")).not.toBeNull()
  })

  test("manager is allowed to sign off a period", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.fiscal_year.sign_off_period")).toBeNull()
  })
})

describe("Banking / Bank Reconciliation -- RBAC", () => {
  test("member is allowed to import a bank statement (member-gated routine data entry)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.banking.import")).toBeNull()
  })

  test("member is blocked from matching a bank line (manager-gated)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.banking.match")).not.toBeNull()
  })

  test("manager is allowed to match a bank line", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.banking.match")).toBeNull()
  })

  test("member is allowed to ignore a bank line (member-gated)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.banking.ignore")).toBeNull()
  })
})
