/// <reference types="bun-types" />
// R75 Phase 2 (Z2-06): the authz-gap CI drift guard.
//
// THE FAULT THIS CLOSES: R74 measured 460 of 831 mutating routes with no
// role gate; nothing on this side of the codebase could ever TELL you that
// number again except re-reading 1172 files by hand (this file's own
// PROJEXA sibling, src/lib/authz/api-write-policy.test.ts, closed the exact
// same fault there in 2026-08 -- see its header). This test regenerates the
// mutating-route inventory from the real filesystem on every run (readdirSync,
// not a shell glob -- a PowerShell path with unescaped [brackets] is a
// wildcard that silently matches nothing, the exact bug that once produced a
// confidently wrong route count in this codebase's history) and asserts, in
// BOTH directions:
//   1. every mutating route is EITHER protected (calls requireRole /
//      requireRoleOrScope / requireReportsReadAccess) OR explicitly present
//      in one of the two tracked lists below, with a reason -- a brand-new
//      route added with no gate and no tracked reason fails this test
//      immediately, the day it's added, not the next time someone audits by
//      hand.
//   2. every entry in EXEMPT_ROUTES and KNOWN_OPEN_GAPS still corresponds to
//      a real, currently-unprotected mutating route -- a stale entry left
//      behind after a route is fixed or deleted fails too, so the lists
//      never silently drift out of sync with reality.
//
// EXEMPT_ROUTES (107 routes, R75 Phase 2's full audit, 2026-09-05): genuinely
// NOT an authz gap -- protected by a different real mechanism the text
// search for the three named functions can't see (an inline role check, a
// requirePermissionForUser()/requireAdmin() wrapper, a per-resource guest/
// vendor-portal token validated against the DB, a cron/webhook shared-secret
// header, or intentional public-by-design with no auth at all).
//
// KNOWN_OPEN_GAPS (163 routes, MEDIUM/LOW severity per R75 Phase 2's own
// rubric): REAL, currently open authz gaps, not exempted, not fixed in this
// phase -- Phase 2's scope was CRITICAL+HIGH only (see the two fix commits
// on this branch). This list exists so the drift guard can be green TODAY
// without pretending these are closed: it fails if a listed gap's route
// disappears without the list being updated (so "fixed at last" is a
// visible, deliberate diff, not a silent shrink), and it fails if the count
// of genuinely open, untracked gaps ever grows past what's listed here.
// Closing these is out of this phase's stated scope (Z2-04 named
// CRITICAL/HIGH only) -- tracked here for whichever phase takes them next.
import { describe, test, expect } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, sep } from "node:path"

const API_ROOT = join(import.meta.dir, "..", "..", "app", "api")
const MUTATING_VERBS = ["POST", "PUT", "PATCH", "DELETE"] as const
const GUARD_CALLS = ["requireRole(", "requireRoleOrScope(", "requireReportsReadAccess("]

type RouteInfo = { path: string; verbs: string[]; protected: boolean }

function walkRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkRouteFiles(full, out)
    else if (entry.name === "route.ts" || entry.name === "route.tsx") out.push(full)
  }
  return out
}

function routesOnDisk(): RouteInfo[] {
  return walkRouteFiles(API_ROOT).map((file) => {
    // Relative path in the same "src/app/api/..." form the audit and the
    // fix commits both use, so EXEMPT_ROUTES/KNOWN_OPEN_GAPS entries match
    // by exact string equality in both directions.
    const idx = file.indexOf(join("src", "app", "api"))
    const rel = idx >= 0 ? file.slice(idx).split(sep).join("/") : file
    const source = readFileSync(file, "utf8")
    const verbs = MUTATING_VERBS.filter(
      (v) =>
        new RegExp(`export\\s+(async\\s+)?function\\s+${v}\\b`).test(source) ||
        new RegExp(`export\\s+const\\s+${v}\\s*=`).test(source)
    )
    const isProtected = GUARD_CALLS.some((g) => source.includes(g))
    return { path: rel, verbs, protected: isProtected }
  })
}

const EXEMPT_ROUTES: Array<{ path: string; category: string; reason: string }> = [
  {
    "path": "src/app/api/auth/sso/[orgSlug]/acs/route.ts",
    "category": "PUBLIC_BY_DESIGN",
    "reason": "SAML ACS endpoint that validates an IdP-signed assertion and establishes a session via a magic link."
  },
  {
    "path": "src/app/api/billing/invoices/generate/route.ts",
    "category": "STALE",
    "reason": "Generates a billing invoice for the caller's org; already gated to admin/manager via an inline role check, not requireRole()."
  },
  {
    "path": "src/app/api/client-portal/[token]/deliverables/[deliverableId]/submit/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Client marks a portal deliverable as submitted, authenticated by a DB-validated per-client portal token."
  },
  {
    "path": "src/app/api/client-portal/[token]/documents/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Client uploads a document through the portal, authenticated by a DB-validated per-client portal token."
  },
  {
    "path": "src/app/api/ai/team/log-usage/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "POST logs AI-team token usage from an external automation script, authenticated via a validated shared-secret header rather than a user session."
  },
  {
    "path": "src/app/api/auth/failure-event/route.ts",
    "category": "PUBLIC_BY_DESIGN",
    "reason": "POST records a failed login attempt for anomaly detection; intentionally an anonymous pre-auth endpoint with a generic response."
  },
  {
    "path": "src/app/api/auth/passcode-login/route.ts",
    "category": "PUBLIC_BY_DESIGN",
    "reason": "POST verifies an email+passcode login and returns a one-time Supabase magic-link action_link to establish the session; intentionally a public pre-auth login route."
  },
  {
    "path": "src/app/api/crm/pipeline/stages/route.ts",
    "category": "STALE",
    "reason": "Creates a CRM pipeline stage; actually gated by requirePermissionForUser('crm.pipeline_stages.manage'), a mechanism the grep didn't recognize."
  },
  {
    "path": "src/app/api/crm/pipeline/stages/[id]/route.ts",
    "category": "STALE",
    "reason": "Updates/deletes a CRM pipeline stage; both methods are actually gated by requirePermissionForUser('crm.pipeline_stages.manage')."
  },
  {
    "path": "src/app/api/contact/draft/route.ts",
    "category": "PUBLIC_BY_DESIGN",
    "reason": "Public unauthenticated autosave beacon for an in-progress marketing-site contact form draft."
  },
  {
    "path": "src/app/api/contact/submit/route.ts",
    "category": "PUBLIC_BY_DESIGN",
    "reason": "Public unauthenticated final-submit endpoint for the marketing-site contact form."
  },
  {
    "path": "src/app/api/erp/cost-centers/route.ts",
    "category": "STALE",
    "reason": "Creates a cost center, already gated to at least the role configured for erp.cost_centers.create via requirePermissionForUser (a requireRole wrapper)."
  },
  {
    "path": "src/app/api/erp/fixed-assets/route.ts",
    "category": "STALE",
    "reason": "Creates a fixed asset; already remediated to require at least the configured erp.fixed_assets.create role."
  },
  {
    "path": "src/app/api/erp/fixed-assets/categories/route.ts",
    "category": "STALE",
    "reason": "Creates a fixed-asset category (GL account mapping); already remediated to require manager rank."
  },
  {
    "path": "src/app/api/erp/fixed-assets/categories/[id]/route.ts",
    "category": "STALE",
    "reason": "Updates a fixed-asset category's GL mapping; already remediated to require manager rank."
  },
  {
    "path": "src/app/api/erp/fixed-assets/depreciation-runs/route.ts",
    "category": "STALE",
    "reason": "Runs a batch depreciation posting across fixed assets; already remediated to require manager rank."
  },
  {
    "path": "src/app/api/erp/fixed-assets/[id]/route.ts",
    "category": "STALE",
    "reason": "Updates a fixed asset record; already remediated to require at least member rank."
  },
  {
    "path": "src/app/api/erp/fixed-assets/[id]/movements/route.ts",
    "category": "STALE",
    "reason": "Logs a fixed-asset location/custodian movement; already remediated to require member rank."
  },
  {
    "path": "src/app/api/erp/fixed-assets/[id]/submit/route.ts",
    "category": "STALE",
    "reason": "Capitalizes/submits a fixed asset (posts its acquisition entry to the GL); already remediated to require manager rank."
  },
  {
    "path": "src/app/api/erp/inventory/abc-classification/route.ts",
    "category": "STALE",
    "reason": "Recomputes ABC inventory classification for the org; already gated to at least member rank."
  },
  {
    "path": "src/app/api/erp/inventory/cycle-count-lines/[id]/count/route.ts",
    "category": "STALE",
    "reason": "Records a physical cycle-count result for an inventory line; already gated to at least member rank."
  },
  {
    "path": "src/app/api/erp/inventory/cycle-count-plans/route.ts",
    "category": "STALE",
    "reason": "Creates a cycle-count plan for the org's inventory; already gated to at least member rank."
  },
  {
    "path": "src/app/api/erp/inventory/issues/route.ts",
    "category": "STALE",
    "reason": "Records a stock issue (inventory outflow) for the org; already gated to at least member rank."
  },
  {
    "path": "src/app/api/erp/inventory/receipts/route.ts",
    "category": "STALE",
    "reason": "Records a stock receipt (inventory inflow) for the org; already gated to at least member rank."
  },
  {
    "path": "src/app/api/erp/inventory/reorder-levels/route.ts",
    "category": "STALE",
    "reason": "Sets a reorder level for an inventory item/warehouse; already gated to at least member rank."
  },
  {
    "path": "src/app/api/erp/accounts/route.ts",
    "category": "STALE",
    "reason": "Creates a new Chart-of-Accounts GL account for the org; already gated at manager rank via requirePermissionForUser (a requireRole wrapper), not a real gap."
  },
  {
    "path": "src/app/api/erp/buying/goods-receipts/route.ts",
    "category": "STALE",
    "reason": "Creates a draft purchase (goods) receipt for the org; already gated at member rank via requirePermissionForUser, not a real gap."
  },
  {
    "path": "src/app/api/erp/buying/goods-receipts/[id]/landed-costs/route.ts",
    "category": "STALE",
    "reason": "Creates a landed-cost voucher against a goods receipt, affecting inventory valuation; already gated at manager rank via requirePermissionForUser, not a real gap."
  },
  {
    "path": "src/app/api/erp/buying/goods-receipts/[id]/submit/route.ts",
    "category": "STALE",
    "reason": "Submits/posts a goods receipt, moving real FIFO inventory and updating the linked PO's status; already gated at manager rank via requirePermissionForUser, not a real gap."
  },
  {
    "path": "src/app/api/erp/buying/purchase-orders/route.ts",
    "category": "STALE",
    "reason": "Creates a draft purchase order for the org; already gated at member rank via requirePermissionForUser, not a real gap."
  },
  {
    "path": "src/app/api/erp/cash-vouchers/route.ts",
    "category": "STALE",
    "reason": "Creates and immediately posts a cash voucher to the GL (moves money, fires a webhook); already gated at manager rank via requirePermissionForUser, not a real gap."
  },
  {
    "path": "src/app/api/internal/escalations-report/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered generator for the Escalations report, no persistence, POST just delegates to GET."
  },
  {
    "path": "src/app/api/internal/exchange-rate-refresh/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron job that refreshes live FX rates for every org with a base currency configured."
  },
  {
    "path": "src/app/api/internal/fm-ppm/generate-occurrences/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron job generating due PPM (planned preventive maintenance) occurrences across all orgs."
  },
  {
    "path": "src/app/api/internal/idle-ai-capacity/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Quarterly cron report identifying unused provisioned AI model capacity."
  },
  {
    "path": "src/app/api/internal/instruction-audit/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron job running the instruction-mismatch audit."
  },
  {
    "path": "src/app/api/internal/l2-phrase-promotion/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Nightly-only cron job running the L2 phrase-promotion batch analysis."
  },
  {
    "path": "src/app/api/internal/loops/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron entry point running all active self-improvement audit loops plus several piggybacked maintenance jobs (cache purge, cost-anomaly audit, memory projection)."
  },
  {
    "path": "src/app/api/internal/metric-alerts/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron job evaluating metric alert rules, ticket SLA/escalation breaches, task overdue detection and reprioritization, and cost ceiling breaches."
  },
  {
    "path": "src/app/api/internal/ops-task-sync/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Server-to-server bridge endpoint where the ops (Hetzner) box posts autonomous coding-task checkpoint state to be upserted into opsDevTasks."
  },
  {
    "path": "src/app/api/internal/orchestra-log-purge/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron job purging expired orchestra execution log payloads past a retention window."
  },
  {
    "path": "src/app/api/internal/pipeline-stuck-deal-digest/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron job sending a digest notification for sales deals stuck in a pipeline stage too long."
  },
  {
    "path": "src/app/api/internal/recommendations-report/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered generator for the Recommendations report, no persistence layer."
  },
  {
    "path": "src/app/api/internal/report-schedules/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Daily cron job that fires any report_schedules rows whose cadence is due."
  },
  {
    "path": "src/app/api/internal/risk-trends-report/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered generator for the Risk-Trends report over a 7-day window."
  },
  {
    "path": "src/app/api/internal/role-quality-regression/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron job running per-role AI model quality regression checks and persisting results."
  },
  {
    "path": "src/app/api/internal/routing-accuracy-report/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Weekly cron job generating the AI Orchestra routing-accuracy report."
  },
  {
    "path": "src/app/api/internal/secrets-audit/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron job auditing that required production env vars/secrets are actually set, logging/erroring if any are missing."
  },
  {
    "path": "src/app/api/internal/task-nudge-digest/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron job sending a batched digest nudging users toward incomplete tasks."
  },
  {
    "path": "src/app/api/internal/the-firm/deadline-digest/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron job computing upcoming compliance/tax-case/engagement deadlines across all THE FIRM-enabled orgs."
  },
  {
    "path": "src/app/api/internal/the-firm/recur-engagements/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron job cloning recurring engagements whose next occurrence date has arrived, across all THE FIRM-enabled orgs."
  },
  {
    "path": "src/app/api/internal/ai-performance-report/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered daily AI performance report generator, gated by CRON_SECRET bearer check."
  },
  {
    "path": "src/app/api/internal/ai-reduction-snapshot/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered monthly AI-reduction usage snapshot, gated by CRON_SECRET bearer check."
  },
  {
    "path": "src/app/api/internal/audit-cadence/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered daily L2/L4 audit-cadence compliance scan, gated by CRON_SECRET bearer check."
  },
  {
    "path": "src/app/api/internal/capability-audit/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered sweep that LLM-audits due task_capabilities rows, gated by CRON_SECRET bearer check."
  },
  {
    "path": "src/app/api/internal/cost-anomalies/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered daily AI cost-anomaly detection report, gated by CRON_SECRET bearer check."
  },
  {
    "path": "src/app/api/internal/crm-data-integrity/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered weekly CRM orphaned-lead-reference integrity check across all orgs, gated by CRON_SECRET bearer check."
  },
  {
    "path": "src/app/api/internal/crm-lead-followup-alerts/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered daily job that notifies lead owners of overdue follow-ups across all orgs, gated by CRON_SECRET bearer check."
  },
  {
    "path": "src/app/api/internal/crm-lead-scoring/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered daily auto-scoring of new/stale CRM leads across all orgs, gated by CRON_SECRET bearer check."
  },
  {
    "path": "src/app/api/internal/crr-catchup-worker/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered worker that re-drives stuck document extraction/embedding rows to completion, gated by CRON_SECRET bearer check."
  },
  {
    "path": "src/app/api/internal/dispatch-completion-monitor/run/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Cron-triggered daily dispatch-completion staleness sweep across all orgs, gated by CRON_SECRET bearer check."
  },
  {
    "path": "src/app/api/erp/procurement/quotations/route.ts",
    "category": "STALE",
    "reason": "Creates a supplier quotation for the org's RFQ workflow; correctly gated at member role via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/procurement/rfqs/route.ts",
    "category": "STALE",
    "reason": "Creates an RFQ for the org's procurement workflow; correctly gated at member role via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/procurement/rfqs/[id]/send/route.ts",
    "category": "STALE",
    "reason": "Marks an RFQ as sent to suppliers; correctly gated at member role via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/purchase-credit-notes/route.ts",
    "category": "STALE",
    "reason": "Creates a draft purchase credit note; correctly gated at member role via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/purchase-credit-notes/[id]/submit/route.ts",
    "category": "STALE",
    "reason": "Posts a purchase credit note's reversing GL entries; correctly gated at manager role via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/returns/purchase/[id]/credit-note/route.ts",
    "category": "STALE",
    "reason": "Links a purchase return to a credit note; correctly gated at member role via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/returns/sales/[id]/credit-note/route.ts",
    "category": "STALE",
    "reason": "Links a sales return to a credit note; correctly gated at member role via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/sales-credit-notes/route.ts",
    "category": "STALE",
    "reason": "Creates a draft sales credit note; correctly gated at member role via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/sales-credit-notes/[id]/submit/route.ts",
    "category": "STALE",
    "reason": "Posts a sales credit note's reversing GL entries; correctly gated at manager role via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/sales-invoices/route.ts",
    "category": "STALE",
    "reason": "Creates a draft sales invoice; correctly gated at member role via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/sales-invoices/[id]/e-invoice/route.ts",
    "category": "STALE",
    "reason": "Generates an e-invoice payload for a sales invoice; correctly gated at member role via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/sales-invoices/[id]/submit/route.ts",
    "category": "STALE",
    "reason": "Posts a sales invoice to the GL and fires a financial webhook; correctly gated at manager role via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/journal-entries/route.ts",
    "category": "STALE",
    "reason": "Creates a draft journal entry, gated at member rank via requirePermissionForUser (a requireRole wrapper the grep missed)."
  },
  {
    "path": "src/app/api/erp/journal-entries/[id]/submit/route.ts",
    "category": "STALE",
    "reason": "Posts (submits) a journal entry to the general ledger, gated at manager rank via requirePermissionForUser."
  },
  {
    "path": "src/app/api/erp/payment-entries/[id]/decide/route.ts",
    "category": "STALE",
    "reason": "Approves/rejects a payment entry; protected by a real manager-rank-or-above service-layer gate (canDecidePaymentEntry) the grep couldn't see."
  },
  {
    "path": "src/app/api/erp/statistical-key-figure-postings/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Posts a statistical key figure value (CO-006 actual/plan posting); actually gated by requirePermissionForUser->requireRole, not a real gap."
  },
  {
    "path": "src/app/api/erp/statistical-key-figure-types/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Creates statistical key figure master-data types; actually gated by requirePermissionForUser->requireRole, not a real gap."
  },
  {
    "path": "src/app/api/esignature/sign/[token]/decline/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Lets an external signer decline a signature via their emailed per-signer access token, validated against the DB with expiry."
  },
  {
    "path": "src/app/api/esignature/sign/[token]/submit/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Lets an external signer submit their signature via a DB-validated per-signer access token in the URL."
  },
  {
    "path": "src/app/api/finance/ai-cost-reconciliation/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Records/lists AI-cost reconciliation entries against actual provider invoices; actually gated by an inline dbUser.role !== 'veridian_admin' check, not a real gap."
  },
  {
    "path": "src/app/api/forge/submit/route.ts",
    "category": "PUBLIC_BY_DESIGN",
    "reason": "Public marketing/intake form submission endpoint for the Forge product, intentionally open to anonymous visitors."
  },
  {
    "path": "src/app/api/guest-chat/[token]/messages/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Lets a guest post a chat message into their token-scoped support conversation; the token is looked up and expiry/revocation-checked in the DB."
  },
  {
    "path": "src/app/api/guest-chat/[token]/survey/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Lets a guest submit a CSAT/NPS satisfaction survey for their resolved support ticket via a validated, expiry-checked token."
  },
  {
    "path": "src/app/api/public/portal/[orgSlug]/tickets/route.ts",
    "category": "PUBLIC_BY_DESIGN",
    "reason": "Public, rate-limited endpoint letting anonymous visitors submit a support ticket to a specific org's helpdesk via its slug."
  },
  {
    "path": "src/app/api/v1/platform/provision-org/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Service-to-service endpoint letting a trusted platform application provision a brand-new VERIDIAN org and its first API key."
  },
  {
    "path": "src/app/api/v1/projexa/quotations/[id]/convert/route.ts",
    "category": "STALE",
    "reason": "Converts an approved/sent quotation into a sales order, gated by permission-service's role-mapped check."
  },
  {
    "path": "src/app/api/v1/projexa/quotations/[id]/revisions/route.ts",
    "category": "STALE",
    "reason": "Creates a new revision of a quotation, gated by permission-service's role-mapped check."
  },
  {
    "path": "src/app/api/v1/projexa/sales-orders/[id]/route.ts",
    "category": "STALE",
    "reason": "Updates a sales order's status through a lifecycle transition table, gated by permission-service's manager-rank check."
  },
  {
    "path": "src/app/api/vendor-portal/[token]/auctions/[auctionId]/bid/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Lets an invited supplier submit a reverse-auction bid using their vendor-portal token."
  },
  {
    "path": "src/app/api/vendor-portal/[token]/bank-account/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Lets a vendor submit a new bank account for themselves via their portal token."
  },
  {
    "path": "src/app/api/pms/billable-rates/route.ts",
    "category": "STALE",
    "reason": "Sets a project's/employee's billable rate; already correctly gated to admin+ via an inline hasRole() check the text search missed."
  },
  {
    "path": "src/app/api/pms/issue-statuses/route.ts",
    "category": "STALE",
    "reason": "Creates a project issue-status; already correctly gated to admin+ inside the service layer, invisible to a route-level text search."
  },
  {
    "path": "src/app/api/pms/issue-types/route.ts",
    "category": "STALE",
    "reason": "Creates a project issue-type; already correctly gated to admin+ inside the service layer, invisible to a route-level text search."
  },
  {
    "path": "src/app/api/invite-links/route.ts",
    "category": "STALE",
    "reason": "Lists and creates org invite links, gated inline to admin/manager roles."
  },
  {
    "path": "src/app/api/invite-links/[id]/route.ts",
    "category": "STALE",
    "reason": "Revokes an org invite link, gated inline to admin/manager roles."
  },
  {
    "path": "src/app/api/join-code/preview/route.ts",
    "category": "PUBLIC_BY_DESIGN",
    "reason": "Public pre-signup preview of what org/role a join code would grant."
  },
  {
    "path": "src/app/api/join-codes/route.ts",
    "category": "STALE",
    "reason": "Lets any org member mint/list join codes, rank-ceilinged and quota-limited by design."
  },
  {
    "path": "src/app/api/join-codes/[id]/route.ts",
    "category": "STALE",
    "reason": "Revokes a join code; non-privileged callers restricted to codes they created."
  },
  {
    "path": "src/app/api/mcp/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Customer-facing MCP JSON-RPC server authenticated via a real hashed-and-looked-up API-key Bearer token."
  },
  {
    "path": "src/app/api/mcp/[token]/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Per-user AI-link MCP endpoint authenticated by a real validated per-user token in the URL."
  },
  {
    "path": "src/app/api/me/route.ts",
    "category": "STALE",
    "reason": "Updates the caller's own profile name freely and org details only if the caller is an admin."
  },
  {
    "path": "src/app/api/track/route.ts",
    "category": "PUBLIC_BY_DESIGN",
    "reason": "Records an anonymous visitor analytics event from public marketing pages."
  },
  {
    "path": "src/app/api/track/offer/route.ts",
    "category": "PUBLIC_BY_DESIGN",
    "reason": "Decides and logs an anonymous exit-intent marketing offer for a visitor."
  },
  {
    "path": "src/app/api/webhooks/vercel-deployment/route.ts",
    "category": "INTERNAL_SECRET",
    "reason": "Receives Vercel's deployment webhook and records a deployment event, authenticated via HMAC signature rather than a user session."
  },
  {
    "path": "src/app/api/stage0/conversations/[id]/messages/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Stage-0 user posts/reads messages in a specific conversation, gated by a real per-resource active-membership DB check, not by requireRole."
  },
  {
    "path": "src/app/api/support-sessions/[id]/end/route.ts",
    "category": "TOKEN_SCOPED",
    "reason": "Ends a support/impersonation session early, gated by hasRole() checks for either veridian_admin or the specific target org's own admin."
  }
]

const KNOWN_OPEN_GAPS: Array<{ path: string; category: string; reason: string }> = [
  {
    "path": "src/app/api/compliance/[id]/comments/route.ts",
    "category": "MEDIUM",
    "reason": "Adds a comment to a compliance item; any org member can comment on any item in the org with no role check."
  },
  {
    "path": "src/app/api/connectors/route.ts",
    "category": "LOW",
    "reason": "Starts an OAuth connection flow for the caller's own third-party connector account."
  },
  {
    "path": "src/app/api/connectors/[toolkit]/sync/route.ts",
    "category": "LOW",
    "reason": "Re-checks and persists the OAuth connection status for the caller's own connector account."
  },
  {
    "path": "src/app/api/construction/ai/diff-drawings/route.ts",
    "category": "MEDIUM",
    "reason": "Runs an AI vision diff between two drawing-revision documents in the caller's org."
  },
  {
    "path": "src/app/api/construction/ai/estimate-progress/route.ts",
    "category": "MEDIUM",
    "reason": "Runs an AI vision progress estimate from a photo document in the caller's org."
  },
  {
    "path": "src/app/api/construction/categories/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a construction progress-tracking category for a project."
  },
  {
    "path": "src/app/api/construction/kpi-definitions/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a KPI metric definition for a construction project."
  },
  {
    "path": "src/app/api/construction/progress/daily/route.ts",
    "category": "MEDIUM",
    "reason": "Uploads a photo attachment to a project's daily progress report."
  },
  {
    "path": "src/app/api/business-rules/[id]/dry-run/route.ts",
    "category": "MEDIUM",
    "reason": "Dry-runs a business rule against a sample record with no real side effects, no role gate."
  },
  {
    "path": "src/app/api/code-change-requests/route.ts",
    "category": "MEDIUM",
    "reason": "Submits a code-change request for the caller's org, any authenticated user, no role gate."
  },
  {
    "path": "src/app/api/compliance/export-event/route.ts",
    "category": "MEDIUM",
    "reason": "Logs a bulk-export audit event and runs anomaly detection on a caller-supplied count, any authenticated user, no role gate."
  },
  {
    "path": "src/app/api/compliance/overdue/route.ts",
    "category": "MEDIUM",
    "reason": "Recomputes overdue status for all compliance items in the org, any authenticated user or API key, no role/scope gate."
  },
  {
    "path": "src/app/api/ai/orchestrate/route.ts",
    "category": "MEDIUM",
    "reason": "POST triggers an LLM-based 'what should I do next' suggestion for a compliance item or notice, scoped to the caller's own org but open to any authenticated org member."
  },
  {
    "path": "src/app/api/ai/team/capability-improvements/[id]/route.ts",
    "category": "LOW",
    "reason": "POST closes or rejects a capability-improvement proposal (close/reject actions), already gated to veridian_admin via an inline role check."
  },
  {
    "path": "src/app/api/ai/team/dispatch/route.ts",
    "category": "LOW",
    "reason": "POST dispatches an AI Dev Team task and PATCH sets/clears a role model override, both already veridian_admin-gated via inline check."
  },
  {
    "path": "src/app/api/ai/team/executive-review/[id]/route.ts",
    "category": "LOW",
    "reason": "POST acknowledges a pending L4 executive escalation, already veridian_admin-gated via inline role check."
  },
  {
    "path": "src/app/api/ai/team/monitor/dispatch-completion/route.ts",
    "category": "LOW",
    "reason": "POST runs a dispatch-completion staleness sweep with an optional threshold override, already veridian_admin-gated via inline role check."
  },
  {
    "path": "src/app/api/ai/team/provider-outages/route.ts",
    "category": "LOW",
    "reason": "POST records a new AI-provider outage window, already veridian_admin-gated via inline role check."
  },
  {
    "path": "src/app/api/ai/team/re-audit/route.ts",
    "category": "LOW",
    "reason": "POST flags a previously-closed AI dispatch for re-audit, already veridian_admin-gated via inline role check."
  },
  {
    "path": "src/app/api/ai/team/re-audit/[id]/route.ts",
    "category": "LOW",
    "reason": "DELETE clears a re-audit flag on an activity-log row, already veridian_admin-gated via inline role check."
  },
  {
    "path": "src/app/api/ai/team/review/route.ts",
    "category": "LOW",
    "reason": "POST records the peer/closure review decision for an AI dispatch flagged for review, already veridian_admin-gated via inline role check."
  },
  {
    "path": "src/app/api/ai/team/review-registry/route.ts",
    "category": "LOW",
    "reason": "POST triggers a new Agent Review Registry cycle, already veridian_admin-gated via inline role check."
  },
  {
    "path": "src/app/api/ai/team/role-quality/route.ts",
    "category": "LOW",
    "reason": "POST manually re-runs a per-role quality regression check, already veridian_admin-gated via inline role check."
  },
  {
    "path": "src/app/api/ai-link/route.ts",
    "category": "LOW",
    "reason": "POST rotates the signed-in user's own AI-delegation link (revoke old, mint new), scoped entirely to the caller's own session identity."
  },
  {
    "path": "src/app/api/assistants/[id]/route.ts",
    "category": "LOW",
    "reason": "PATCH updates the caller's own AI assistant's label/status/personality config, self-scoping enforced via Postgres row-level security on user_id."
  },
  {
    "path": "src/app/api/assistants/[id]/memories/route.ts",
    "category": "LOW",
    "reason": "POST adds an embedded memory entry to one of the caller's own AI assistants, ownership enforced transitively via the same RLS-scoped assistant lookup."
  },
  {
    "path": "src/app/api/crm/opportunities/[id]/follow-up-task/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a follow-up task from a CRM opportunity for the caller's org, with no role gate beyond being an authenticated org member."
  },
  {
    "path": "src/app/api/crm/sales-pipeline/summary/route.ts",
    "category": "LOW",
    "reason": "Generates an AI sales-pipeline narrative, but resolveViewerScope() already forces non-manager callers to their own data only -- a real, self-service-safe scoping mechanism the grep missed."
  },
  {
    "path": "src/app/api/delegations/route.ts",
    "category": "LOW",
    "reason": "Creates a delegation always scoped to the caller as delegator, with downstream authority validated at consumption time -- genuinely self-service."
  },
  {
    "path": "src/app/api/delegations/[id]/route.ts",
    "category": "LOW",
    "reason": "Revokes a delegation; the service layer enforces that only the original delegator can revoke their own delegation."
  },
  {
    "path": "src/app/api/document-correspondents/route.ts",
    "category": "MEDIUM",
    "reason": "Creates an org-wide document correspondent register entry with no role check beyond authentication."
  },
  {
    "path": "src/app/api/document-matching-rules/route.ts",
    "category": "MEDIUM",
    "reason": "Creates an org-wide document auto-classification matching rule with no role check beyond authentication."
  },
  {
    "path": "src/app/api/drafted-communications/route.ts",
    "category": "MEDIUM",
    "reason": "Creates an AI-drafted communication held for later approval, with no role check beyond authentication."
  },
  {
    "path": "src/app/api/drafted-communications/[id]/reject/route.ts",
    "category": "MEDIUM",
    "reason": "Rejects an AI-drafted communication (prevents it from being sent), with no role check beyond authentication."
  },
  {
    "path": "src/app/api/conversations/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a new chat conversation with specified org participants, with only session auth and no rank check."
  },
  {
    "path": "src/app/api/conversations/workflow-thread/route.ts",
    "category": "LOW",
    "reason": "Creates a brand-new AI workflow thread that only the calling user is a participant of."
  },
  {
    "path": "src/app/api/conversations/[id]/messages/route.ts",
    "category": "LOW",
    "reason": "Sends a chat message into a conversation, gated by a real per-conversation participant-membership check (assertParticipant), not a role check."
  },
  {
    "path": "src/app/api/conversations/[id]/read/route.ts",
    "category": "LOW",
    "reason": "Marks a conversation as read for the calling user only, writing solely to their own participant row."
  },
  {
    "path": "src/app/api/conversations/[id]/regenerate/route.ts",
    "category": "LOW",
    "reason": "Regenerates the last AI reply in a conversation, gated by a real participant-membership check rather than a role check."
  },
  {
    "path": "src/app/api/conversations/[id]/veri-participant/route.ts",
    "category": "LOW",
    "reason": "Adds/removes VERI as an AI participant on a group conversation, gated by a real participant-membership check."
  },
  {
    "path": "src/app/api/crm/accounts/route.ts",
    "category": "LOW",
    "reason": "Creates a new CRM account; already gated at member rank+ via an in-service assertGate(canCreateCrmRecord) check the text search couldn't see."
  },
  {
    "path": "src/app/api/crm/accounts/bulk-reassign/route.ts",
    "category": "LOW",
    "reason": "Bulk-reassigns CRM account owners; already gated at manager rank+ via an in-service assertGate(canReassignOrDeleteAccount) check."
  },
  {
    "path": "src/app/api/crm/accounts/import/route.ts",
    "category": "LOW",
    "reason": "Bulk-imports CRM accounts from an uploaded spreadsheet; already gated at member rank+ via an in-service role check."
  },
  {
    "path": "src/app/api/crm/accounts/[id]/route.ts",
    "category": "LOW",
    "reason": "Updates or deletes a CRM account; PATCH is gated at member-rank-or-owner (manager rank for reassignment) and DELETE at manager rank+, via in-service assertGate checks."
  },
  {
    "path": "src/app/api/crm/accounts/[id]/analyze/route.ts",
    "category": "LOW",
    "reason": "Runs AI account-health analysis and writes the result back onto a CRM account; gated by the same in-service ownership/rank check as editing the account."
  },
  {
    "path": "src/app/api/crm/accounts/[id]/contacts/route.ts",
    "category": "LOW",
    "reason": "Adds a contact to a CRM account, gated by the same in-service ownership/rank check as editing the parent account."
  },
  {
    "path": "src/app/api/crm/accounts/[id]/link-opportunity/route.ts",
    "category": "LOW",
    "reason": "Links an existing opportunity to a CRM account, gated by the same in-service ownership/rank check as editing the account."
  },
  {
    "path": "src/app/api/crm/activities/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a CRM activity/log entry for an entity with only session auth, no role check."
  },
  {
    "path": "src/app/api/crm/contacts/[id]/route.ts",
    "category": "LOW",
    "reason": "Update/delete a CRM contact -- genuinely protected by an inline canEditAccount role+ownership gate, not a real gap."
  },
  {
    "path": "src/app/api/crm/enablement/route.ts",
    "category": "LOW",
    "reason": "Enable/disable the org's Sales module -- genuinely protected by an admin-role gate in product-branch-service.ts, not a real gap."
  },
  {
    "path": "src/app/api/crm/leads/route.ts",
    "category": "LOW",
    "reason": "Create a lead -- genuinely protected by an inline canCreateCrmRecord role gate, not a real gap."
  },
  {
    "path": "src/app/api/crm/leads/bulk-reassign/route.ts",
    "category": "LOW",
    "reason": "Bulk-reassign lead owners -- genuinely protected by a manager-rank gate, not a real gap (previously fixed per in-file comment)."
  },
  {
    "path": "src/app/api/crm/leads/[id]/route.ts",
    "category": "LOW",
    "reason": "Update/delete a lead -- genuinely protected by inline role+ownership gates, not a real gap."
  },
  {
    "path": "src/app/api/crm/leads/[id]/convert-to-account/route.ts",
    "category": "LOW",
    "reason": "Convert a lead into a CRM account -- genuinely protected by an inline canCreateCrmRecord role gate, not a real gap."
  },
  {
    "path": "src/app/api/crm/leads/[id]/follow-up-task/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a follow-up task from a lead's AI recommendation with no role check."
  },
  {
    "path": "src/app/api/crm/leads/[id]/score/route.ts",
    "category": "MEDIUM",
    "reason": "Triggers an AI lead-scoring LLM call and overwrites the lead's score fields with no role check."
  },
  {
    "path": "src/app/api/crm/lost-reasons/route.ts",
    "category": "MEDIUM",
    "reason": "Creates an org-wide Lost Reason picklist entry with no role check."
  },
  {
    "path": "src/app/api/crm/lost-reasons/[id]/route.ts",
    "category": "MEDIUM",
    "reason": "Deactivates an org-wide Lost Reason picklist entry with no role check."
  },
  {
    "path": "src/app/api/crm/opportunities/route.ts",
    "category": "LOW",
    "reason": "Create an opportunity -- genuinely protected by an inline canCreateCrmRecord role gate, not a real gap."
  },
  {
    "path": "src/app/api/crm/opportunities/[id]/route.ts",
    "category": "LOW",
    "reason": "Update/delete an opportunity -- genuinely protected by inline role+ownership gates, not a real gap."
  },
  {
    "path": "src/app/api/crm/opportunities/[id]/analyze/route.ts",
    "category": "MEDIUM",
    "reason": "Triggers an AI opportunity-analysis LLM call and mutates its AI fields with no role check."
  },
  {
    "path": "src/app/api/email-intelligence/route.ts",
    "category": "MEDIUM",
    "reason": "Submits raw email content to be analyzed and stored as a new email-intelligence item for the org."
  },
  {
    "path": "src/app/api/email-intelligence/[id]/dismiss/route.ts",
    "category": "MEDIUM",
    "reason": "Dismisses an org's email-intelligence suggested item by id, with no role or ownership check."
  },
  {
    "path": "src/app/api/email-intelligence/[id]/promote/route.ts",
    "category": "MEDIUM",
    "reason": "Promotes an email-intelligence suggested item into a real work-item/task, with no role check."
  },
  {
    "path": "src/app/api/email-intelligence/[id]/promote-to-ticket/route.ts",
    "category": "MEDIUM",
    "reason": "Converts an org's email-intelligence item into a new helpdesk ticket, with no role check."
  },
  {
    "path": "src/app/api/erp/bank-reconciliation/import/route.ts",
    "category": "MEDIUM",
    "reason": "Uploads and imports a bank statement file into reconciliation for the org; already gated at member rank via requirePermissionForUser, not a real gap."
  },
  {
    "path": "src/app/api/erp/bank-reconciliation/lines/[id]/ignore/route.ts",
    "category": "MEDIUM",
    "reason": "Marks a bank-reconciliation statement line as ignored; already gated at member rank via requirePermissionForUser, not a real gap."
  },
  {
    "path": "src/app/api/erp/bank-reconciliation/lines/[id]/match/route.ts",
    "category": "MEDIUM",
    "reason": "Matches a bank statement line to an existing journal entry; already gated at member rank via requirePermissionForUser, not a real gap."
  },
  {
    "path": "src/app/api/erp/buying/goods-receipts/items/[itemId]/putaway/route.ts",
    "category": "MEDIUM",
    "reason": "Updates the warehouse putaway location for a goods-receipt line item; already gated at member rank via requirePermissionForUser, not a real gap."
  },
  {
    "path": "src/app/api/erp/buying/goods-receipts/[id]/putaway/route.ts",
    "category": "MEDIUM",
    "reason": "Marks putaway complete for a goods receipt; already gated at member rank via requirePermissionForUser, not a real gap."
  },
  {
    "path": "src/app/api/erp/cash-accounts/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a new cash account record for the org; already gated at member rank via requirePermissionForUser, not a real gap."
  },
  {
    "path": "src/app/api/hr/expenses/route.ts",
    "category": "LOW",
    "reason": "Authenticated user files an expense claim under their own user id."
  },
  {
    "path": "src/app/api/hr/leave-requests/route.ts",
    "category": "LOW",
    "reason": "Authenticated user files their own leave request."
  },
  {
    "path": "src/app/api/hr/loans/route.ts",
    "category": "LOW",
    "reason": "Authenticated user submits their own loan request (application only, not approval)."
  },
  {
    "path": "src/app/api/ingest/[batchId]/items/[itemId]/route.ts",
    "category": "MEDIUM",
    "reason": "Edits or approves/rejects a single staged (not-yet-imported) compliance ingestion item."
  },
  {
    "path": "src/app/api/instruction-mismatches/[id]/route.ts",
    "category": "MEDIUM",
    "reason": "Resolves an AI chat instruction-mismatch flag for the org."
  },
  {
    "path": "src/app/api/erp/parties/[type]/[id]/addresses/route.ts",
    "category": "MEDIUM",
    "reason": "Adds a new address to a customer/supplier party record with no role check beyond being logged into the org."
  },
  {
    "path": "src/app/api/erp/parties/[type]/[id]/contacts/route.ts",
    "category": "MEDIUM",
    "reason": "Adds a new contact to a customer/supplier party record with no role check beyond org membership."
  },
  {
    "path": "src/app/api/escalation-rules/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a helpdesk SLA escalation rule with only session auth, no role check despite being intended as admin-only."
  },
  {
    "path": "src/app/api/field-service-dispatches/[dispatchId]/route.ts",
    "category": "MEDIUM",
    "reason": "Updates a field-service dispatch's status/notes for the caller's org with only session auth, no role check."
  },
  {
    "path": "src/app/api/glossary/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a compliance glossary term for the caller's org with no role restriction beyond authentication."
  },
  {
    "path": "src/app/api/glossary/[id]/route.ts",
    "category": "MEDIUM",
    "reason": "Updates or deletes a single glossary term by id, org-scoped, with no role gate."
  },
  {
    "path": "src/app/api/gst-reconciliation/returns/[returnPeriodId]/ai-review/route.ts",
    "category": "MEDIUM",
    "reason": "Generates an AI review report over a previously-generated GST return period, org-scoped, with no role gate."
  },
  {
    "path": "src/app/api/help/ask/route.ts",
    "category": "MEDIUM",
    "reason": "Answers a free-text in-app help question using an LLM pipeline, gated only by authentication, no per-role restriction."
  },
  {
    "path": "src/app/api/hr/attendance/route.ts",
    "category": "LOW",
    "reason": "Marks/corrects a single day's attendance; self-marking is allowed for anyone, marking someone else's attendance is permission-gated (erp.hr_attendance.mark_other)."
  },
  {
    "path": "src/app/api/hr/attendance/bulk/route.ts",
    "category": "LOW",
    "reason": "Bulk-marks attendance status for a list of employees on one date; genuinely permission-gated (erp.hr_attendance.mark_other) despite not calling requireRole directly."
  },
  {
    "path": "src/app/api/hr/attendance/check-in/route.ts",
    "category": "LOW",
    "reason": "Records the authenticated user's own check-in for a given date; always scoped to their own id."
  },
  {
    "path": "src/app/api/hr/attendance/check-out/route.ts",
    "category": "LOW",
    "reason": "Records the authenticated user's own check-out for a given date; always scoped to their own id."
  },
  {
    "path": "src/app/api/hr/attendance/holidays/route.ts",
    "category": "LOW",
    "reason": "Adds a company holiday to the org calendar; genuinely permission-gated (erp.hr_attendance.holiday_manage)."
  },
  {
    "path": "src/app/api/hr/attendance/holidays/[id]/route.ts",
    "category": "LOW",
    "reason": "Deletes a company holiday by id; genuinely permission-gated (erp.hr_attendance.holiday_manage) despite the DELETE method."
  },
  {
    "path": "src/app/api/reports/ai-builder/analyze/route.ts",
    "category": "MEDIUM",
    "reason": "Uploads a file and asks the AI report builder to propose a report definition from it, scoped to the caller's org."
  },
  {
    "path": "src/app/api/reports/definitions/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a new report definition (report engine config) scoped to the caller's org."
  },
  {
    "path": "src/app/api/reports/definitions/[id]/route.ts",
    "category": "MEDIUM",
    "reason": "Updates or deletes a report definition scoped to the caller's org."
  },
  {
    "path": "src/app/api/reports/item-actions/route.ts",
    "category": "MEDIUM",
    "reason": "Records that the current user took an action (accept/delegate/todo) on a report row, scoped to the caller's org."
  },
  {
    "path": "src/app/api/reports/saved/route.ts",
    "category": "MEDIUM",
    "reason": "Saves a custom report configuration scoped to the caller's org."
  },
  {
    "path": "src/app/api/reports/saved/[id]/route.ts",
    "category": "MEDIUM",
    "reason": "Updates or deletes a saved custom report scoped to the caller's org."
  },
  {
    "path": "src/app/api/reports/schedules/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a recurring report delivery schedule scoped to the caller's org."
  },
  {
    "path": "src/app/api/reports/schedules/[id]/route.ts",
    "category": "MEDIUM",
    "reason": "Updates or deletes a scheduled report delivery configuration scoped to the caller's org."
  },
  {
    "path": "src/app/api/pms/time-entries/route.ts",
    "category": "LOW",
    "reason": "Logs a time entry for the authenticated caller's own userId."
  },
  {
    "path": "src/app/api/pms/time-entries/[id]/route.ts",
    "category": "LOW",
    "reason": "Deletes a time entry, scoped to the caller's own userId."
  },
  {
    "path": "src/app/api/pms/time-entries/[id]/submit/route.ts",
    "category": "LOW",
    "reason": "Submits the caller's own time entry for approval."
  },
  {
    "path": "src/app/api/pms/wiki/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a PMS wiki page under a given project, org-scoped, with no role check."
  },
  {
    "path": "src/app/api/pms/wiki/[id]/route.ts",
    "category": "MEDIUM",
    "reason": "Updates an existing PMS wiki page with no role check."
  },
  {
    "path": "src/app/api/problem-records/[id]/tickets/route.ts",
    "category": "MEDIUM",
    "reason": "Links an existing ticket to a problem record with no role check."
  },
  {
    "path": "src/app/api/prompt-compiler/execute/route.ts",
    "category": "MEDIUM",
    "reason": "Runs the server-side prompt-compiler pipeline for the caller's org with no role check."
  },
  {
    "path": "src/app/api/prompt-eval/cases/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a prompt evaluation test case with no role check and no org scoping."
  },
  {
    "path": "src/app/api/prompt-os/localize/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a localized version of a prompt with no role check."
  },
  {
    "path": "src/app/api/training/enrollments/[id]/complete/route.ts",
    "category": "LOW",
    "reason": "Lets the authenticated caller mark their own training-course enrollment complete."
  },
  {
    "path": "src/app/api/training/enrollments/[id]/start/route.ts",
    "category": "LOW",
    "reason": "Lets the authenticated caller start their own training-course enrollment."
  },
  {
    "path": "src/app/api/v1/projexa/reports/definitions/[id]/run/route.ts",
    "category": "MEDIUM",
    "reason": "Executes a saved report definition and returns its computed result, with no role/permission gate beyond generic auth."
  },
  {
    "path": "src/app/api/v1/projexa/timesheets/[id]/submit/route.ts",
    "category": "LOW",
    "reason": "Submits a designer's own time entry for manager review, resolving the acting identity per the established proxy pattern."
  },
  {
    "path": "src/app/api/v1/tasks/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a new task in the org's Task Master with no role/permission gate beyond generic auth."
  },
  {
    "path": "src/app/api/veri-chat/conversations/[id]/context/route.ts",
    "category": "MEDIUM",
    "reason": "Sets which business entity a VERI Chat conversation is contextually linked to."
  },
  {
    "path": "src/app/api/veri-chat/conversations/[id]/guest-access/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a shareable guest-access link/token for a VERI Chat conversation."
  },
  {
    "path": "src/app/api/veri-chat/conversations/[id]/share-links/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a shareable link/token for a VERI Chat conversation."
  },
  {
    "path": "src/app/api/veri-chat/guest-access/[id]/route.ts",
    "category": "LOW",
    "reason": "Revokes a previously granted guest-access token for a VERI Chat conversation."
  },
  {
    "path": "src/app/api/veri-chat/messages/[id]/attachments/route.ts",
    "category": "MEDIUM",
    "reason": "Attaches an existing document to a VERI Chat message."
  },
  {
    "path": "src/app/api/pms/estimate-schemes/route.ts",
    "category": "MEDIUM",
    "reason": "Lets any authenticated org member create a project's estimate-point scheme (config), unlike sibling taxonomy endpoints that are admin-gated."
  },
  {
    "path": "src/app/api/pms/issues/[id]/relations/route.ts",
    "category": "MEDIUM",
    "reason": "Lets any authenticated org member link any two project issues together with no role check."
  },
  {
    "path": "src/app/api/pms/labels/route.ts",
    "category": "MEDIUM",
    "reason": "Lets any authenticated org member create a project label (low-stakes taxonomy item) with no role check."
  },
  {
    "path": "src/app/api/pms/meetings/route.ts",
    "category": "MEDIUM",
    "reason": "Lets any authenticated org member schedule a project meeting with no role check."
  },
  {
    "path": "src/app/api/pms/meetings/[id]/outcomes/route.ts",
    "category": "MEDIUM",
    "reason": "Lets any authenticated org member append outcome notes to any project meeting with no role check."
  },
  {
    "path": "src/app/api/pms/saved-views/route.ts",
    "category": "LOW",
    "reason": "Lets an authenticated org member create their own saved PMS view; correctly self-scoped to the caller's own user id."
  },
  {
    "path": "src/app/api/pms/saved-views/[id]/route.ts",
    "category": "LOW",
    "reason": "Lets an authenticated org member edit/delete a saved PMS view; correctly restricted to the view's own owner via an explicit ownedById check in the service layer."
  },
  {
    "path": "src/app/api/me/onboarding-stage/route.ts",
    "category": "LOW",
    "reason": "Updates the caller's own onboarding-stage progress and completion flag."
  },
  {
    "path": "src/app/api/metric-alert-rules/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a metric-alert monitoring rule for the org with no role restriction."
  },
  {
    "path": "src/app/api/metric-alert-rules/[id]/route.ts",
    "category": "MEDIUM",
    "reason": "Updates or deletes an org's metric-alert rule with no role restriction."
  },
  {
    "path": "src/app/api/notifications/[id]/read/route.ts",
    "category": "LOW",
    "reason": "Marks one of the caller's own notifications as read."
  },
  {
    "path": "src/app/api/ticket-intelligence/[id]/dismiss/route.ts",
    "category": "MEDIUM",
    "reason": "Dismisses an AI-suggested ticket-intelligence item."
  },
  {
    "path": "src/app/api/ticket-teams/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a ticket routing team used for SLA policy matching."
  },
  {
    "path": "src/app/api/ticket-teams/[id]/route.ts",
    "category": "MEDIUM",
    "reason": "Updates a ticket routing team's configuration."
  },
  {
    "path": "src/app/api/tickets/[id]/dispatches/route.ts",
    "category": "MEDIUM",
    "reason": "Schedules a field-service technician dispatch for a ticket."
  },
  {
    "path": "src/app/api/tickets/[id]/installed-product/route.ts",
    "category": "MEDIUM",
    "reason": "Links or unlinks an installed product record to a ticket."
  },
  {
    "path": "src/app/api/tickets/[id]/intelligence/route.ts",
    "category": "MEDIUM",
    "reason": "Triggers a new AI intelligence analysis run on a ticket."
  },
  {
    "path": "src/app/api/training/enrollments/[id]/attempts/route.ts",
    "category": "LOW",
    "reason": "Submits the caller's own answers for a training assessment attempt tied to their own enrollment."
  },
  {
    "path": "src/app/api/veri-chat/share-links/[id]/route.ts",
    "category": "MEDIUM",
    "reason": "Revokes a VERI Chat conversation share link by id, scoped to the caller's org but with no role check on who may revoke."
  },
  {
    "path": "src/app/api/veri-chat/share-target/route.ts",
    "category": "LOW",
    "reason": "Receives OS Share-Sheet content (from the PWA share_target) and imports it into a new conversation owned by the calling user."
  },
  {
    "path": "src/app/api/veri-meetings/share-links/[linkId]/route.ts",
    "category": "MEDIUM",
    "reason": "Revokes a VERI Meetings share link by id, org-scoped but with no role gate on who may revoke."
  },
  {
    "path": "src/app/api/veri-meetings/[id]/action-items/route.ts",
    "category": "MEDIUM",
    "reason": "Adds and assigns a new action item to a meeting."
  },
  {
    "path": "src/app/api/veri-meetings/[id]/generate-intelligence/route.ts",
    "category": "MEDIUM",
    "reason": "Triggers AI-generated intelligence/analysis for a meeting."
  },
  {
    "path": "src/app/api/veri-reward/referral/route.ts",
    "category": "LOW",
    "reason": "Gets-or-creates the calling user's own shareable referral link."
  },
  {
    "path": "src/app/api/veri-reward/streak/route.ts",
    "category": "LOW",
    "reason": "Records the calling user's own daily streak check-in."
  },
  {
    "path": "src/app/api/voice-tickets/[id]/action-items/route.ts",
    "category": "MEDIUM",
    "reason": "Promotes a voice-memo suggested item into a real assigned action-item/ticket."
  },
  {
    "path": "src/app/api/worker-agents/route.ts",
    "category": "MEDIUM",
    "reason": "Proposes a new worker agent, which lands as a draft pending separate admin approval/publish."
  },
  {
    "path": "src/app/api/workspace-memory/drive-import/route.ts",
    "category": "MEDIUM",
    "reason": "Downloads the latest workspace-memory capsule from the caller's connected Drive and imports it into the org, additive-only."
  },
  {
    "path": "src/app/api/workspace-memory/import/route.ts",
    "category": "MEDIUM",
    "reason": "Imports a user-uploaded workspace-memory capsule file into the org, additive-only."
  },
  {
    "path": "src/app/api/tasks/[id]/chat/route.ts",
    "category": "MEDIUM",
    "reason": "Posts a chat message onto any task's AI chat thread for any authenticated member of the org, no ownership or role check."
  },
  {
    "path": "src/app/api/tasks/[id]/comments/route.ts",
    "category": "MEDIUM",
    "reason": "Adds a comment (and notifies the task owner) on any task in the org, with no role or ownership gating."
  },
  {
    "path": "src/app/api/sales-hq/commission-plans/route.ts",
    "category": "LOW",
    "reason": "Creates/updates a sales commission plan; already gated to veridian_admin via requireAdmin() in the service layer, not a real authz gap."
  },
  {
    "path": "src/app/api/sales-hq/partners/route.ts",
    "category": "LOW",
    "reason": "Creates a sales partner record; already gated to veridian_admin via requireAdmin() in the service layer."
  },
  {
    "path": "src/app/api/sales-hq/partners/[id]/route.ts",
    "category": "LOW",
    "reason": "Revokes/rotates a partner's access token or suspends the partner; already gated to veridian_admin via requireAdmin() in the service layer."
  },
  {
    "path": "src/app/api/sales-hq/referral-links/route.ts",
    "category": "LOW",
    "reason": "Creates a referral link for a sales partner; already gated to veridian_admin via requireAdmin() in the service layer."
  },
  {
    "path": "src/app/api/sales-hq/visitors/analyze/route.ts",
    "category": "LOW",
    "reason": "Triggers an on-demand LLM funnel analysis; already gated to veridian_admin via an inline hasRole() check in the route."
  },
  {
    "path": "src/app/api/search/semantic/route.ts",
    "category": "MEDIUM",
    "reason": "Semantic search over an org's compliance items/notices/documents; org-scoped but returns results to any authenticated member regardless of role."
  },
  {
    "path": "src/app/api/settings/module-rules/route.ts",
    "category": "LOW",
    "reason": "Sets an org/project/client module-rule override; already gated to admin via hasRole() in the service layer."
  },
  {
    "path": "src/app/api/settings/org-limits/route.ts",
    "category": "LOW",
    "reason": "Updates org license-seat and cost-cap limits; already gated to admin/manager via an inline dbUser.role check."
  },
  {
    "path": "src/app/api/settings/passcode/route.ts",
    "category": "LOW",
    "reason": "Sets or removes the caller's own 4-digit login passcode; correctly scoped to the caller's own account only."
  },
  {
    "path": "src/app/api/settings/prompts/route.ts",
    "category": "LOW",
    "reason": "Creates a new prompt-template version; already gated via requirePromptPermissionForUser() in the service layer."
  },
  {
    "path": "src/app/api/settings/subscription-plan/route.ts",
    "category": "LOW",
    "reason": "Assigns an org's subscription plan; already gated to admin via an inline dbUser.role check."
  },
  {
    "path": "src/app/api/settings/webhooks/[id]/redeliver/route.ts",
    "category": "MEDIUM",
    "reason": "Manually replays a past webhook delivery against the org's webhook; no role check at all."
  },
  {
    "path": "src/app/api/social/posts/route.ts",
    "category": "MEDIUM",
    "reason": "Creates a social-feed post; no role check, but writes are low-stakes org social content."
  },
  {
    "path": "src/app/api/social/posts/[id]/comments/route.ts",
    "category": "MEDIUM",
    "reason": "Adds a comment to a social-feed post; no role check at all."
  },
  {
    "path": "src/app/api/social/posts/[id]/reactions/route.ts",
    "category": "MEDIUM",
    "reason": "Adds/changes the caller's reaction on a social-feed post; no role check at all."
  }
]

describe("authz-gap inventory (R75 Phase 2 drift guard)", () => {
  const onDisk = routesOnDisk()
  const mutating = onDisk.filter((r) => r.verbs.length > 0)
  const mutatingByPath = new Map(mutating.map((r) => [r.path, r]))
  const exemptPaths = new Set(EXEMPT_ROUTES.map((r) => r.path))
  const openGapPaths = new Set(KNOWN_OPEN_GAPS.map((r) => r.path))

  test("every mutating route not directly protected is either EXEMPT or a KNOWN_OPEN_GAP -- catches a NEW untracked gap", () => {
    const untracked = mutating
      .filter((r) => !r.protected && !exemptPaths.has(r.path) && !openGapPaths.has(r.path))
      .map((r) => r.path)
      .sort()
    expect(untracked).toEqual([])
  })

  test("every EXEMPT_ROUTES entry is a real, currently-unprotected mutating route on disk -- catches a stale exemption", () => {
    const stale = EXEMPT_ROUTES
      .filter((r) => {
        const info = mutatingByPath.get(r.path)
        return !info || info.protected
      })
      .map((r) => r.path)
      .sort()
    expect(stale).toEqual([])
  })

  test("every KNOWN_OPEN_GAPS entry is a real, currently-unprotected mutating route on disk -- catches a gap that was fixed without updating this list", () => {
    const stale = KNOWN_OPEN_GAPS
      .filter((r) => {
        const info = mutatingByPath.get(r.path)
        return !info || info.protected
      })
      .map((r) => r.path)
      .sort()
    expect(stale).toEqual([])
  })

  test("no path is listed in both EXEMPT_ROUTES and KNOWN_OPEN_GAPS", () => {
    const overlap = [...exemptPaths].filter((p) => openGapPaths.has(p)).sort()
    expect(overlap).toEqual([])
  })

  test("headline counts match the R75 Phase 2 audit, as of 2026-09-05", () => {
    const protectedCount = mutating.filter((r) => r.protected).length
    expect(mutating.length).toBe(831)
    expect(protectedCount).toBe(561) // 372 pre-existing + 189 fixed this phase
    expect(EXEMPT_ROUTES.length).toBe(107)
    expect(KNOWN_OPEN_GAPS.length).toBe(163)
    expect(protectedCount + EXEMPT_ROUTES.length + KNOWN_OPEN_GAPS.length).toBe(mutating.length)
  })
})
