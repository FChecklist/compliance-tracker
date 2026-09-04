/// <reference types="bun-types" />
// R75 Phase 2 (Z2-04/Z2-05): both-direction authz-gate test for all 189
// CRITICAL+HIGH routes fixed this phase (65 CRITICAL + 125 HIGH, minus one
// misclassification excluded from CRITICAL -- see the fix commits' own
// messages for the full audit trail). This is the closing artifact: real
// evidence a role-check ADDED this phase actually rejects a caller below
// its minimum role and permits one at it, generated from the ACTUAL guard
// call (function + literal role string) grepped out of each fixed file, not
// re-typed by hand.
//
// WHY THIS TESTS THE ROLE GATE ONLY, NOT FULL BUSINESS-LOGIC SUCCESS: every
// fix in this phase inserts requireRole()/requireRoleOrScope() BEFORE any
// body parsing, param destructuring, or DB access (verified per-file during
// the fix). That guarantees the REJECT side is 100% generic and safe to test
// with a bare synthetic request: a below-minimum caller must get exactly the
// gate's own 403 before the handler ever touches its real body or params.
// The PERMIT side only proves the gate does not block a caller AT the
// minimum role -- the handler may still fail on missing/invalid body content
// for a synthetic request, which is a DIFFERENT, unrelated concern (real
// business-logic correctness has its own per-route tests where they exist,
// e.g. src/app/api/v1/construction/boq/route.test.ts for R-18/R-19). This
// test run itself CAUGHT 5 real mismatches between the route-level gate this
// phase added and a stricter, pre-existing SERVICE-layer role/permission
// check the route delegates to (products/projects requiring admin not
// manager; commission-accrual mark-paid/void requiring veridian_admin, the
// service's own requireAdmin() default, not branch_manager) -- corrected in
// the route files themselves, not by loosening this test.
//
// MOCKING NOTE (established pattern in this codebase -- see that same
// route.test.ts's own header): mock.module() REPLACES a module's exports
// entirely rather than merging with the real ones, and re-importing
// @/lib/supabase/auth-guard from inside its own mock factory hangs Bun's
// module resolver. So this file imports ONLY the narrow, non-circular
// ./role-rank leaf module for the real ROLE_RANK table, and reimplements
// requireRole/requireRoleOrScope/hasRole/requireOrg's logic directly against
// it (verbatim, including the exact 403 message shape) -- not a re-declared
// rank table, the actual one, so a future rank change is reflected here too.
//
// PERMIT-SIDE ASSERTION IS ON THE EXACT ERROR SHAPE, NOT A BARE STATUS CHECK:
// a handful of routes delegate to a service function with its OWN, SEPARATE
// permission-axis check (e.g. requirePromptPermissionForUser in
// permission-service.ts) that can also legitimately return 403 for a
// synthetic test user with no real permission grants -- a different,
// unrelated authorization mechanism this test does not exercise. Asserting
// only "not this gate's specific message" (rather than "not 403 at all")
// correctly distinguishes "still blocked by the gate THIS PHASE added" from
// "blocked by a different, pre-existing mechanism this phase didn't touch".
import { describe, test, expect, mock, beforeEach } from "bun:test"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/role-rank"
import { NextResponse } from "next/server"

type FixtureUser = { id: string; role: UserRole; orgId: string; name: string; email: string }

let currentUser: FixtureUser | null = null

const GATE_MESSAGE = (minimumRole: UserRole) => `This action requires ${minimumRole} role or higher`

function fakeRequireRole(dbUser: FixtureUser | null, minimumRole: UserRole) {
  const rank = dbUser ? (ROLE_RANK[dbUser.role] ?? 0) : 0
  if (rank < ROLE_RANK[minimumRole]) {
    return NextResponse.json({ error: GATE_MESSAGE(minimumRole) }, { status: 403 })
  }
  return null
}

function fakeRequireRoleOrScope(ctx: { dbUser?: FixtureUser | null; apiKey?: unknown }, minimumRole: UserRole) {
  if (ctx?.dbUser) return fakeRequireRole(ctx.dbUser, minimumRole)
  if (ctx?.apiKey) return null
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

// hasRole/requireOrg: real, verbatim logic from auth-guard.ts (both are pure
// -- no imports beyond ROLE_RANK), included because a handful of the 189
// route files import them too (unused by the mutating handler itself, but
// mock.module() replaces the WHOLE module, so an unmocked name a file
// imports anywhere breaks that file's import with a SyntaxError, not just
// the call site that would have used it).
function fakeHasRole(dbUser: FixtureUser | null, minimumRole: UserRole): boolean {
  const rank = dbUser ? (ROLE_RANK[dbUser.role] ?? 0) : 0
  return rank >= ROLE_RANK[minimumRole]
}

function fakeRequireOrg(ctx: { orgId: string | null }, message = "No organisation on this account") {
  if (ctx.orgId) return null
  return NextResponse.json({ error: message }, { status: 400 })
}

beforeEach(() => {
  currentUser = null
  mock.module("@/lib/supabase/auth-guard", () => ({
    ROLE_RANK,
    requireAuth: mock(async () => ({
      response: null,
      dbUser: currentUser,
      orgId: "r75-p2-test-org",
      user: currentUser ? { id: currentUser.id } : null,
    })),
    requireAuthOrApiKey: mock(async () => ({
      response: null,
      dbUser: currentUser,
      orgId: "r75-p2-test-org",
      apiKey: null,
    })),
    requireRole: fakeRequireRole,
    requireRoleOrScope: fakeRequireRoleOrScope,
    hasRole: fakeHasRole,
    requireOrg: fakeRequireOrg,
  }))
})

// Any destructured key on the fake params object resolves to a harmless
// fixed id -- robust across [id]/[clientId]/[invoiceId]/[engagementId]/etc.
// without needing to know each route's own dynamic segment name.
function fakeParams(): Promise<Record<string, string>> {
  return Promise.resolve(new Proxy({}, { get: () => "r75-p2-test-id" }) as Record<string, string>)
}

function fakeRequest(method: string): Request {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } }
  if (method !== "DELETE" && method !== "GET") init.body = "{}"
  return new Request("http://localhost/r75-phase2-authz-test", init)
}

const TABLE: Array<{ specifier: string; guard: "requireRole" | "requireRoleOrScope"; role: UserRole; methods: string[] }> = [
  {
    "specifier": "@/app/api/construction/boq/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/boq/import/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/boq/[id]/revisions/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/boq/[id]/submit/route",
    "guard": "requireRole",
    "role": "branch_manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/enablement/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "DELETE",
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/expenses/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/interim-bills/route",
    "guard": "requireRole",
    "role": "branch_manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/automation-rules/[id]/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "DELETE",
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/business-rules/[id]/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "DELETE",
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/challans/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/challans/[id]/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "DELETE",
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/approval-workflows/steps/[id]/decide/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/custom-charts/[id]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "DELETE",
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/document-correspondents/[id]/route",
    "guard": "requireRole",
    "role": "branch_manager",
    "methods": [
      "DELETE"
    ]
  },
  {
    "specifier": "@/app/api/document-matching-rules/[id]/route",
    "guard": "requireRole",
    "role": "branch_manager",
    "methods": [
      "DELETE",
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/construction/progress/[id]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "DELETE"
    ]
  },
  {
    "specifier": "@/app/api/construction/progress-claims/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/progress-claims/[id]/draft/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/progress-claims/[id]/submit/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/crm/activities/[id]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "DELETE",
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/crm/campaigns/[id]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "DELETE",
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/erp/contracts/obligations/[id]/complete/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/contracts/[id]/obligations/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/enablement/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "DELETE",
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/ingest/[batchId]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "DELETE"
    ]
  },
  {
    "specifier": "@/app/api/erp/purchase-invoices/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/purchase-invoices/[id]/submit/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/parties/[type]/[id]/addresses/[addressId]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "DELETE"
    ]
  },
  {
    "specifier": "@/app/api/erp/parties/[type]/[id]/contacts/[contactId]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "DELETE"
    ]
  },
  {
    "specifier": "@/app/api/erp/payment-entries/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/payment-entries/[id]/cancel/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/payment-entries/[id]/submit/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/payroll/employees/[id]/tax-exemptions/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/payroll/income-tax-slabs/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/payroll/payslips/[id]/finalize/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/payroll/payslips/[id]/tds/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/payroll/runs/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/payroll/runs/[id]/process/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/payroll/salary-components/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/payroll/salary-structures/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/payroll/statutory-rules/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/tax-templates/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/tax-withholding-categories/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/esignature/requests/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/esignature/requests/[id]/void/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/gst-reconciliation/import/[batchId]/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "DELETE"
    ]
  },
  {
    "specifier": "@/app/api/prompt-os/translate/route",
    "guard": "requireRole",
    "role": "veridian_admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/sales-hq/commission-accruals/[id]/mark-paid/route",
    "guard": "requireRole",
    "role": "veridian_admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/sales-hq/commission-accruals/[id]/void/route",
    "guard": "requireRole",
    "role": "veridian_admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/prompt-marketplace/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/v1/construction/boq/[id]/route",
    "guard": "requireRoleOrScope",
    "role": "manager",
    "methods": [
      "DELETE"
    ]
  },
  {
    "specifier": "@/app/api/v1/projexa/journal-entries/[id]/submit/route",
    "guard": "requireRoleOrScope",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/pms/invoices/generate/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/tickets/[id]/guest-access/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/billable-rates/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/clients/[clientId]/invoices/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/clients/[clientId]/portal-links/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/invoices/[invoiceId]/fixed-fee-line/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/invoices/[invoiceId]/paid/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/invoices/[invoiceId]/send/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/invoices/[invoiceId]/void/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/settings/ai-config/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/settings/api-keys/[id]/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "DELETE",
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/settings/webhooks/[id]/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "DELETE",
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/construction/activities/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/attendance/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/kpi-entries/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/labour-roster/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/progress/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/automation-rules/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/business-hours-schedules/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/business-rules/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/business-rules/[id]/activate/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/business-rules/[id]/deprecate/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/business-rules/[id]/rollback/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/compliance/import/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/compliance/recur/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/assets/[assetId]/relationships/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/audit-points/[id]/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/crm/pipeline/ai-summary/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/crm/sales-pipeline/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/custom-charts/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/custom-charts/[id]/run/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/documents/extract/route",
    "guard": "requireRole",
    "role": "team_member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/documents/[id]/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/drafted-communications/[id]/approve/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/construction/site-diary/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/crm/campaigns/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/crm/leads/import/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/crm/leads/[id]/convert/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/crm/opportunities/bulk-reassign/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/currencies/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/exchange-rates/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/exchange-rates/refresh/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/dynamic-chains/[id]/versions/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/buying/suppliers/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/buying/suppliers/[id]/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/erp/companies/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/hr/employees/[userId]/route",
    "guard": "requireRole",
    "role": "branch_manager",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/ingest/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/ingest/[batchId]/confirm/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/installed-products/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/procurement/requisitions/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/procurement/requisitions/[id]/submit/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/returns/purchase/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/returns/purchase/[id]/dispatch/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/returns/sales/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/returns/sales/[id]/receive/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/pricing-rules/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/selling/customers/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/selling/customers/[id]/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/erp/stock/batches/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/stock/items/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/stock/serials/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/stock/serials/[id]/status/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/stock/uom-conversions/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/erp/stock/warehouses/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/fde/requests/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/fm/register-digitization/photo/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/gst-reconciliation/import/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/gst-reconciliation/import/[batchId]/confirm/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/gst-reconciliation/import/[batchId]/mapping/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "PUT"
    ]
  },
  {
    "specifier": "@/app/api/gst-reconciliation/reconcile/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/gst-reconciliation/returns/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/recruitment/applications/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/recruitment/applications/[id]/interviews/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/recruitment/applications/[id]/stage/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/recruitment/candidates/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/recruitment/interviews/[id]/feedback/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/recruitment/job-openings/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/recruitment/job-openings/[id]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/reports/definitions/[id]/run/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/pms/sprints/[id]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/pms/sprints/[id]/issues/route",
    "guard": "requireRole",
    "role": "team_member",
    "methods": [
      "DELETE",
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/pms/workflow-transitions/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/problem-records/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/problem-records/[id]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/products/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/products/[id]/projects/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/projects/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/prompt-eval/cases/[id]/run/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/prompt-os/import/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/v1/construction/boq/[id]/submit/route",
    "guard": "requireRoleOrScope",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/v1/projexa/change-orders/[id]/route",
    "guard": "requireRoleOrScope",
    "role": "senior_professional",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/performance-reviews/reviews/[id]/raters/[raterId]/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/performance-reviews/reviews/[id]/submit/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/pms/budgets/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/pms/budgets/[id]/line-items/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/pms/enablement/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "DELETE",
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/pms/issues/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/pms/issues/[id]/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/pms/milestones/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/pms/sprints/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/knowledge-base/pages/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/knowledge-base/pages/[id]/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/mca-filings/[id]/generate/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/performance-reviews/reviews/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/performance-reviews/reviews/[id]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/performance-reviews/reviews/[id]/acknowledge/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/performance-reviews/reviews/[id]/goals/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/performance-reviews/reviews/[id]/raters/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/portal-links/[linkId]/revoke/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/staff-assignments/[assignmentId]/end/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/tax-cases/[caseId]/stage/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/time-entries/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/time-entries/start/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/time-entries/[timeEntryId]/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/time-entries/[timeEntryId]/stop/route",
    "guard": "requireRole",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/ticket-intelligence/[id]/promote/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/tickets/route",
    "guard": "requireRole",
    "role": "team_member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/tickets/[id]/route",
    "guard": "requireRole",
    "role": "team_member",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/veri-meetings/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/veri-meetings/[id]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/veri-meetings/[id]/minutes/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/veri-meetings/[id]/publish/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/veri-meetings/[id]/share-links/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/workspace-memory/drive-export/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/workspace-memory/export/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/tasks/route",
    "guard": "requireRoleOrScope",
    "role": "member",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/clients/[clientId]/engagements/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/clients/[clientId]/service-lines/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "PUT"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/clients/[clientId]/staff-assignments/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/clients/[clientId]/tax-cases/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/deliverables/[deliverableId]/complete/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/enablement/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "DELETE",
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/engagements/[engagementId]/route",
    "guard": "requireRole",
    "role": "manager",
    "methods": [
      "PATCH"
    ]
  },
  {
    "specifier": "@/app/api/the-firm/engagements/[engagementId]/deliverables/route",
    "guard": "requireRole",
    "role": "senior_professional",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/sla-policies/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "POST"
    ]
  },
  {
    "specifier": "@/app/api/sla-policies/[id]/route",
    "guard": "requireRole",
    "role": "admin",
    "methods": [
      "PATCH"
    ]
  }
]

describe("R75 Phase 2: every fixed CRITICAL/HIGH route rejects below its minimum role and permits at it", () => {
  for (const entry of TABLE) {
    describe(`${entry.specifier} (${entry.guard} >= ${entry.role})`, () => {
      test(`rejects a role below ${entry.role} with exactly this gate's 403`, async () => {
        currentUser = { id: "r75-p2-low-user", role: "viewer", orgId: "r75-p2-test-org", name: "Low", email: "low@test.invalid" }
        const mod = await import(entry.specifier)
        for (const method of entry.methods) {
          const handler = mod[method]
          expect(typeof handler).toBe("function")
          const res = await handler(fakeRequest(method), { params: fakeParams() })
          expect(res.status).toBe(403)
          const body = await res.clone().json().catch(() => ({}))
          expect(body?.error).toBe(GATE_MESSAGE(entry.role))
        }
      })

      test(`permits a role at ${entry.role} (does not return this gate's 403)`, async () => {
        currentUser = { id: "r75-p2-ok-user", role: entry.role, orgId: "r75-p2-test-org", name: "OK", email: "ok@test.invalid" }
        const mod = await import(entry.specifier)
        for (const method of entry.methods) {
          const handler = mod[method]
          let res: Response | null = null
          try {
            res = await handler(fakeRequest(method), { params: fakeParams() })
          } catch {
            // Threw AFTER the gate ran (the gate itself never throws) --
            // proves the gate let this caller past, which is all this test
            // asserts. The thrown error is a separate, unrelated concern for
            // a synthetic body/params on this specific route.
            res = null
          }
          if (res && res.status === 403) {
            const body = await res.clone().json().catch(() => ({}))
            expect(body?.error).not.toBe(GATE_MESSAGE(entry.role))
          }
        }
      })
    })
  }
})
