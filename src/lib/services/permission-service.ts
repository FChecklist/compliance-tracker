// VERIDIAN Review Framework remediation (2026-07-17): 21 of the review's
// Weight-5/High "Access Control / Role-Based Permissions" findings across
// ERP & Finance Modules are the SAME underlying gap repeated module by
// module -- routes correctly scope every query to the caller's orgId
// (tenant isolation is real, via requireAuth()/requireAuthOrApiKey() +
// withTenantContext's RLS) but never check whether the caller's ROLE
// actually permits the specific action, only that they belong to the org.
// A freshly-invited data-entry clerk (role: 'member') can currently hit the
// same write endpoints as an admin, because nothing in between checks role.
//
// This file is deliberately NOT a new role system. This codebase already
// has one real one -- src/lib/supabase/auth-guard.ts's 10-value UserRole
// enum, ROLE_RANK, hasRole()/requireRole() (session-only AuthContext) and
// requireRoleOrScope() (the CombinedAuthContext equivalent for routes
// reachable by both a session AND a write-scoped API key, e.g. every
// /api/v1/projexa/* alias). That primitive is correct and already used
// throughout the app (fixed assets' own disposal route, quotation
// approval, payment-entry decisions, HR roster assignment, etc.) -- see
// grep hits for requireRole/requireRoleOrScope across src/app/api before
// assuming otherwise.
//
// What is genuinely missing, and what this file actually adds: a SINGLE
// place that states which minimum role a given ERP action requires, so
// that policy is not re-typed ad hoc as a bare manager/admin string
// literal inline in 20+ separate route files (which is exactly how the
// bug class this review flagged happens in the first place -- a route gets
// added, the author forgets the string literal, nothing catches it). Every
// other tracked workstream picking up the remaining 18 modules (General
// Ledger, Chart of Accounts, Accounts Payable, etc. -- see
// ai-os/boss/ACTIVE-CLAIMS.yaml / CONTROLLER.yaml REVIEW-FRAMEWORK-WAVE4)
// is expected to IMPORT requirePermission/requirePermissionForUser and ADD
// its own module's actions to ERP_ACTION_ROLES below, not build a second
// gate function or a second role system.
//
// Shape chosen to match this codebase's own dominant idiom (confirmed by
// reading the real v1/projexa quotations/sales-orders routes and the
// fixed-assets disposal route before writing this): an action-string key
// (e.g. erp.fixed_assets.dispose) mapped to a minimum UserRole, resolved
// through the EXISTING requireRole()/requireRoleOrScope() primitives --
// never a bespoke rank comparison reimplemented here.
import type { NextResponse } from "next/server"
import {
  requireRole,
  requireRoleOrScope,
  type UserRole,
  type AuthContext,
  type CombinedAuthContext,
} from "@/lib/supabase/auth-guard"

/**
 * The single source of truth for "what minimum role does this ERP action
 * require". Deliberately a flat Record<string, UserRole>, not a nested
 * per-module object -- every action is looked up by its own fully-qualified
 * key (module.action), so two modules can never accidentally share (or
 * shadow) an entry, and a search for "erp.sales_orders." finds every
 * policy for one module in one shot.
 *
 * Policy reasoning (construction/interior-design firm, ~100 employees /
 * ~500 concurrent projects -- matching this codebase's own established
 * sizing target, not a toy scale):
 * - create/revise/convert/update_status(quotations)-type actions stay at
 *   "member" -- the baseline rank above viewer/client_viewer/
 *   external_auditor (ROLE_RANK 1). A viewer-tier account was never able
 *   to write here before this change either (every one of these routes
 *   already required a real dbUser session or a write-scoped API key) --
 *   gating writes at "member" additionally excludes the 3 read-only-by-
 *   design roles, which is what "viewer" is for. Pure list/get reads are
 *   intentionally left ungated by role below (org-scope via
 *   requireAuth()/requireAuthOrApiKey() is the only check) -- a viewer
 *   role that could not view anything would be pointless, and no GET
 *   route anywhere else in this codebase gates reads on role either.
 * - Anything that commits money, posts to the GL, or is hard/impossible to
 *   cleanly reverse (capitalizing an asset, running depreciation, disposing
 *   an asset, cancelling/confirming a sales order, approving a quotation
 *   that is about to be sent to a customer) requires "manager" -- this
 *   matches every existing precedent already in this codebase (fixed
 *   assets own disposal gate, the quotation approved transition, payment
 *   entry approval canDecidePaymentEntry, the sales-orders bulk-status
 *   route) rather than inventing a new bar.
 * - Category/master-data configuration that defines GL account mappings
 *   (asset categories: which Balance Sheet/P&L accounts an entire class of
 *   assets posts to) is "manager" -- a data-entry clerk should be able to
 *   log a purchased laptop, not redefine which GL account every laptop in
 *   the company posts depreciation against.
 */
export const ERP_ACTION_ROLES = {
  // Fixed Assets (VERIDIAN Review Framework: Critical -- RBAC + business rules)
  "erp.fixed_assets.create": "member",
  "erp.fixed_assets.update": "member",
  "erp.fixed_assets.movement": "member",
  "erp.fixed_assets.category_manage": "manager",
  "erp.fixed_assets.capitalize": "manager",
  "erp.fixed_assets.depreciation_run": "manager",
  "erp.fixed_assets.dispose": "manager",

  // Sales Orders (VERIDIAN Review Framework: Critical -- RBAC only)
  "erp.sales_orders.create": "member",
  // Real gap this wave closes: the single-record PATCH
  // (/api/v1/projexa/sales-orders/[id]) previously gated every status
  // transition (including cancelling a confirmed order) at "member",
  // while its own sibling bulk-status route already required "manager"
  // for the identical operation -- an inconsistency between two routes
  // performing the same write, not a deliberately lower bar. This entry
  // brings both routes to the same, already-established "manager" policy.
  "erp.sales_orders.update_status": "manager",

  // Quotations (VERIDIAN Review Framework: Critical -- RBAC only). Create/
  // revise/convert already correctly sat at "member" (converting only
  // happens from a sent quotation, which can only be reached once the
  // approved transition below was already manager-gated -- so convert
  // is not a fresh privilege escalation). No behavior change for
  // quotations; existing inline checks are routed through this same table
  // for a single source of truth, not duplicated policy.
  "erp.quotations.create": "member",
  "erp.quotations.revise": "member",
  "erp.quotations.convert": "member",
  "erp.quotations.update_status": "member",
  "erp.quotations.approve": "manager",

  // HR Attendance & Manpower (VERIDIAN Review Framework: Critical -- RBAC
  // + business rules, closed in the same wave as this file). Self-service
  // check-in/check-out and marking one's OWN day are handled by identity
  // (targetUserId === ctx.userId), not a role gate -- there is no
  // "erp.hr_attendance.mark_own" entry because that path was never
  // role-restricted in the first place, matching this table's own
  // documented policy of leaving self-service actions ungated by role.
  "erp.hr_attendance.mark_other": "manager", // manager/HR correcting or bulk-marking a DIFFERENT employee's attendance
  "erp.hr_attendance.holiday_manage": "manager", // create/delete a row on the org holiday calendar

  // Cash Management
  "erp.cash_accounts.create": "member", // routine data entry, no money movement
  "erp.cash_vouchers.create_and_post": "manager", // posts to GL and moves money

  // Cost Centers
  "erp.cost_centers.create": "member", // routine reference data entry

  // Sales Invoices
  "erp.sales_invoices.create": "member", // creates draft, not yet posted
  "erp.sales_invoices.submit": "manager", // posts to GL, fires webhook, moves money
  "erp.sales_invoices.e_invoice": "member", // generates e-invoice payload, no GL posting

  // Purchase Orders
  "erp.purchase_orders.create": "member", // creates draft PO, not yet committed

  // Goods Receipts (Purchase Receipts)
  "erp.goods_receipts.create": "member", // creates draft receipt, stock not yet posted
  "erp.goods_receipts.submit": "manager", // posts real FIFO stock, updates PO status
  "erp.goods_receipts.putaway": "member", // routine warehouse physical operation
  "erp.goods_receipts.landed_costs": "manager", // affects inventory valuation, hard to undo
  "erp.goods_receipts.update_putaway": "member", // routine warehouse location update

  // RFQs
  "erp.rfqs.create": "member", // routine procurement data entry
  "erp.rfqs.send": "member", // changes status to sent, no financial impact

  // Supplier Quotations
  "erp.supplier_quotations.create": "member", // routine procurement data entry

  // Sales Credit Notes
  "erp.sales_credit_notes.create": "member", // creates draft, not yet posted
  "erp.sales_credit_notes.submit": "manager", // posts reversing GL entries, moves money
  "erp.sales_credit_notes.link_return": "member", // just a link/association, no GL posting

  // Purchase Credit Notes
  "erp.purchase_credit_notes.create": "member", // creates draft, not yet posted
  "erp.purchase_credit_notes.submit": "manager", // posts reversing GL entries, affects AP
  "erp.purchase_credit_notes.link_return": "member", // just a link/association, no GL posting

  // Inventory & Materials
  "erp.inventory.issue": "member", // FIFO stock out, routine warehouse operation
  "erp.inventory.receipt": "member", // FIFO stock in, routine warehouse operation
  "erp.inventory.abc_classification": "member", // analytical computation, no financial commitment
  "erp.inventory.cycle_count": "member", // records physical count, does not post to GL
  "erp.inventory.cycle_count_plan": "member", // routine planning data entry
  "erp.inventory.reorder_level": "member", // routine planning configuration
} as const satisfies Record<string, UserRole>

export type ErpAction = keyof typeof ERP_ACTION_ROLES

function roleFor(action: ErpAction): UserRole {
  const role = ERP_ACTION_ROLES[action]
  if (!role) {
    // Fails closed, not open: an action key that was never registered is
    // treated as a bug in the calling route (typo, or a new action that
    // forgot to add its policy here), not as "no restriction". Matches
    // this codebase's own fail-closed-on-missing-config posture for
    // security-relevant gates (see e.g. requireErpEnabled).
    throw new Error(`permission-service: unknown ERP action "${action}" -- add it to ERP_ACTION_ROLES before gating a route with it`)
  }
  return role
}

/**
 * The CombinedAuthContext (requireAuthOrApiKey) gate -- for routes reachable
 * by both a real session AND a write-scoped API key (every /api/v1/projexa/*
 * alias). Thin wrapper over requireRoleOrScope(): looks up the action's
 * minimum role from ERP_ACTION_ROLES instead of a route-local string
 * literal. Identical semantics to calling requireRoleOrScope() directly --
 * this does not change how API-key callers are evaluated (still
 * write-scope-only, no per-key role concept, exactly as documented on
 * requireRoleOrScope itself).
 *
 * Known, pre-existing, honestly-inherited limitation (not introduced or
 * fixed by this file -- see permission-service.test.ts's own test for
 * this): requireRoleOrScope's API-key branch checks write-scope only, not
 * rank, so a shared write-scoped API key (e.g. PROJEXA's single org-wide
 * key, used by every PROJEXA user) currently passes even a manager-gated
 * action through this function alone. A route that must fully close that
 * gap for one specific transition (e.g. quotations' "approved" status
 * change) adds its own EXTRA explicit `if (!ctx.dbUser) return ...`
 * check on top of requirePermission()/requireRoleOrScope() -- see
 * src/app/api/v1/projexa/quotations/[id]/route.ts for the precedent this
 * follows. Tracked as its own architecture item, PROJEXA-IDENTITY-BRIDGE-01
 * in CONTROLLER.yaml -- out of scope for this utility to silently solve.
 */
export function requirePermission(
  ctx: CombinedAuthContext,
  action: ErpAction,
  writeScope: "read" | "write" = "write"
): NextResponse | null {
  return requireRoleOrScope(ctx, roleFor(action), writeScope)
}

/**
 * The plain-session (requireAuth) gate -- for routes that only ever accept
 * a real logged-in user, never an API key (every native /api/erp/fixed-assets/**
 * route today). Thin wrapper over requireRole().
 */
export function requirePermissionForUser(
  dbUser: AuthContext["dbUser"],
  action: ErpAction
): NextResponse | null {
  return requireRole(dbUser, roleFor(action))
}
