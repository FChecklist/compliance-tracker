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
    //
    // Extended again by Wave 4 Track 2 (General Ledger / Journal Entries,
    // Chart of Accounts, Fiscal Year & Periods, Banking) -- same
    // expectation: every new action this track registers is listed here
    // so the integrity check stays complete.
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
      // Wave 4 Track 2 additions:
      "erp.journal_entries.create",
      "erp.journal_entries.submit",
      "erp.chart_of_accounts.create",
      "erp.fiscal_years.create",
      "erp.fiscal_periods.generate",
      "erp.fiscal_periods.close",
      "erp.fiscal_periods.reopen",
      "erp.fiscal_periods.sign_off",
      "erp.fiscal_periods.checklist_complete",
      "erp.banking.import_statement",
      "erp.banking.match_line",
      "erp.banking.ignore_line",
    ]
    for (const action of expected) {
      expect(typeof ERP_ACTION_ROLES[action]).toBe("string")
    }
  })

  test("the elevated (manager-gated) actions are exactly the ones that touch the GL, dispose an asset, reverse a commitment, or correct/manage another employee's HR records", () => {
    const managerGated = (Object.keys(ERP_ACTION_ROLES) as ErpAction[]).filter((a) => ERP_ACTION_ROLES[a] === "manager")
    expect(managerGated.sort()).toEqual([
      "erp.fixed_assets.capitalize",
      "erp.fixed_assets.category_manage",
      "erp.fixed_assets.depreciation_run",
      "erp.fixed_assets.dispose",
      "erp.quotations.approve",
      "erp.sales_orders.update_status",
      "erp.hr_attendance.mark_other",
      "erp.hr_attendance.holiday_manage",
      // Wave 4 Track 2 additions:
      "erp.journal_entries.submit",        // posts the entry to the GL
      "erp.chart_of_accounts.create",      // master-data configuration
      "erp.fiscal_years.create",            // fiscal calendar configuration
      "erp.fiscal_periods.generate",        // period grid configuration
      "erp.fiscal_periods.close",           // period lock -- hard to undo
      "erp.fiscal_periods.sign_off",        // period sign-off attestation
      "erp.fiscal_periods.checklist_complete", // close-step attestation
    ].sort())
  })

  test("the admin-gated actions are exactly the ones even more sensitive than the manager bar -- currently only reopening a closed accounting period, which reopens the books", () => {
    // Wave 4 Track 2: a new tier-integrity check for the admin-gated set.
    // erp.fiscal_periods.reopen is the only entry so far that sits ABOVE
    // the manager bar (the existing /api/erp/periods/[id]/reopen route
    // already required "admin" inline; that stricter bar is preserved
    // here rather than loosened to "manager" just to fit the runbook's
    // "member or manager" framing -- see permission-service.ts's own
    // comment and the PR's STEP 9 notes for the deviation rationale).
    const adminGated = (Object.keys(ERP_ACTION_ROLES) as ErpAction[]).filter((a) => ERP_ACTION_ROLES[a] === "admin")
    expect(adminGated.sort()).toEqual([
      "erp.fiscal_periods.reopen",
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

// Wave 4 Track 2 (VERIDIAN Review Framework remediation): per-module test
// blocks for the five modules this track added RBAC gates to -- General
// Ledger / Journal Entries, Chart of Accounts, Fiscal Year & Periods,
// Banking. Each block exercises the two directions of its gate per the
// runbook's "at least 2 tests: one proving a member-role user IS allowed
// to do a member-level action, one proving a member-role user is BLOCKED
// from a manager-level action" rule, adapted where a module has no
// member-level actions (test manager-allowed + member-blocked instead) or
// no manager-level actions (test member-allowed + viewer-blocked instead).
// Modules 5 (Accounts Payable) and 6 (Accounts Receivable) are not
// represented here -- no such dedicated module exists in this codebase;
// see the PR's STEP 9 notes.

describe("Wave 4 Track 2 -- General Ledger / Journal Entries (modules 1 & 4 share the journal-entries routes in this codebase)", () => {
  test("a member-rank user IS allowed to create a draft journal entry (member-gated, routine data entry, does not post to GL)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.journal_entries.create")).toBeNull()
  })

  test("a member-rank user is BLOCKED from submitting (posting) a journal entry to the GL (manager-gated, financially final)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.journal_entries.submit")).not.toBeNull()
  })

  test("a manager-rank user IS allowed to submit a journal entry (the action that actually posts to the GL)", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.journal_entries.submit")).toBeNull()
  })

  test("the PROJEXA alias POST /api/v1/projexa/journal-entries is now gated at member (not the previous inline manager) for create -- a member-rank session passes", () => {
    // Real gap this track closes: the previous inline requireRoleOrScope(ctx,
    // "manager", "write") literal was an outlier vs. every other module's
    // create action in this table (all "member" for the draft step);
    // routing through ERP_ACTION_ROLES aligns the PROJEXA alias with that
    // established pattern. See the route file's own comment for full rationale.
    expect(requirePermission(sessionCtx("member"), "erp.journal_entries.create")).toBeNull()
  })
})

describe("Wave 4 Track 2 -- Chart of Accounts (module 2; lives at /api/erp/accounts/)", () => {
  // All actions in this module are manager-gated (master-data configuration),
  // so the runbook's "member allowed on a member-level action" test is
  // adapted to "manager allowed on the manager-level action" -- the
  // equivalent positive-direction test for an all-manager module.
  test("a manager-rank user IS allowed to create a GL account (master-data configuration, matches fixed_assets.category_manage precedent)", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.chart_of_accounts.create")).toBeNull()
  })

  test("a member-rank user is BLOCKED from creating a GL account (defining account mappings is not routine data entry)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.chart_of_accounts.create")).not.toBeNull()
  })

  test("a viewer-rank user is BLOCKED from creating a GL account (below the manager bar)", () => {
    expect(requirePermissionForUser(userWithRole("viewer"), "erp.chart_of_accounts.create")).not.toBeNull()
  })
})

describe("Wave 4 Track 2 -- Fiscal Year & Periods (module 3)", () => {
  test("a member-rank user is BLOCKED from creating a fiscal year (manager-gated configuration)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.fiscal_years.create")).not.toBeNull()
  })

  test("a member-rank user is BLOCKED from closing a period (manager-gated, hard-to-undo lock)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.fiscal_periods.close")).not.toBeNull()
  })

  test("a manager-rank user IS allowed to close a period", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.fiscal_periods.close")).toBeNull()
  })

  test("a manager-rank user is BLOCKED from REOPENING a closed period -- this action requires admin rank, stricter than the runbook's manager bar, preserving the existing inline policy", () => {
    // The runbook's "member or manager" framing is the common case, not a
    // strict ceiling. Reopening a closed accounting period reopens the
    // books and is one of the most sensitive actions in any ERP; the
    // existing /api/erp/periods/[id]/reopen route already required "admin"
    // inline, and this track preserves that stricter bar rather than
    // loosening it to "manager". See the PR's STEP 9 notes for rationale.
    expect(requirePermissionForUser(userWithRole("manager"), "erp.fiscal_periods.reopen")).not.toBeNull()
  })

  test("an admin-rank user IS allowed to reopen a closed period", () => {
    expect(requirePermissionForUser(userWithRole("admin"), "erp.fiscal_periods.reopen")).toBeNull()
  })
})

describe("Wave 4 Track 2 -- Banking / Bank Reconciliation (module 7; all member-gated routine reconciliation data entry)", () => {
  // All actions in this module are member-gated (routine data entry, no GL
  // posting, no money movement -- verified by reading the service). The
  // runbook's "member blocked from a manager-level action" test is adapted
  // to "viewer blocked from the member-level action" -- the equivalent
  // negative-direction test for an all-member module (the bar below
  // "member" is "viewer").
  test("a member-rank user IS allowed to import a bank statement (routine data entry, does not post to GL)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.banking.import_statement")).toBeNull()
  })

  test("a member-rank user IS allowed to match a bank line to an existing JE (routine reconciliation, doesn't move money)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.banking.match_line")).toBeNull()
  })

  test("a member-rank user IS allowed to ignore an unmatched bank line (routine reconciliation cleanup)", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.banking.ignore_line")).toBeNull()
  })

  test("a viewer-rank user is BLOCKED from importing a bank statement (below the member bar -- viewer is read-only by design)", () => {
    expect(requirePermissionForUser(userWithRole("viewer"), "erp.banking.import_statement")).not.toBeNull()
  })
})
