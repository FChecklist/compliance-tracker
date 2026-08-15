# PROGRESS -- task-20260718-081003-crm---sales-modules--accounts---contacts

Task: close 15 VERIDIAN Review Framework findings for "Accounts & Contacts"
(CRM & Sales Modules). See prompt.txt for the full finding list.

## Completed
- [x] Read governance docs + ai-os/boss/ACTIVE-CLAIMS.yaml.
- [x] Rebased this branch onto latest origin/main (was ~1331 commits stale,
      dating back to 2026-07-18) before assessing what remains open.
- [x] Read the real current implementation before assuming the finding list
      is still accurate. Confirmed the following findings are ALREADY
      CLOSED by prior waves (PR #389 "Add CRM Accounts & Contacts" + PR #402
      "business-rule validation + RBAC"), no further action:
      - Data Model Completeness & Referential Integrity -- crm_accounts +
        crm_contacts tables exist (drizzle/0219, schema.ts), 1:many via
        account_id.
      - CRUD & Approval Workflow Correctness -- full CRUD in
        crm-accounts-service.ts + src/app/api/crm/accounts/**,
        src/app/api/crm/contacts/**.
      - Business Rule & Validation Accuracy -- validateContactFormat,
        wouldCreateCycle, canEditAccount/canReassignOrDeleteAccount/
        canCreateCrmRecord, findDuplicateAccountMatches.
      - Multi-Tenant / Multi-Project Isolation -- RLS enabled AND forced on
        both tables (drizzle/0219), org-scoped via withTenantContext.
      - Audit Trail & Change History -- logActivity() calls in
        crm-accounts-service.ts (create/update/delete/convert/link).
      - Access Control / Role-Based Permissions -- PR #402's local
        ROLE_RANK-based gate (ownership + role checks on every mutating
        route).
      - Search, Filter & Bulk Operations (search/filter half) --
        listAccountsPaged supports search/lifecycleStage/ownerId/
        parentAccountId/companyId filters + pagination.
- [ ] Confirmed genuinely OPEN (verified against current main, not the
      stale finding description) -- see Remaining below.

- [x] Reporting & Export Accuracy -- added crm_accounts + crm_contacts to
      report-engine-service.ts's TABLE_REGISTRY (same whitelist mechanism
      crm_leads/crm_opportunities already use for ad-hoc grouped reports;
      they have no static REPORT_CATALOG entries either, so none added for
      accounts/contacts -- matches precedent exactly).
- [x] AI Copilot / Worker Agent Integration Depth -- extended the Wave 75
      CRM Intelligence pattern to accounts: aiHealthScore/aiRiskFactors/
      aiRecommendedAction/aiAnalyzedAt columns, analyzeAccountHealth() in
      crm-accounts-service.ts (same resolveModelConfig -> enforcePolicy ->
      callLLMJson -> recordOrchestraExecution chain as scoreLead/
      analyzeOpportunity), POST /api/crm/accounts/:id/analyze, prompt
      template crm_intelligence.analyze_account seeded via
      drizzle/0314_crm_accounts_ai_and_bridge_columns.sql, UI wired into
      the account detail page (same card shape as the opportunity
      detail page's AI Analysis card).
- [x] Search, Filter & Bulk Operations (bulk half) -- bulkReassignAccounts()
      + POST /api/crm/accounts/bulk-reassign, same manager-rank gate and
      shape as v1/projexa/leads/bulk-reassign.
- [x] Cross-Module Integration Consistency -- added nullable erpCustomerId
      + clientId bridge columns to crm_accounts (same convention as
      crmOpportunities.erpCustomerId / crmLeads.clientId).
- [x] Notification & Alert Trigger Correctness -- contact-added and
      account-reassigned (single + bulk) now insert into the existing
      `notifications` table via the same `db.insert(notifications)`
      pattern 10+ other services already use.
- [x] Documentation & In-App Help Coverage -- docs/features/crm-accounts-
      contacts.md (new). In-app help itself (Help AI, `/api/help/ask`) is
      freeform-QA over an org-authored KB + general model knowledge, not a
      fixed doc index a code change updates -- noted honestly rather than
      claimed as "wired in".
- [x] Data Import/Export Template Fidelity -- GET /api/crm/accounts/export
      (CSV, reuses report-export-shared.ts's rowsToCSV) and POST
      /api/crm/accounts/import (multipart csv/xlsx/xls, reuses
      src/lib/ingest/parser.ts#parseFile + a new header-aliasing mapper +
      row-level partial-success import), wired into the accounts list
      page (Export CSV / Import CSV buttons).
- [x] Error Handling & Data Validation Messaging -- reviewed: the existing
      ServiceError-message pattern is consistent with every other CRM
      route; the import endpoint's row-level `{ row, name, error }` array
      is the concrete artifact this finding was really asking for, and is
      now in place.
- [x] Localization Readiness -- confirmed not applicable and documented as
      such (not force-added): no CRM monetary field anywhere in this
      codebase, crm_opportunities.estimatedValue included, carries a
      currency column today, and crm_accounts has no monetary/
      contract-value field at all to make currency-aware. See docs/
      features/crm-accounts-contacts.md's Localization section.

## Verification
- [x] `bunx tsc --noEmit` clean (0 errors, ran with
      NODE_OPTIONS=--max-old-space-size=6144 -- the default heap OOMs on
      this repo's full project graph regardless of this change).
- [x] `bun run lint` 0 errors (same 3 pre-existing warnings PR #389/#402
      already documented as unrelated: litigation/[id]/route.ts,
      data-table.tsx, VeriComposer.tsx).
- [x] `bun test` 2582 pass / 0 fail across 225 files (includes 5 new
      mapAccountImportRows tests) -- no regressions.
- [ ] `bun run build` -- running in background at the time of this
      checkpoint; result not yet observed.
