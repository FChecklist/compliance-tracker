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
  {"path":"src/app/api/auth/sso/[orgSlug]/acs/route.ts","category":"PUBLIC_BY_DESIGN","reason":"SAML ACS endpoint that validates an IdP-signed assertion and establishes a session via a magic link."},
  {"path":"src/app/api/billing/invoices/generate/route.ts","category":"STALE","reason":"Generates a billing invoice for the caller's org; already gated to admin/manager via an inline role check, not requireRole()."},
  {"path":"src/app/api/client-portal/[token]/deliverables/[deliverableId]/submit/route.ts","category":"TOKEN_SCOPED","reason":"Client marks a portal deliverable as submitted, authenticated by a DB-validated per-client portal token."},
  {"path":"src/app/api/client-portal/[token]/documents/route.ts","category":"TOKEN_SCOPED","reason":"Client uploads a document through the portal, authenticated by a DB-validated per-client portal token."},
  {"path":"src/app/api/ai/team/log-usage/route.ts","category":"INTERNAL_SECRET","reason":"POST logs AI-team token usage from an external automation script, authenticated via a validated shared-secret header rather than a user session."},
  {"path":"src/app/api/auth/failure-event/route.ts","category":"PUBLIC_BY_DESIGN","reason":"POST records a failed login attempt for anomaly detection; intentionally an anonymous pre-auth endpoint with a generic response."},
  {"path":"src/app/api/auth/passcode-login/route.ts","category":"PUBLIC_BY_DESIGN","reason":"POST verifies an email+passcode login and returns a one-time Supabase magic-link action_link to establish the session; intentionally a public pre-auth login route."},
  {"path":"src/app/api/crm/pipeline/stages/route.ts","category":"STALE","reason":"Creates a CRM pipeline stage; actually gated by requirePermissionForUser('crm.pipeline_stages.manage'), a mechanism the grep didn't recognize."},
  {"path":"src/app/api/crm/pipeline/stages/[id]/route.ts","category":"STALE","reason":"Updates/deletes a CRM pipeline stage; both methods are actually gated by requirePermissionForUser('crm.pipeline_stages.manage')."},
  {"path":"src/app/api/contact/draft/route.ts","category":"PUBLIC_BY_DESIGN","reason":"Public unauthenticated autosave beacon for an in-progress marketing-site contact form draft."},
  {"path":"src/app/api/contact/submit/route.ts","category":"PUBLIC_BY_DESIGN","reason":"Public unauthenticated final-submit endpoint for the marketing-site contact form."},
  {"path":"src/app/api/erp/cost-centers/route.ts","category":"STALE","reason":"Creates a cost center, already gated to at least the role configured for erp.cost_centers.create via requirePermissionForUser (a requireRole wrapper)."},
  {"path":"src/app/api/erp/fixed-assets/route.ts","category":"STALE","reason":"Creates a fixed asset; already remediated to require at least the configured erp.fixed_assets.create role."},
  {"path":"src/app/api/erp/fixed-assets/categories/route.ts","category":"STALE","reason":"Creates a fixed-asset category (GL account mapping); already remediated to require manager rank."},
  {"path":"src/app/api/erp/fixed-assets/categories/[id]/route.ts","category":"STALE","reason":"Updates a fixed-asset category's GL mapping; already remediated to require manager rank."},
  {"path":"src/app/api/erp/fixed-assets/depreciation-runs/route.ts","category":"STALE","reason":"Runs a batch depreciation posting across fixed assets; already remediated to require manager rank."},
  {"path":"src/app/api/erp/fixed-assets/[id]/route.ts","category":"STALE","reason":"Updates a fixed asset record; already remediated to require at least member rank."},
  {"path":"src/app/api/erp/fixed-assets/[id]/movements/route.ts","category":"STALE","reason":"Logs a fixed-asset location/custodian movement; already remediated to require member rank."},
  {"path":"src/app/api/erp/fixed-assets/[id]/submit/route.ts","category":"STALE","reason":"Capitalizes/submits a fixed asset (posts its acquisition entry to the GL); already remediated to require manager rank."},
  {"path":"src/app/api/erp/inventory/abc-classification/route.ts","category":"STALE","reason":"Recomputes ABC inventory classification for the org; already gated to at least member rank."},
  {"path":"src/app/api/erp/inventory/cycle-count-lines/[id]/count/route.ts","category":"STALE","reason":"Records a physical cycle-count result for an inventory line; already gated to at least member rank."},
  {"path":"src/app/api/erp/inventory/cycle-count-plans/route.ts","category":"STALE","reason":"Creates a cycle-count plan for the org's inventory; already gated to at least member rank."},
  {"path":"src/app/api/erp/inventory/issues/route.ts","category":"STALE","reason":"Records a stock issue (inventory outflow) for the org; already gated to at least member rank."},
  {"path":"src/app/api/erp/inventory/receipts/route.ts","category":"STALE","reason":"Records a stock receipt (inventory inflow) for the org; already gated to at least member rank."},
  {"path":"src/app/api/erp/inventory/reorder-levels/route.ts","category":"STALE","reason":"Sets a reorder level for an inventory item/warehouse; already gated to at least member rank."},
  {"path":"src/app/api/erp/accounts/route.ts","category":"STALE","reason":"Creates a new Chart-of-Accounts GL account for the org; already gated at manager rank via requirePermissionForUser (a requireRole wrapper), not a real gap."},
  {"path":"src/app/api/erp/buying/goods-receipts/route.ts","category":"STALE","reason":"Creates a draft purchase (goods) receipt for the org; already gated at member rank via requirePermissionForUser, not a real gap."},
  {"path":"src/app/api/erp/buying/goods-receipts/[id]/landed-costs/route.ts","category":"STALE","reason":"Creates a landed-cost voucher against a goods receipt, affecting inventory valuation; already gated at manager rank via requirePermissionForUser, not a real gap."},
  {"path":"src/app/api/erp/buying/goods-receipts/[id]/submit/route.ts","category":"STALE","reason":"Submits/posts a goods receipt, moving real FIFO inventory and updating the linked PO's status; already gated at manager rank via requirePermissionForUser, not a real gap."},
  {"path":"src/app/api/erp/buying/purchase-orders/route.ts","category":"STALE","reason":"Creates a draft purchase order for the org; already gated at member rank via requirePermissionForUser, not a real gap."},
  {"path":"src/app/api/erp/cash-vouchers/route.ts","category":"STALE","reason":"Creates and immediately posts a cash voucher to the GL (moves money, fires a webhook); already gated at manager rank via requirePermissionForUser, not a real gap."},
  {"path":"src/app/api/internal/escalations-report/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered generator for the Escalations report, no persistence, POST just delegates to GET."},
  {"path":"src/app/api/internal/exchange-rate-refresh/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron job that refreshes live FX rates for every org with a base currency configured."},
  {"path":"src/app/api/internal/fm-ppm/generate-occurrences/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron job generating due PPM (planned preventive maintenance) occurrences across all orgs."},
  {"path":"src/app/api/internal/idle-ai-capacity/run/route.ts","category":"INTERNAL_SECRET","reason":"Quarterly cron report identifying unused provisioned AI model capacity."},
  {"path":"src/app/api/internal/instruction-audit/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron job running the instruction-mismatch audit."},
  {"path":"src/app/api/internal/l2-phrase-promotion/run/route.ts","category":"INTERNAL_SECRET","reason":"Nightly-only cron job running the L2 phrase-promotion batch analysis."},
  {"path":"src/app/api/internal/loops/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron entry point running all active self-improvement audit loops plus several piggybacked maintenance jobs (cache purge, cost-anomaly audit, memory projection)."},
  {"path":"src/app/api/internal/metric-alerts/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron job evaluating metric alert rules, ticket SLA/escalation breaches, task overdue detection and reprioritization, and cost ceiling breaches."},
  {"path":"src/app/api/internal/ops-task-sync/route.ts","category":"INTERNAL_SECRET","reason":"Server-to-server bridge endpoint where the ops (Hetzner) box posts autonomous coding-task checkpoint state to be upserted into opsDevTasks."},
  {"path":"src/app/api/internal/orchestra-log-purge/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron job purging expired orchestra execution log payloads past a retention window."},
  {"path":"src/app/api/internal/pipeline-stuck-deal-digest/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron job sending a digest notification for sales deals stuck in a pipeline stage too long."},
  {"path":"src/app/api/internal/recommendations-report/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered generator for the Recommendations report, no persistence layer."},
  {"path":"src/app/api/internal/report-schedules/run/route.ts","category":"INTERNAL_SECRET","reason":"Daily cron job that fires any report_schedules rows whose cadence is due."},
  {"path":"src/app/api/internal/risk-trends-report/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered generator for the Risk-Trends report over a 7-day window."},
  {"path":"src/app/api/internal/role-quality-regression/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron job running per-role AI model quality regression checks and persisting results."},
  {"path":"src/app/api/internal/routing-accuracy-report/run/route.ts","category":"INTERNAL_SECRET","reason":"Weekly cron job generating the AI Orchestra routing-accuracy report."},
  {"path":"src/app/api/internal/secrets-audit/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron job auditing that required production env vars/secrets are actually set, logging/erroring if any are missing."},
  {"path":"src/app/api/internal/task-nudge-digest/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron job sending a batched digest nudging users toward incomplete tasks."},
  {"path":"src/app/api/internal/the-firm/deadline-digest/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron job computing upcoming compliance/tax-case/engagement deadlines across all THE FIRM-enabled orgs."},
  {"path":"src/app/api/internal/the-firm/recur-engagements/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron job cloning recurring engagements whose next occurrence date has arrived, across all THE FIRM-enabled orgs."},
  {"path":"src/app/api/internal/ai-performance-report/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered daily AI performance report generator, gated by CRON_SECRET bearer check."},
  {"path":"src/app/api/internal/ai-reduction-snapshot/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered monthly AI-reduction usage snapshot, gated by CRON_SECRET bearer check."},
  {"path":"src/app/api/internal/audit-cadence/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered daily L2/L4 audit-cadence compliance scan, gated by CRON_SECRET bearer check."},
  {"path":"src/app/api/internal/capability-audit/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered sweep that LLM-audits due task_capabilities rows, gated by CRON_SECRET bearer check."},
  {"path":"src/app/api/internal/cost-anomalies/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered daily AI cost-anomaly detection report, gated by CRON_SECRET bearer check."},
  {"path":"src/app/api/internal/crm-data-integrity/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered weekly CRM orphaned-lead-reference integrity check across all orgs, gated by CRON_SECRET bearer check."},
  {"path":"src/app/api/internal/crm-lead-followup-alerts/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered daily job that notifies lead owners of overdue follow-ups across all orgs, gated by CRON_SECRET bearer check."},
  {"path":"src/app/api/internal/crm-lead-scoring/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered daily auto-scoring of new/stale CRM leads across all orgs, gated by CRON_SECRET bearer check."},
  {"path":"src/app/api/internal/crr-catchup-worker/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered worker that re-drives stuck document extraction/embedding rows to completion, gated by CRON_SECRET bearer check."},
  {"path":"src/app/api/internal/dispatch-completion-monitor/run/route.ts","category":"INTERNAL_SECRET","reason":"Cron-triggered daily dispatch-completion staleness sweep across all orgs, gated by CRON_SECRET bearer check."},
  {"path":"src/app/api/erp/procurement/quotations/route.ts","category":"STALE","reason":"Creates a supplier quotation for the org's RFQ workflow; correctly gated at member role via requirePermissionForUser."},
  {"path":"src/app/api/erp/procurement/rfqs/route.ts","category":"STALE","reason":"Creates an RFQ for the org's procurement workflow; correctly gated at member role via requirePermissionForUser."},
  {"path":"src/app/api/erp/procurement/rfqs/[id]/send/route.ts","category":"STALE","reason":"Marks an RFQ as sent to suppliers; correctly gated at member role via requirePermissionForUser."},
  {"path":"src/app/api/erp/purchase-credit-notes/route.ts","category":"STALE","reason":"Creates a draft purchase credit note; correctly gated at member role via requirePermissionForUser."},
  {"path":"src/app/api/erp/purchase-credit-notes/[id]/submit/route.ts","category":"STALE","reason":"Posts a purchase credit note's reversing GL entries; correctly gated at manager role via requirePermissionForUser."},
  {"path":"src/app/api/erp/returns/purchase/[id]/credit-note/route.ts","category":"STALE","reason":"Links a purchase return to a credit note; correctly gated at member role via requirePermissionForUser."},
  {"path":"src/app/api/erp/returns/sales/[id]/credit-note/route.ts","category":"STALE","reason":"Links a sales return to a credit note; correctly gated at member role via requirePermissionForUser."},
  {"path":"src/app/api/erp/sales-credit-notes/route.ts","category":"STALE","reason":"Creates a draft sales credit note; correctly gated at member role via requirePermissionForUser."},
  {"path":"src/app/api/erp/sales-credit-notes/[id]/submit/route.ts","category":"STALE","reason":"Posts a sales credit note's reversing GL entries; correctly gated at manager role via requirePermissionForUser."},
  {"path":"src/app/api/erp/sales-invoices/route.ts","category":"STALE","reason":"Creates a draft sales invoice; correctly gated at member role via requirePermissionForUser."},
  {"path":"src/app/api/erp/sales-invoices/[id]/e-invoice/route.ts","category":"STALE","reason":"Generates an e-invoice payload for a sales invoice; correctly gated at member role via requirePermissionForUser."},
  {"path":"src/app/api/erp/sales-invoices/[id]/submit/route.ts","category":"STALE","reason":"Posts a sales invoice to the GL and fires a financial webhook; correctly gated at manager role via requirePermissionForUser."},
  {"path":"src/app/api/erp/journal-entries/route.ts","category":"STALE","reason":"Creates a draft journal entry, gated at member rank via requirePermissionForUser (a requireRole wrapper the grep missed)."},
  {"path":"src/app/api/erp/journal-entries/[id]/submit/route.ts","category":"STALE","reason":"Posts (submits) a journal entry to the general ledger, gated at manager rank via requirePermissionForUser."},
  {"path":"src/app/api/erp/payment-entries/[id]/decide/route.ts","category":"STALE","reason":"Approves/rejects a payment entry; protected by a real manager-rank-or-above service-layer gate (canDecidePaymentEntry) the grep couldn't see."},
  {"path":"src/app/api/erp/statistical-key-figure-postings/route.ts","category":"TOKEN_SCOPED","reason":"Posts a statistical key figure value (CO-006 actual/plan posting); actually gated by requirePermissionForUser->requireRole, not a real gap."},
  {"path":"src/app/api/erp/statistical-key-figure-types/route.ts","category":"TOKEN_SCOPED","reason":"Creates statistical key figure master-data types; actually gated by requirePermissionForUser->requireRole, not a real gap."},
  {"path":"src/app/api/esignature/sign/[token]/decline/route.ts","category":"TOKEN_SCOPED","reason":"Lets an external signer decline a signature via their emailed per-signer access token, validated against the DB with expiry."},
  {"path":"src/app/api/esignature/sign/[token]/submit/route.ts","category":"TOKEN_SCOPED","reason":"Lets an external signer submit their signature via a DB-validated per-signer access token in the URL."},
  {"path":"src/app/api/finance/ai-cost-reconciliation/route.ts","category":"TOKEN_SCOPED","reason":"Records/lists AI-cost reconciliation entries against actual provider invoices; actually gated by an inline dbUser.role !== 'veridian_admin' check, not a real gap."},
  {"path":"src/app/api/forge/submit/route.ts","category":"PUBLIC_BY_DESIGN","reason":"Public marketing/intake form submission endpoint for the Forge product, intentionally open to anonymous visitors."},
  {"path":"src/app/api/guest-chat/[token]/messages/route.ts","category":"TOKEN_SCOPED","reason":"Lets a guest post a chat message into their token-scoped support conversation; the token is looked up and expiry/revocation-checked in the DB."},
  {"path":"src/app/api/guest-chat/[token]/survey/route.ts","category":"TOKEN_SCOPED","reason":"Lets a guest submit a CSAT/NPS satisfaction survey for their resolved support ticket via a validated, expiry-checked token."},
  {"path":"src/app/api/public/portal/[orgSlug]/tickets/route.ts","category":"PUBLIC_BY_DESIGN","reason":"Public, rate-limited endpoint letting anonymous visitors submit a support ticket to a specific org's helpdesk via its slug."},
  {"path":"src/app/api/v1/platform/provision-org/route.ts","category":"INTERNAL_SECRET","reason":"Service-to-service endpoint letting a trusted platform application provision a brand-new VERIDIAN org and its first API key."},
  {"path":"src/app/api/v1/projexa/quotations/[id]/convert/route.ts","category":"STALE","reason":"Converts an approved/sent quotation into a sales order, gated by permission-service's role-mapped check."},
  {"path":"src/app/api/v1/projexa/quotations/[id]/revisions/route.ts","category":"STALE","reason":"Creates a new revision of a quotation, gated by permission-service's role-mapped check."},
  {"path":"src/app/api/v1/projexa/sales-orders/[id]/route.ts","category":"STALE","reason":"Updates a sales order's status through a lifecycle transition table, gated by permission-service's manager-rank check."},
  {"path":"src/app/api/vendor-portal/[token]/auctions/[auctionId]/bid/route.ts","category":"TOKEN_SCOPED","reason":"Lets an invited supplier submit a reverse-auction bid using their vendor-portal token."},
  {"path":"src/app/api/vendor-portal/[token]/bank-account/route.ts","category":"TOKEN_SCOPED","reason":"Lets a vendor submit a new bank account for themselves via their portal token."},
  {"path":"src/app/api/pms/billable-rates/route.ts","category":"STALE","reason":"Sets a project's/employee's billable rate; already correctly gated to admin+ via an inline hasRole() check the text search missed."},
  {"path":"src/app/api/pms/issue-statuses/route.ts","category":"STALE","reason":"Creates a project issue-status; already correctly gated to admin+ inside the service layer, invisible to a route-level text search."},
  {"path":"src/app/api/pms/issue-types/route.ts","category":"STALE","reason":"Creates a project issue-type; already correctly gated to admin+ inside the service layer, invisible to a route-level text search."},
  {"path":"src/app/api/invite-links/route.ts","category":"STALE","reason":"Lists and creates org invite links, gated inline to admin/manager roles."},
  {"path":"src/app/api/invite-links/[id]/route.ts","category":"STALE","reason":"Revokes an org invite link, gated inline to admin/manager roles."},
  {"path":"src/app/api/join-code/preview/route.ts","category":"PUBLIC_BY_DESIGN","reason":"Public pre-signup preview of what org/role a join code would grant."},
  {"path":"src/app/api/join-codes/route.ts","category":"STALE","reason":"Lets any org member mint/list join codes, rank-ceilinged and quota-limited by design."},
  {"path":"src/app/api/join-codes/[id]/route.ts","category":"STALE","reason":"Revokes a join code; non-privileged callers restricted to codes they created."},
  {"path":"src/app/api/mcp/route.ts","category":"TOKEN_SCOPED","reason":"Customer-facing MCP JSON-RPC server authenticated via a real hashed-and-looked-up API-key Bearer token."},
  {"path":"src/app/api/mcp/[token]/route.ts","category":"TOKEN_SCOPED","reason":"Per-user AI-link MCP endpoint authenticated by a real validated per-user token in the URL."},
  {"path":"src/app/api/me/route.ts","category":"STALE","reason":"Updates the caller's own profile name freely and org details only if the caller is an admin."},
  {"path":"src/app/api/track/route.ts","category":"PUBLIC_BY_DESIGN","reason":"Records an anonymous visitor analytics event from public marketing pages."},
  {"path":"src/app/api/track/offer/route.ts","category":"PUBLIC_BY_DESIGN","reason":"Decides and logs an anonymous exit-intent marketing offer for a visitor."},
  {"path":"src/app/api/webhooks/vercel-deployment/route.ts","category":"INTERNAL_SECRET","reason":"Receives Vercel's deployment webhook and records a deployment event, authenticated via HMAC signature rather than a user session."},
  {"path":"src/app/api/stage0/conversations/[id]/messages/route.ts","category":"TOKEN_SCOPED","reason":"Stage-0 user posts/reads messages in a specific conversation, gated by a real per-resource active-membership DB check, not by requireRole."},
  {"path":"src/app/api/support-sessions/[id]/end/route.ts","category":"TOKEN_SCOPED","reason":"Ends a support/impersonation session early, gated by hasRole() checks for either veridian_admin or the specific target org's own admin."},
  {"path":"src/app/api/training/enrollments/[id]/start/route.ts","category":"SERVICE_LAYER_GATED","reason":"R75P2P5-G8 ownership-bypass fix: startEnrollment() in training-service.ts checks enrollment.employeeId !== ctx.userId -> 403 before flipping status, matching submitAttempt()'s own no-manager-override convention; the grep's requireRole()/requireRoleOrScope() scan can't see a service-layer ownership check."},
  {"path":"src/app/api/training/enrollments/[id]/complete/route.ts","category":"SERVICE_LAYER_GATED","reason":"R75P2P5-G8 ownership-bypass fix: markCourseComplete() in training-service.ts checks enrollment.employeeId !== ctx.userId -> 403 before marking complete, same convention as startEnrollment(); not visible to the route-file requireRole() grep."},
  {"path":"src/app/api/connectors/route.ts","category":"SERVICE_LAYER_GATED","reason":"Starts an OAuth connection flow; POST/GET filter to eq(connectorAccounts.userId, dbUser.id), self-scoped to the caller's own connector account (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/connectors/[toolkit]/sync/route.ts","category":"SERVICE_LAYER_GATED","reason":"Re-checks OAuth connection status; query and update both filter to eq(connectorAccounts.userId, dbUser.id), self-scoped (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/ai/team/capability-improvements/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"POST close/reject actions gated by an inline `dbUser.role !== 'veridian_admin'` check (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/ai/team/dispatch/route.ts","category":"SERVICE_LAYER_GATED","reason":"POST and PATCH both gated by an inline `dbUser.role !== 'veridian_admin'` check (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/ai/team/executive-review/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"POST gated by an inline `dbUser.role !== 'veridian_admin'` check (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/ai/team/monitor/dispatch-completion/route.ts","category":"SERVICE_LAYER_GATED","reason":"POST gated by an inline `dbUser.role !== 'veridian_admin'` check (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/ai/team/provider-outages/route.ts","category":"SERVICE_LAYER_GATED","reason":"GET and POST both gated by an inline `dbUser.role !== 'veridian_admin'` check (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/ai/team/re-audit/route.ts","category":"SERVICE_LAYER_GATED","reason":"GET and POST both gated by an inline `dbUser.role !== 'veridian_admin'` check (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/ai/team/re-audit/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"DELETE gated by an inline `dbUser.role !== 'veridian_admin'` check (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/ai/team/review/route.ts","category":"SERVICE_LAYER_GATED","reason":"POST gated by an inline `dbUser.role !== 'veridian_admin'` check (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/ai/team/review-registry/route.ts","category":"SERVICE_LAYER_GATED","reason":"GET and POST both gated by an inline `dbUser.role !== 'veridian_admin'` check (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/ai/team/role-quality/route.ts","category":"SERVICE_LAYER_GATED","reason":"GET and POST both gated by an inline `dbUser.role !== 'veridian_admin'` check (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/ai-link/route.ts","category":"SERVICE_LAYER_GATED","reason":"Rotates the signed-in user's own AI-delegation link; revokeUserAiLink/getOrCreateUserAiLink receive only the authenticated caller's own id (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/assistants/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"PATCH runs inside withTenantContext with userId: dbUser.id; Postgres RLS policy enforces current_user_id() = ai_assistants.user_id (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/assistants/[id]/memories/route.ts","category":"SERVICE_LAYER_GATED","reason":"POST performs an RLS-protected assistant lookup (same user_id policy as assistants/[id]) before creating the memory, enforcing ownership transitively (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/sales-pipeline/summary/route.ts","category":"SERVICE_LAYER_GATED","reason":"resolveViewerScope() forces non-manager callers to their own data only -- a real role-based scoping mechanism, not a text-searchable role gate (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/delegations/route.ts","category":"SERVICE_LAYER_GATED","reason":"POST always sets delegatorUserId: dbUser.id -- a delegation can only ever be created in the caller's own name (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/delegations/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"revokeDelegation() checks `existing.delegatorUserId !== ctx.userId` and refuses if the caller is not the original delegator (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/conversations/workflow-thread/route.ts","category":"SERVICE_LAYER_GATED","reason":"createWorkflowThread() is created with userId: dbUser.id -- the caller is always the sole participant (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/conversations/[id]/messages/route.ts","category":"SERVICE_LAYER_GATED","reason":"sendMessage() calls assertParticipant(db, conversationId, ctx.userId) before sending (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/conversations/[id]/read/route.ts","category":"SERVICE_LAYER_GATED","reason":"markConversationRead() calls assertParticipant() and updates only the caller's own participant row (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/conversations/[id]/regenerate/route.ts","category":"SERVICE_LAYER_GATED","reason":"regenerateAiReply() calls assertParticipant(db, conversationId, ctx.userId) before regenerating (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/conversations/[id]/veri-participant/route.ts","category":"SERVICE_LAYER_GATED","reason":"setVeriGroupParticipant() calls assertParticipant() before modifying VERI's participation (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/accounts/route.ts","category":"SERVICE_LAYER_GATED","reason":"createAccount() calls assertGate(canCreateCrmRecord(ctx.dbUser.role)), requiring member rank or higher (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/accounts/bulk-reassign/route.ts","category":"SERVICE_LAYER_GATED","reason":"bulkReassignAccounts() calls assertGate(canReassignOrDeleteAccount(ctx.dbUser.role)), requiring manager rank or higher (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/accounts/import/route.ts","category":"SERVICE_LAYER_GATED","reason":"importAccountsFromRows() calls assertGate(canCreateCrmRecord(ctx.dbUser.role)), requiring member rank or higher (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/accounts/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"updateAccount/deleteAccount call canEditAccount / assertGate(canReassignOrDeleteAccount), requiring member-rank-or-owner (manager rank for reassignment/delete) (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/accounts/[id]/analyze/route.ts","category":"SERVICE_LAYER_GATED","reason":"analyzeAccountHealth() calls assertGate(canEditAccount(...)), requiring member rank + ownership or manager rank (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/accounts/[id]/contacts/route.ts","category":"SERVICE_LAYER_GATED","reason":"createContact() calls assertGate(canEditAccount(...)), the same gate as editing the parent account (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/accounts/[id]/link-opportunity/route.ts","category":"SERVICE_LAYER_GATED","reason":"linkOpportunityToAccount() calls assertGate(canEditAccount(...)), the same gate as editing the parent account (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/contacts/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"updateContact/deleteContact both call assertGate(canEditAccount(...)), requiring member rank + ownership or manager rank (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/enablement/route.ts","category":"SERVICE_LAYER_GATED","reason":"enableProductBranchForOrg/disableProductBranchForOrg both check `!hasRole(ctx.dbUser, \"admin\")` and throw (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/leads/route.ts","category":"SERVICE_LAYER_GATED","reason":"createLead() calls assertGate(canCreateCrmRecord(ctx.role)), requiring member rank (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/leads/bulk-reassign/route.ts","category":"SERVICE_LAYER_GATED","reason":"bulkReassignLeads() calls assertGate(canReassignOrDeleteLead(ctx.role)), requiring manager rank (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/leads/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"updateLead/deleteLead call canEditLead / assertGate(canReassignOrDeleteLead), requiring the appropriate rank (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/leads/[id]/convert-to-account/route.ts","category":"SERVICE_LAYER_GATED","reason":"convertLeadToAccount() calls assertGate(canCreateCrmRecord(ctx.dbUser.role)), requiring member rank (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/opportunities/route.ts","category":"SERVICE_LAYER_GATED","reason":"createOpportunity() enforces canCreateCrmRecord(ctx.role), requiring MEMBER_RANK and blocking viewer/client_viewer/external_auditor (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/opportunities/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"PATCH/DELETE enforce canReassignOrDeleteOpportunity or canEditOpportunity by rank (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/erp/bank-reconciliation/import/route.ts","category":"SERVICE_LAYER_GATED","reason":"requirePermissionForUser(dbUser, 'erp.banking.import_statement') enforces member-rank permission (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/erp/bank-reconciliation/lines/[id]/ignore/route.ts","category":"SERVICE_LAYER_GATED","reason":"requirePermissionForUser(dbUser, 'erp.banking.ignore_line') enforces member-rank permission (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/erp/bank-reconciliation/lines/[id]/match/route.ts","category":"SERVICE_LAYER_GATED","reason":"requirePermissionForUser(dbUser, 'erp.banking.match_line') enforces member-rank permission (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/erp/buying/goods-receipts/items/[itemId]/putaway/route.ts","category":"SERVICE_LAYER_GATED","reason":"requirePermissionForUser(dbUser, 'erp.goods_receipts.update_putaway') enforces member-rank permission (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/erp/buying/goods-receipts/[id]/putaway/route.ts","category":"SERVICE_LAYER_GATED","reason":"requirePermissionForUser(dbUser, 'erp.goods_receipts.putaway') enforces member-rank permission (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/erp/cash-accounts/route.ts","category":"SERVICE_LAYER_GATED","reason":"requirePermissionForUser(dbUser, 'erp.cash_accounts.create') enforces member-rank permission (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/hr/expenses/route.ts","category":"SERVICE_LAYER_GATED","reason":"createExpenseClaim() is called with userId: dbUser.id -- self-scoped to the caller's own claim (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/hr/leave-requests/route.ts","category":"SERVICE_LAYER_GATED","reason":"requestLeave() is called with userId: dbUser.id -- self-scoped to the caller's own request (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/hr/loans/route.ts","category":"SERVICE_LAYER_GATED","reason":"requestLoan() is called with userId: dbUser.id -- self-scoped to the caller's own application (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/instruction-mismatches/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"resolveInstructionMismatch() checks `commitment.assignerId !== ctx.userId` and refuses if the caller is not the original assigner (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/hr/attendance/route.ts","category":"SERVICE_LAYER_GATED","reason":"Self-marking is intentionally open; marking someone ELSE's attendance requires requirePermissionForUser(dbUser, 'erp.hr_attendance.mark_other') (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/hr/attendance/bulk/route.ts","category":"SERVICE_LAYER_GATED","reason":"requirePermissionForUser(dbUser, 'erp.hr_attendance.mark_other') is called unconditionally before any bulk update (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/hr/attendance/check-in/route.ts","category":"SERVICE_LAYER_GATED","reason":"Always scoped to userId: dbUser.id -- the caller can only check themself in (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/hr/attendance/check-out/route.ts","category":"SERVICE_LAYER_GATED","reason":"Always scoped to userId: dbUser.id -- the caller can only check themself out (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/hr/attendance/holidays/route.ts","category":"SERVICE_LAYER_GATED","reason":"requirePermissionForUser(dbUser, 'erp.hr_attendance.holiday_manage') is required before creating a holiday (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/hr/attendance/holidays/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"requirePermissionForUser(dbUser, 'erp.hr_attendance.holiday_manage') is required before deleting a holiday (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/pms/time-entries/route.ts","category":"SERVICE_LAYER_GATED","reason":"logTime() always writes userId: ctx.userId -- self-scoped to the caller's own time entry (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/pms/time-entries/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"deleteTimeEntry() checks `existing.userId !== ctx.userId` and refuses otherwise (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/pms/time-entries/[id]/submit/route.ts","category":"SERVICE_LAYER_GATED","reason":"submitTimeEntry() checks `existing.userId !== ctx.userId` and refuses otherwise (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/prompt-eval/cases/route.ts","category":"SERVICE_LAYER_GATED","reason":"createEvalCase() calls requirePromptPermissionForUser(ctx.dbUser, 'prompt.eval.create_case') (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/prompt-os/localize/route.ts","category":"SERVICE_LAYER_GATED","reason":"localizePromptVersion() calls requirePromptPermissionForUser(ctx.dbUser, 'prompt.localization.create') (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/v1/projexa/timesheets/[id]/submit/route.ts","category":"SERVICE_LAYER_GATED","reason":"submitTimeEntry() checks `existing.userId !== ctx.userId` via the established acting-user proxy pattern (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/veri-chat/conversations/[id]/context/route.ts","category":"SERVICE_LAYER_GATED","reason":"setConversationContext() calls assertParticipant(ctx.orgId, ctx.userId, conversationId) (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/veri-chat/conversations/[id]/guest-access/route.ts","category":"SERVICE_LAYER_GATED","reason":"createGuestAccess()/listGuestAccess() both call assertParticipant() (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/veri-chat/conversations/[id]/share-links/route.ts","category":"SERVICE_LAYER_GATED","reason":"createShareLink()/listShareLinks() both call assertParticipant() (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/veri-chat/guest-access/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"revokeGuestAccess() calls assertParticipant() after loading the record (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/veri-chat/messages/[id]/attachments/route.ts","category":"SERVICE_LAYER_GATED","reason":"attachDocumentToMessage() calls assertParticipant() after loading the message (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/pms/saved-views/route.ts","category":"SERVICE_LAYER_GATED","reason":"createSavedView() always sets ownedById: ctx.userId (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/pms/saved-views/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"updateSavedView/deleteSavedView both check `existing.ownedById !== ctx.userId` (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/me/onboarding-stage/route.ts","category":"SERVICE_LAYER_GATED","reason":"PATCH updates users WHERE eq(users.id, dbUser.id) -- restricted to the caller's own record (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/notifications/[id]/read/route.ts","category":"SERVICE_LAYER_GATED","reason":"Route checks eq(notifications.userId, dbUser.id) before allowing the PATCH (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/tickets/[id]/intelligence/route.ts","category":"SERVICE_LAYER_GATED","reason":"analyzeTicket() calls getTicket() which invokes assertParticipant() (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/training/enrollments/[id]/attempts/route.ts","category":"SERVICE_LAYER_GATED","reason":"submitAttempt() throws 403 if `enrollment.employeeId !== ctx.userId` (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/veri-chat/share-links/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"revokeShareLink() calls assertParticipant() before allowing revocation (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/veri-chat/share-target/route.ts","category":"SERVICE_LAYER_GATED","reason":"importSharedContent() creates/retrieves a conversation with contextEntityId=userId -- restricted to the caller's own inbox (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/veri-reward/referral/route.ts","category":"SERVICE_LAYER_GATED","reason":"getOrCreateReferralLink() is called with dbUser.id -- restricted to the caller's own referral link (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/veri-reward/streak/route.ts","category":"SERVICE_LAYER_GATED","reason":"recordStreakCheckIn() is called with dbUser.id -- restricted to the caller's own streak (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/sales-hq/commission-plans/route.ts","category":"SERVICE_LAYER_GATED","reason":"createOrUpdateCommissionPlan() calls requireAdmin(ctx), enforcing veridian_admin (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/sales-hq/partners/route.ts","category":"SERVICE_LAYER_GATED","reason":"createSalesPartner() calls requireAdmin(ctx), enforcing veridian_admin (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/sales-hq/partners/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"revokePartnerToken/rotatePartnerToken/suspendSalesPartner all call requireAdmin(ctx) (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/sales-hq/referral-links/route.ts","category":"SERVICE_LAYER_GATED","reason":"createReferralLink() calls requireAdmin(ctx), enforcing veridian_admin (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/sales-hq/visitors/analyze/route.ts","category":"SERVICE_LAYER_GATED","reason":"Inline `!hasRole(dbUser, \"veridian_admin\")` check returns 403 before analyzeFunnelWithAI (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/settings/module-rules/route.ts","category":"SERVICE_LAYER_GATED","reason":"module-rule-service.ts enforces `if (!hasRole(ctx.dbUser, \"admin\")) throw` (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/settings/org-limits/route.ts","category":"SERVICE_LAYER_GATED","reason":"Inline check requires `dbUser.role === \"admin\" || dbUser.role === \"manager\"` (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/settings/passcode/route.ts","category":"SERVICE_LAYER_GATED","reason":"setPasscode(dbUser.id, passcode) is self-scoped to the caller's own account (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/settings/prompts/route.ts","category":"SERVICE_LAYER_GATED","reason":"requirePromptPermissionForUser(ctx.dbUser, 'prompt.version.create') enforces veridian_admin (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/settings/subscription-plan/route.ts","category":"SERVICE_LAYER_GATED","reason":"Inline check requires `dbUser.role === \"admin\"` (R75P2 W2-01 re-verify)."},
  {"path":"src/app/api/crm/opportunities/[id]/follow-up-task/route.ts","category":"SERVICE_LAYER_GATED","reason":"R75P2P5-G2: createFollowUpTaskFromOpportunity() calls assertGate(canEditOpportunity(role, opp.ownerId, userId)), owner-or-manager -- not visible to the requireRole()/requireRoleOrScope() route-file grep."},
  {"path":"src/app/api/crm/activities/route.ts","category":"SERVICE_LAYER_GATED","reason":"R75P2P5-G2: createActivity() calls assertGate(canCreateCrmRecord(role)), member rank+ -- not visible to the grep."},
  {"path":"src/app/api/crm/leads/[id]/follow-up-task/route.ts","category":"SERVICE_LAYER_GATED","reason":"R75P2P5-G2: createFollowUpTaskFromLead() calls assertGate(canEditLead(role, lead.ownerId, userId)), owner-or-manager -- not visible to the grep."},
  {"path":"src/app/api/crm/leads/[id]/score/route.ts","category":"SERVICE_LAYER_GATED","reason":"R75P2P5-G2: scoreLead() calls assertGate(canEditLead(role, lead.ownerId, userId)), owner-or-manager -- not visible to the grep. Falsifiability personally re-verified: disabling the gate line made 2 tests fail, restoring it made all 90 pass."},
  {"path":"src/app/api/crm/lost-reasons/route.ts","category":"SERVICE_LAYER_GATED","reason":"R75P2P5-G2: POST calls requirePermissionForUser(dbUser, \"crm.lost_reasons.manage\") against a new manager-rank ERP_ACTION_ROLES entry, matching the sibling crm.pipeline_stages.manage mechanism; GET stays ungated by design (read access, matches this table's own convention)."},
  {"path":"src/app/api/crm/lost-reasons/[id]/route.ts","category":"SERVICE_LAYER_GATED","reason":"R75P2P5-G2: PATCH calls requirePermissionForUser(dbUser, \"crm.lost_reasons.manage\"), same registry entry as crm/lost-reasons above."},
  {"path":"src/app/api/crm/opportunities/[id]/analyze/route.ts","category":"SERVICE_LAYER_GATED","reason":"R75P2P5-G2: analyzeOpportunity() calls assertGate(canEditOpportunity(role, opp.ownerId, userId)), owner-or-manager -- not visible to the grep."}
]

const KNOWN_OPEN_GAPS: Array<{ path: string; category: string; reason: string }> = [
  {"path":"src/app/api/document-correspondents/route.ts","category":"MEDIUM","reason":"Creates an org-wide document correspondent register entry with no role check beyond authentication."},
  {"path":"src/app/api/document-matching-rules/route.ts","category":"MEDIUM","reason":"Creates an org-wide document auto-classification matching rule with no role check beyond authentication."},
  {"path":"src/app/api/drafted-communications/route.ts","category":"MEDIUM","reason":"Creates an AI-drafted communication held for later approval, with no role check beyond authentication."},
  {"path":"src/app/api/drafted-communications/[id]/reject/route.ts","category":"MEDIUM","reason":"Rejects an AI-drafted communication (prevents it from being sent), with no role check beyond authentication."},
  {"path":"src/app/api/erp/parties/[type]/[id]/addresses/route.ts","category":"MEDIUM","reason":"Adds a new address to a customer/supplier party record with no role check beyond being logged into the org."},
  {"path":"src/app/api/erp/parties/[type]/[id]/contacts/route.ts","category":"MEDIUM","reason":"Adds a new contact to a customer/supplier party record with no role check beyond org membership."},
  {"path":"src/app/api/escalation-rules/route.ts","category":"MEDIUM","reason":"Creates a helpdesk SLA escalation rule with only session auth, no role check despite being intended as admin-only."},
  {"path":"src/app/api/field-service-dispatches/[dispatchId]/route.ts","category":"MEDIUM","reason":"Updates a field-service dispatch's status/notes for the caller's org with only session auth, no role check."},
  {"path":"src/app/api/glossary/route.ts","category":"MEDIUM","reason":"Creates a compliance glossary term for the caller's org with no role restriction beyond authentication."},
  {"path":"src/app/api/glossary/[id]/route.ts","category":"MEDIUM","reason":"Updates or deletes a single glossary term by id, org-scoped, with no role gate."},
  {"path":"src/app/api/gst-reconciliation/returns/[returnPeriodId]/ai-review/route.ts","category":"MEDIUM","reason":"Generates an AI review report over a previously-generated GST return period, org-scoped, with no role gate."},
  {"path":"src/app/api/help/ask/route.ts","category":"MEDIUM","reason":"Answers a free-text in-app help question using an LLM pipeline, gated only by authentication, no per-role restriction."},
  {"path":"src/app/api/reports/ai-builder/analyze/route.ts","category":"MEDIUM","reason":"Uploads a file and asks the AI report builder to propose a report definition from it, scoped to the caller's org."},
  {"path":"src/app/api/reports/definitions/route.ts","category":"MEDIUM","reason":"Creates a new report definition (report engine config) scoped to the caller's org."},
  {"path":"src/app/api/reports/definitions/[id]/route.ts","category":"MEDIUM","reason":"Updates or deletes a report definition scoped to the caller's org."},
  {"path":"src/app/api/reports/item-actions/route.ts","category":"MEDIUM","reason":"Records that the current user took an action (accept/delegate/todo) on a report row, scoped to the caller's org."},
  {"path":"src/app/api/reports/saved/route.ts","category":"MEDIUM","reason":"Saves a custom report configuration scoped to the caller's org."},
  {"path":"src/app/api/reports/saved/[id]/route.ts","category":"MEDIUM","reason":"Updates or deletes a saved custom report scoped to the caller's org."},
  {"path":"src/app/api/reports/schedules/route.ts","category":"MEDIUM","reason":"Creates a recurring report delivery schedule scoped to the caller's org."},
  {"path":"src/app/api/reports/schedules/[id]/route.ts","category":"MEDIUM","reason":"Updates or deletes a scheduled report delivery configuration scoped to the caller's org."},
  {"path":"src/app/api/pms/wiki/route.ts","category":"MEDIUM","reason":"Creates a PMS wiki page under a given project, org-scoped, with no role check."},
  {"path":"src/app/api/pms/wiki/[id]/route.ts","category":"MEDIUM","reason":"Updates an existing PMS wiki page with no role check."},
  {"path":"src/app/api/problem-records/[id]/tickets/route.ts","category":"MEDIUM","reason":"Links an existing ticket to a problem record with no role check."},
  {"path":"src/app/api/v1/projexa/reports/definitions/[id]/run/route.ts","category":"MEDIUM","reason":"Executes a saved report definition and returns its computed result, with no role/permission gate beyond generic auth."},
  {"path":"src/app/api/pms/estimate-schemes/route.ts","category":"MEDIUM","reason":"Lets any authenticated org member create a project's estimate-point scheme (config), unlike sibling taxonomy endpoints that are admin-gated."},
  {"path":"src/app/api/pms/issues/[id]/relations/route.ts","category":"MEDIUM","reason":"Lets any authenticated org member link any two project issues together with no role check."},
  {"path":"src/app/api/pms/labels/route.ts","category":"MEDIUM","reason":"Lets any authenticated org member create a project label (low-stakes taxonomy item) with no role check."},
  {"path":"src/app/api/pms/meetings/route.ts","category":"MEDIUM","reason":"Lets any authenticated org member schedule a project meeting with no role check."},
  {"path":"src/app/api/pms/meetings/[id]/outcomes/route.ts","category":"MEDIUM","reason":"Lets any authenticated org member append outcome notes to any project meeting with no role check."},
  {"path":"src/app/api/ticket-intelligence/[id]/dismiss/route.ts","category":"MEDIUM","reason":"Dismisses an AI-suggested ticket-intelligence item."},
  {"path":"src/app/api/ticket-teams/route.ts","category":"MEDIUM","reason":"Creates a ticket routing team used for SLA policy matching."},
  {"path":"src/app/api/ticket-teams/[id]/route.ts","category":"MEDIUM","reason":"Updates a ticket routing team's configuration."},
  {"path":"src/app/api/tickets/[id]/dispatches/route.ts","category":"MEDIUM","reason":"Schedules a field-service technician dispatch for a ticket."},
  {"path":"src/app/api/tickets/[id]/installed-product/route.ts","category":"MEDIUM","reason":"Links or unlinks an installed product record to a ticket."},
  {"path":"src/app/api/veri-meetings/share-links/[linkId]/route.ts","category":"MEDIUM","reason":"Revokes a VERI Meetings share link by id, org-scoped but with no role gate on who may revoke."},
  {"path":"src/app/api/veri-meetings/[id]/action-items/route.ts","category":"MEDIUM","reason":"Adds and assigns a new action item to a meeting."},
  {"path":"src/app/api/veri-meetings/[id]/generate-intelligence/route.ts","category":"MEDIUM","reason":"Triggers AI-generated intelligence/analysis for a meeting."},
  {"path":"src/app/api/voice-tickets/[id]/action-items/route.ts","category":"MEDIUM","reason":"Promotes a voice-memo suggested item into a real assigned action-item/ticket."},
  {"path":"src/app/api/search/semantic/route.ts","category":"MEDIUM","reason":"Semantic search over an org's compliance items/notices/documents; org-scoped but returns results to any authenticated member regardless of role."},
  {"path":"src/app/api/settings/webhooks/[id]/redeliver/route.ts","category":"MEDIUM","reason":"Manually replays a past webhook delivery against the org's webhook; no role check at all."}
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
    expect(protectedCount).toBe(590) // +6 R75P2P5-G3 real requireRole() gates (email-intelligence/conversations/ingest)
    expect(EXEMPT_ROUTES.length).toBe(201) // +7 R75P2P5-G2 CRM service-layer gates // +2 R75P2P5-G8 training/enrollments ownership-check fixes not visible to the requireRole() grep
    expect(KNOWN_OPEN_GAPS.length).toBe(40)
    expect(protectedCount + EXEMPT_ROUTES.length + KNOWN_OPEN_GAPS.length).toBe(mutating.length)
  })
})
