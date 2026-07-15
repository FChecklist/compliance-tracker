-- Priority 19 Part 2, Workstream A (actor-column FK-vs-API-key-id fix
-- pass): companion migration to 0205/0206, closing the systematic audit of
-- every remaining compliance.users-referencing actor column
-- (control/priority19_dubai_e2e_testing_plan.md Part 2 implementation
-- plan, Workstream A(b)). Same bug class PR #349
-- (drizzle/0204_pms_issues_created_by_no_fk.sql) fixed on pms_issues.
--
-- METHOD (matches this codebase own PR #349 discipline of scoping
-- FK-drop fixes narrowly, not sweeping every column that merely shares the
-- shape): started from the full live list of compliance.users-referencing
-- actor-shaped FKs (queried directly via pg_constraint -- 49 constraints
-- across 40+ tables at audit time, well beyond the 3 this pass already
-- fixed in 0205/0206). For every one of those tables, grepped every route
-- under src/app/api/v1/projexa/** to find which ones actually reach it,
-- then read the target service function own insert/update statement to
-- confirm whether it actually sets the constrained column from
-- ctx.dbUser?.id ?? ctx.apiKey!.id (or the equivalent
-- ctx.dbUser ? ... ctx.dbUser.id ... : ... ctx.apiKey!.id actorCtx
-- pattern) -- the exact shape that inserts a non-compliance.users value on
-- every API-key-driven (i.e. every real PROJEXA-originated) call. Only the
-- columns below cleared BOTH bars: a real /v1/projexa/** route reaches the
-- table, AND that route target service function unconditionally (or, for
-- crm_opportunities.owner_id, via an unvalidated caller-supplied
-- passthrough) writes the actor identity into the constrained column.
--
-- Columns fixed by this migration, each independently confirmed by direct
-- source read:
--
-- 1. crm_opportunities.created_by_id -- src/app/api/v1/projexa/
--    opportunities/route.ts POST sets
--    actorId = ctx.dbUser?.id ?? ctx.apiKey!.id and calls
--    createOpportunity({ orgId, userId: actorId }, ...); crm-service.ts
--    createOpportunity() inserts createdById: ctx.userId unconditionally
--    on every row (same file/pattern already proven exactly on
--    crm_leads.created_by_id in 0206, this table sibling in the
--    lead to opportunity to quotation to sales-order pipeline).
--
-- 2. crm_opportunities.owner_id -- three PROJEXA-reachable write paths set
--    this column from caller-supplied input with zero validation that the
--    value is a real compliance.users row, same structural class already
--    fixed on crm_leads.owner_id in 0206: opportunities/route.ts POST
--    (ownerId: input.ownerId || null in createOpportunity()),
--    opportunities/[id]/route.ts PATCH (body.ownerId passed straight
--    through to updateOpportunity()), and
--    opportunities/bulk-reassign/route.ts POST (body.ownerId ?? null
--    passed straight through to bulkReassignOpportunities()). Fixed
--    alongside created_by_id in the same migration, same table, same
--    PROJEXA-IDENTITY-BRIDGE-01 root cause.
--
-- 3. erp_journal_entries.created_by_id -- src/app/api/v1/projexa/
--    journal-entries/route.ts POST builds the same dbUser-or-apiKey
--    actorCtx already precedented by sales-invoices/route.ts, and
--    erp-accounting-service.ts createJournalEntry() inserts
--    createdById: ctx.userId unconditionally (erp-accounting-service.ts:
--    266).
--
-- 4. erp_quotations.created_by_id -- src/app/api/v1/projexa/
--    quotations/route.ts POST builds the same actorCtx pattern, and
--    erp-selling-service.ts createQuotation() inserts
--    createdById: ctx.userId unconditionally (erp-selling-service.ts:
--    259).
--
-- 5. erp_sales_orders.created_by_id -- src/app/api/v1/projexa/
--    sales-orders/route.ts POST builds the same actorCtx pattern, and
--    erp-selling-service.ts createSalesOrder() inserts
--    createdById: ctx.userId unconditionally (erp-selling-service.ts:
--    402).
--
-- 6. erp_sales_credit_notes.created_by_id -- src/app/api/v1/projexa/
--    credit-notes/route.ts POST builds the same actorCtx pattern, and
--    erp-credit-note-service.ts createSalesCreditNote() inserts
--    createdById: ctx.userId unconditionally.
--
-- 7. erp_purchase_orders.created_by_id -- src/app/api/v1/projexa/
--    procurement/purchase-orders/route.ts POST builds the same actorCtx
--    pattern, and erp-buying-service.ts createPurchaseOrder() inserts
--    createdById: ctx.userId unconditionally (erp-buying-service.ts:
--    124).
--
-- 8. erp_rfqs.created_by_id -- src/app/api/v1/projexa/procurement/rfqs/
--    route.ts POST builds the same actorCtx pattern, and
--    erp-procurement-workflow-service.ts createRfq() inserts
--    createdById: ctx.userId unconditionally.
--
-- 9. erp_supplier_quotations.created_by_id -- src/app/api/v1/projexa/
--    procurement/quotations/route.ts POST builds the same actorCtx
--    pattern, and erp-procurement-workflow-service.ts
--    createSupplierQuotation() inserts createdById: ctx.userId
--    unconditionally.
--
-- 10. erp_purchase_receipts.created_by_id -- src/app/api/v1/projexa/
--     procurement/goods-receipts/route.ts POST builds the same actorCtx
--     pattern, and erp-goods-receipt-service.ts createPurchaseReceipt()
--     inserts createdById: ctx.userId unconditionally
--     (erp-goods-receipt-service.ts:86).
--
-- 11. policies.created_by_id -- src/app/api/v1/projexa/policies/route.ts
--     POST builds the same actorCtx pattern, and risk-register-service.ts
--     createPolicy() inserts createdById: ctx.userId unconditionally
--     (risk-register-service.ts:179).
--
-- All 11 are the same root cause as PR #349: PROJEXA callVeridian() proxy
-- never carries a session cookie (PROJEXA-IDENTITY-BRIDGE-01, the org-wide
-- API key bridge has no per-user identity), so every one of these
-- create/update calls is the API-key branch, inserting/updating with the
-- caller API-key id ("projexa_demo_key" in this environment) as the actor
-- -- an id that is never a row in compliance.users, hitting the FK on
-- every single write. Same fix, same precedent chain: job_openings.
-- posted_by_id (0202) -> pms_issues.created_by_id (0204, PR #349) ->
-- erp_sales_invoices.created_by_id / crm_leads.created_by_id+owner_id
-- (0205/0206, this same PR) -> these 11 (this migration).
--
-- COLUMNS EXPLICITLY CONSIDERED AND LEFT ALONE (audited, no confirmed
-- PROJEXA write path -- NOT a blanket sweep, matching PR #349 own
-- discipline):
--   - risks.owner_id: risk-register-service.ts createRisk() sets
--     ownerId: ctx.dbUser?.id ?? null -- explicitly NEVER the API-key id,
--     falls back to null instead. Confirmed safe by source read; matches
--     this pass own live E2E observation that "Log Risk" has no gap.
--   - audit_findings.owner_id: risk-register-service.ts
--     createAuditFinding() never sets ownerId on insert at all (confirmed
--     by full source read of the insert statement), and the only other
--     PROJEXA-reachable write (advanceAuditFindingCapaStatus(), the CAPA
--     status-cycle PATCH) does not touch ownerId either.
--   - pms_issues.assigned_by_id: only ever set inside updateIssue() when
--     assigneeIds is defined and non-empty (pms-issue-service.ts). The
--     only /v1/projexa/** route that calls updateIssue() is board/route.ts
--     PATCH, which only ever sends { statusId: body.statusId } --
--     assigneeIds is never included, so this line is not reachable from
--     any real PROJEXA call path today. Matches PR #349 own explicit note
--     flagging this exact column as a separate, not-yet-reproduced latent
--     risk -- still not reproduced this pass either; still correctly left
--     alone.
--   - tasks.assigned_by_id: the generic tasks table (distinct from
--     pms_issues, which is what PROJEXA own Schedule/Board UI actually
--     reads/writes) has zero routes anywhere under
--     src/app/api/v1/projexa/** -- confirmed by grep, no PROJEXA write path
--     exists at all.
--   - veri_meetings.created_by_id / veri_meeting_share_links.created_by_id:
--     /v1/projexa/meetings/route.ts aliases pms-meeting-service.ts
--     pms_meetings table (PROJEXA own generic meetings/MOM substrate, per
--     that route own header comment), a structurally different table from
--     veri_meetings (VeriChat separate meeting feature). No
--     /v1/projexa/** route touches veri_meetings or
--     veri_meeting_share_links at all.
--   - firm_engagements.created_by_id / firm_invoices.created_by_id /
--     firm_tax_cases.created_by_id: the CA-firm-practice module has zero
--     /v1/projexa/** routes. (Note: /v1/projexa/audit-engagements/route.ts
--     looks adjacent by name but aliases a different table,
--     risk-register-service.ts own auditEngagements, not
--     firm_engagements -- confirmed by direct source read of the service
--     insert target.)
--   - fm_amc_contracts / fm_assets / fm_checklist_templates /
--     fm_ppm_schedules / fm_register_digitization_batches (all
--     created_by_id): the Facilities Management module has zero
--     /v1/projexa/** routes.
--   - erp_purchase_invoices / erp_purchase_credit_notes /
--     erp_delivery_notes / erp_cash_vouchers / erp_e_invoice_logs /
--     erp_asset_disposals / erp_asset_movements /
--     erp_stock_reconciliations (all created_by_id): confirmed by grep, no
--     /v1/projexa/** route creates any of these (credit-notes/route.ts own
--     header comment explicitly notes purchase-side credit notes were
--     deliberately not aliased; the same sales-side-only-this-wave scoping
--     applies to the rest of this list, which was simply never built as a
--     PROJEXA-facing surface at all).
--   - board_meetings.created_by_id / board_action_items.owner_id /
--     incidents.capa_owner_id / performance_review_cycles.created_by_id /
--     automation_rules.created_by_id / metric_alert_rules.created_by_id /
--     module_rule_configs.created_by_id /
--     approval_workflow_definitions.created_by_id /
--     approval_workflow_instances.created_by_id /
--     conversation_share_links.created_by_id /
--     prompt_versions.created_by_id /
--     related_party_transactions.created_by_id / report_schedules.created_by /
--     sales_commission_plans.created_by_id / sales_partners.created_by_id /
--     tickets.created_by_id: every one of these modules (corporate board
--     governance, incident management, HR performance reviews, automation
--     rules, metric alerting, module rule config, approval workflows,
--     VeriChat conversation sharing, AI prompt versioning, related-party
--     transactions, report scheduling, the Sales Engine channel-partner
--     system, and support tickets) has zero routes anywhere under
--     src/app/api/v1/projexa/** -- confirmed by grep across the full route
--     tree (166 route.ts files) for every service function and table name
--     involved. These are compliance-tracker-native-UI-only surfaces today
--     (real dbUser session, not an API key), so none of them can currently
--     be reached via PROJEXA-IDENTITY-BRIDGE-01 API-key path at all --
--     leaving their FKs in place is correct, not an oversight.
--
-- Not a security/guardrail change -- none of the 11 fixed columns are in
-- scripts/check-guardrail-presence.mjs manifest, and every fixed table
-- RLS already scopes every row by org_id regardless of these FKs.
--
-- All 11 columns stay nullable/text-typed -- no schema.ts change needed,
-- same as every precedent in this chain: none of these FKs were ever
-- declared with .references() in schema.ts, all existed only as raw
-- constraints.

ALTER TABLE compliance.crm_opportunities
  DROP CONSTRAINT IF EXISTS crm_opportunities_created_by_id_fkey;

ALTER TABLE compliance.crm_opportunities
  DROP CONSTRAINT IF EXISTS crm_opportunities_owner_id_fkey;

ALTER TABLE compliance.erp_journal_entries
  DROP CONSTRAINT IF EXISTS erp_journal_entries_created_by_id_fkey;

ALTER TABLE compliance.erp_quotations
  DROP CONSTRAINT IF EXISTS erp_quotations_created_by_id_fkey;

ALTER TABLE compliance.erp_sales_orders
  DROP CONSTRAINT IF EXISTS erp_sales_orders_created_by_id_fkey;

ALTER TABLE compliance.erp_sales_credit_notes
  DROP CONSTRAINT IF EXISTS erp_sales_credit_notes_created_by_id_fkey;

ALTER TABLE compliance.erp_purchase_orders
  DROP CONSTRAINT IF EXISTS erp_purchase_orders_created_by_id_fkey;

ALTER TABLE compliance.erp_rfqs
  DROP CONSTRAINT IF EXISTS erp_rfqs_created_by_id_fkey;

ALTER TABLE compliance.erp_supplier_quotations
  DROP CONSTRAINT IF EXISTS erp_supplier_quotations_created_by_id_fkey;

ALTER TABLE compliance.erp_purchase_receipts
  DROP CONSTRAINT IF EXISTS erp_purchase_receipts_created_by_id_fkey;

ALTER TABLE compliance.policies
  DROP CONSTRAINT IF EXISTS policies_created_by_id_fkey;
