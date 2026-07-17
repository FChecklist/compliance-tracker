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
      // Wave 4 batch 2 -- 11 modules
      "erp.cash_accounts.create",
      "erp.cash_vouchers.create_and_post",
      "erp.cost_centers.create",
      "erp.sales_invoices.create",
      "erp.sales_invoices.submit",
      "erp.sales_invoices.e_invoice",
      "erp.purchase_orders.create",
      "erp.goods_receipts.create",
      "erp.goods_receipts.submit",
      "erp.goods_receipts.putaway",
      "erp.goods_receipts.landed_costs",
      "erp.goods_receipts.update_putaway",
      "erp.rfqs.create",
      "erp.rfqs.send",
      "erp.supplier_quotations.create",
      "erp.sales_credit_notes.create",
      "erp.sales_credit_notes.submit",
      "erp.sales_credit_notes.link_return",
      "erp.purchase_credit_notes.create",
      "erp.purchase_credit_notes.submit",
      "erp.purchase_credit_notes.link_return",
      "erp.inventory.issue",
      "erp.inventory.receipt",
      "erp.inventory.abc_classification",
      "erp.inventory.cycle_count",
      "erp.inventory.cycle_count_plan",
      "erp.inventory.reorder_level",
    ]
    for (const action of expected) {
      expect(typeof ERP_ACTION_ROLES[action]).toBe("string")
    }
  })

  test("the elevated (manager-gated) actions are exactly the ones that touch the GL, dispose an asset, reverse a commitment, or correct/manage another employee's HR records", () => {
    const managerGated = (Object.keys(ERP_ACTION_ROLES) as ErpAction[]).filter((a) => ERP_ACTION_ROLES[a] === "manager")
    expect(managerGated.sort()).toEqual([
      "erp.cash_vouchers.create_and_post",
      "erp.fixed_assets.capitalize",
      "erp.fixed_assets.category_manage",
      "erp.fixed_assets.depreciation_run",
      "erp.fixed_assets.dispose",
      "erp.goods_receipts.landed_costs",
      "erp.goods_receipts.submit",
      "erp.hr_attendance.holiday_manage",
      "erp.hr_attendance.mark_other",
      "erp.purchase_credit_notes.submit",
      "erp.quotations.approve",
      "erp.sales_credit_notes.submit",
      "erp.sales_invoices.submit",
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

  // --- Wave 4 batch 2: per-module member-allowed and member-blocked tests ---

  // Cash Management: member can create cash accounts
  test("wave4-b2: cash_accounts.create allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.cash_accounts.create")).toBeNull()
  })
  // Cash Management: member cannot create-and-post cash vouchers (posts to GL)
  test("wave4-b2: cash_vouchers.create_and_post blocks member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.cash_vouchers.create_and_post")).not.toBeNull()
  })

  // Cost Centers: member can create cost centers
  test("wave4-b2: cost_centers.create allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.cost_centers.create")).toBeNull()
  })

  // Sales Invoices: member can create (draft)
  test("wave4-b2: sales_invoices.create allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.sales_invoices.create")).toBeNull()
  })
  // Sales Invoices: member cannot submit (posts to GL)
  test("wave4-b2: sales_invoices.submit blocks member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.sales_invoices.submit")).not.toBeNull()
  })

  // Purchase Orders: member can create (draft)
  test("wave4-b2: purchase_orders.create allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.purchase_orders.create")).toBeNull()
  })

  // Goods Receipts: member can create (draft)
  test("wave4-b2: goods_receipts.create allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.goods_receipts.create")).toBeNull()
  })
  // Goods Receipts: member cannot submit (posts FIFO stock)
  test("wave4-b2: goods_receipts.submit blocks member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.goods_receipts.submit")).not.toBeNull()
  })
  // Goods Receipts: member cannot create landed cost (affects valuation)
  test("wave4-b2: goods_receipts.landed_costs blocks member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.goods_receipts.landed_costs")).not.toBeNull()
  })

  // RFQs: member can create and send
  test("wave4-b2: rfqs.create allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.rfqs.create")).toBeNull()
  })
  test("wave4-b2: rfqs.send allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.rfqs.send")).toBeNull()
  })

  // Supplier Quotations: member can create
  test("wave4-b2: supplier_quotations.create allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.supplier_quotations.create")).toBeNull()
  })

  // Sales Credit Notes: member can create (draft)
  test("wave4-b2: sales_credit_notes.create allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.sales_credit_notes.create")).toBeNull()
  })
  // Sales Credit Notes: member cannot submit (posts reversing GL)
  test("wave4-b2: sales_credit_notes.submit blocks member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.sales_credit_notes.submit")).not.toBeNull()
  })

  // Purchase Credit Notes: member can create (draft)
  test("wave4-b2: purchase_credit_notes.create allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.purchase_credit_notes.create")).toBeNull()
  })
  // Purchase Credit Notes: member cannot submit (posts reversing GL)
  test("wave4-b2: purchase_credit_notes.submit blocks member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.purchase_credit_notes.submit")).not.toBeNull()
  })

  // Inventory: member can issue, receive, classify, count, plan, set reorder levels
  test("wave4-b2: inventory.issue allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.inventory.issue")).toBeNull()
  })
  test("wave4-b2: inventory.receipt allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.inventory.receipt")).toBeNull()
  })
  test("wave4-b2: inventory.abc_classification allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.inventory.abc_classification")).toBeNull()
  })
  test("wave4-b2: inventory.cycle_count allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.inventory.cycle_count")).toBeNull()
  })
  test("wave4-b2: inventory.cycle_count_plan allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.inventory.cycle_count_plan")).toBeNull()
  })
  test("wave4-b2: inventory.reorder_level allows member", () => {
    expect(requirePermissionForUser(userWithRole("member"), "erp.inventory.reorder_level")).toBeNull()
  })

  // Manager-gated actions allow manager
  test("wave4-b2: cash_vouchers.create_and_post allows manager", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.cash_vouchers.create_and_post")).toBeNull()
  })
  test("wave4-b2: sales_invoices.submit allows manager", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.sales_invoices.submit")).toBeNull()
  })
  test("wave4-b2: goods_receipts.submit allows manager", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.goods_receipts.submit")).toBeNull()
  })
  test("wave4-b2: goods_receipts.landed_costs allows manager", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.goods_receipts.landed_costs")).toBeNull()
  })
  test("wave4-b2: sales_credit_notes.submit allows manager", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.sales_credit_notes.submit")).toBeNull()
  })
  test("wave4-b2: purchase_credit_notes.submit allows manager", () => {
    expect(requirePermissionForUser(userWithRole("manager"), "erp.purchase_credit_notes.submit")).toBeNull()
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
