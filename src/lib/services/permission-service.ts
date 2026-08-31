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
  hasRole,
  requireRole,
  requireRoleOrScope,
  type UserRole,
  type AuthContext,
  type CombinedAuthContext,
} from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"

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
  // General Ledger / Journal Entries (VERIDIAN Review Framework Wave 4,
  // Track 2 -- RBAC only). This codebase consolidates General Ledger
  // posting into the journal-entries module (there is no separate
  // general-ledger/ file path -- a journal entry IS the GL posting unit,
  // created as a draft and then submitted to actually post). Modules 1
  // (General Ledger) and 4 (Journal Entries) in the runbook therefore
  // share this single set of entries and the same route files.
  // Create = "member": a draft entry is routine data entry, does NOT post
  // to the GL (see erp-accounting-service.ts's createJournalEntry -- it
  // only inserts a row in status "draft"). Submit = "manager": this is
  // the action that actually posts the entry to the GL, is hard to
  // cleanly reverse (reversal needs a fresh reversing JE, not an edit),
  // and is gated by the accounting-period lock on top of this role gate.
  // Note: the existing inline requireRoleOrScope(ctx, "manager", "write")
  // on /api/v1/projexa/journal-entries POST was an outlier vs. the rest
  // of this table (every other module's create action -- fixed_assets,
  // sales_orders, quotations -- is "member" for the draft step); routing
  // it through this table aligns the PROJEXA alias with that established
  // pattern. Tracked in the route file's own comment.
  "erp.journal_entries.create": "member", // create a DRAFT journal entry -- routine data entry, does not post to GL
  "erp.journal_entries.submit": "manager", // submit/post the entry to the GL -- financially final, hard to reverse cleanly

  // Chart of Accounts (VERIDIAN Review Framework Wave 4, Track 2 -- RBAC
  // only). Lives at /api/erp/accounts/ (the route file's own comments
  // call it "chart of accounts"; there is no separate chart-of-accounts/
  // file path in this codebase). The PROJEXA alias at
  // /api/v1/projexa/accounts/ is read-only (GET only) for this wave -- no
  // role gate needed there. Account creation defines GL account mappings
  // (which account an entire class of transactions posts to) -- this is
  // master-data configuration, NOT routine data entry, so it sits at
  // "manager" matching the established precedent for category/master-data
  // configuration (erp.fixed_assets.category_manage: "manager").
  "erp.chart_of_accounts.create": "manager", // define a new GL account in the chart -- master-data configuration

  // Fiscal Year & Periods (VERIDIAN Review Framework Wave 4, Track 2 --
  // RBAC only). Fiscal-year creation and period generation/close/sign-off
  // are all configuration/attestation actions that shape the books
  // themselves, not routine data entry -- "manager" per this table's own
  // documented rule for actions that are hard to cleanly reverse. The one
  // exception is reopen: the existing /api/erp/periods/[id]/reopen route
  // already required "admin" inline (reopening a closed accounting period
  // reopens the books and is one of the most sensitive actions in any
  // ERP); that stricter bar is preserved here rather than loosened to
  // "manager" just to fit this table's "member or manager" framing --
  // the runbook's rule is a minimum bar, not a maximum. See STEP 9 notes
  // in the PR description for the deviation rationale.
  "erp.fiscal_years.create": "manager", // define the org's fiscal calendar -- configuration
  "erp.fiscal_periods.generate": "manager", // generate the period grid for a fiscal year -- configuration
  "erp.fiscal_periods.close": "manager", // close a period (lock) -- hard to undo, blocks further posting
  "erp.fiscal_periods.reopen": "admin", // reopen a closed period -- reopens the books; existing "admin" bar preserved
  "erp.fiscal_periods.sign_off": "manager", // period sign-off -- financially significant attestation
  "erp.fiscal_periods.checklist_complete": "manager", // complete a period-close checklist item -- manager-level attestation

  // Banking / Bank Reconciliation (VERIDIAN Review Framework Wave 4,
  // Track 2 -- RBAC only). All three write actions are routine
  // reconciliation data entry that does NOT move money or post to the GL
  // (verified by reading erp-bank-reconciliation-service.ts: import just
  // inserts rows into erBankStatementImports/Lines; matchLine/ignoreLine
  // only update the status field on a statement line). The PROJEXA alias
  // at /api/v1/projexa/bank-reconciliation/ is read-only for this wave
  // (see that route file's own comment) -- no role gate needed there.
  "erp.banking.import_statement": "member", // upload a bank statement file -- routine data entry, does not post to GL
  "erp.banking.match_line": "member", // link a bank line to an existing JE -- routine reconciliation, doesn't move money
  "erp.banking.ignore_line": "member", // mark a line as ignored -- routine reconciliation cleanup

  // Sales Pipeline (VERIDIAN Review Framework gap-closure, task-20260718-
  // 082004, 2026-08-07): a single additive key, not a full RBAC pass over
  // CRM leads/opportunities (those routes' own "Access Control" finding, if
  // any, is a separate workstream -- confirmed not in this task's 14
  // findings). Configuring the org's pipeline stage definitions (which
  // stages exist, which are terminal/won/lost) reshapes how every rep's
  // Kanban board and stage-transition validation behaves org-wide -- same
  // "master-data configuration = manager" bar as
  // erp.fixed_assets.category_manage/erp.chart_of_accounts.create above,
  // not routine data entry.
  "crm.pipeline_stages.manage": "manager",
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

// ─── VERIDIAN_Architecture_v2.0 phase_3 (2026-07-26): Permission Engine
// (prompt-lifecycle sense, gap analysis item engine-permission) ──────────
//
// Before this, every prompt-OS write (createPromptVersion/
// transitionPromptLifecycle/rollbackPromptVersion in prompt-os-service.ts,
// createEvalCase/runEval in prompt-eval-service.ts) repeated the exact same
// inline `if (!hasRole(ctx.dbUser, "veridian_admin")) throw ...` five times,
// with no way to name or reason about "access vs. edit vs. approve vs.
// deploy" as distinct permissions the way ERP_ACTION_ROLES above already
// does for ERP actions -- exactly the gap the review-framework header on
// this file describes for ERP, now real for prompts too.
//
// Deliberately does NOT lower any bar below what's live today: every action
// below still resolves to "veridian_admin" (prompt content remains a
// platform-governed asset, same authority bar as publishing a worker agent
// -- see prompt-os-service.ts's own header), because loosening an already-
// enforced gate without the Owner's explicit sign-off is exactly what
// AGENTS.md Rule 9 forbids. What's new is that each action now has its own
// name (so a future role split doesn't require re-plumbing every call
// site) AND that the higher-risk transitions (approve/deploy) get real,
// additional, non-role gates layered on top by
// prompt-governance-service.ts's transitionGate() -- maker-checker,
// eval-threshold, canary-duration, ABAC, PII scan, ownership. Role alone
// answers "can this actor possibly do this"; the governance gate answers
// "is this specific transition allowed right now."
export const PROMPT_ACTION_ROLES = {
  "prompt.version.create": "veridian_admin", // author a new Draft version -- unchanged bar (was inline hasRole check)
  "prompt.version.transition_review": "veridian_admin", // Draft -> Review
  "prompt.version.approve_staging": "veridian_admin", // Review -> Staging (first approval gate)
  "prompt.version.promote_production": "veridian_admin", // Staging -> Production (deploy gate)
  "prompt.version.deprecate": "veridian_admin", // Production -> Deprecated
  "prompt.version.rollback": "veridian_admin", // append a new Draft version restoring an old one's content
  "prompt.template.assign_owner": "veridian_admin", // Governance Engine: assign/change a template's steward
  "prompt.eval.create_case": "veridian_admin", // author an eval case
  "prompt.eval.run": "veridian_admin", // execute an eval case against a version
  // VERIDIAN_Architecture_v2.0 phase_8 (2026-07-28): engine-prompt-
  // translation/-localization/-marketplace/-export/-import. Same
  // veridian_admin bar as every other prompt-OS write above -- prompt
  // content remains a platform-governed asset either way these actions
  // touch it (AGENTS.md Rule 9: not loosened without Owner sign-off).
  "prompt.translation.create": "veridian_admin", // translate a prompt version into another language
  "prompt.localization.create": "veridian_admin", // locale-adapt an existing translation
  "prompt.marketplace.publish": "veridian_admin", // list/unlist a Production version on the marketplace
  "prompt.import.run": "veridian_admin", // ingest an exported prompt bundle
} as const satisfies Record<string, UserRole>

export type PromptAction = keyof typeof PROMPT_ACTION_ROLES

function roleForPrompt(action: PromptAction): UserRole {
  const role = PROMPT_ACTION_ROLES[action]
  if (!role) {
    throw new Error(`permission-service: unknown prompt action "${action}" -- add it to PROMPT_ACTION_ROLES before gating a route/service call with it`)
  }
  return role
}

/**
 * The prompt-OS service-layer gate. Unlike requirePermission()/
 * requirePermissionForUser() above (which return a NextResponse for a route
 * handler to `return`), prompt-os-service.ts/prompt-eval-service.ts are
 * service-layer functions that throw ServiceError (compliance-service.ts's
 * convention, re-exported from every *-service.ts file in this directory)
 * rather than building a NextResponse themselves -- this matches that real
 * calling convention instead of forcing prompt-os-service.ts to unwrap a
 * NextResponse it has no use for.
 */
export function requirePromptPermissionForUser(dbUser: AuthContext["dbUser"], action: PromptAction): void {
  const minimumRole = roleForPrompt(action)
  if (!hasRole(dbUser, minimumRole)) {
    throw new ServiceError(`This action (${action}) requires ${minimumRole} role or higher`, 403)
  }
}
