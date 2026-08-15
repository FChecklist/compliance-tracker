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

## Remaining
- [ ] Reporting & Export Accuracy -- crm_accounts/crm_contacts are absent
      from report-engine-service.ts's ad-hoc data-source whitelist (unlike
      crm_leads/crm_opportunities) and from report-catalog-service.ts's
      REPORT_CATALOG.
- [ ] AI Copilot / Worker Agent Integration Depth -- no aiScore-style
      columns/analysis function for accounts (Wave 75 CRM Intelligence
      pattern exists for leads/opportunities only).
- [ ] Search, Filter & Bulk Operations (bulk half) -- no bulk-reassign (or
      other bulk) endpoint for accounts, unlike
      v1/projexa/leads/bulk-reassign's precedent.
- [ ] Cross-Module Integration Consistency -- crm_accounts has no
      erpCustomerId/clientId bridge columns (crm_leads/crm_opportunities
      already bridge to erp_customers).
- [ ] Notification & Alert Trigger Correctness -- no notification triggers
      (contact added / account reassigned) despite a working generic
      `notifications` table + established `db.insert(notifications)`
      pattern used by 10+ other services.
- [ ] Documentation & In-App Help Coverage -- no doc mentions CRM
      accounts/contacts anywhere in docs/.
- [ ] Data Import/Export Template Fidelity -- no CSV import/export for
      accounts.
- [ ] Error Handling & Data Validation Messaging -- reviewing whether
      existing ServiceError-message pattern (consistent with every other
      CRM route) needs anything beyond what's already there.
- [ ] Localization Readiness -- checking whether this is applicable at all
      (accounts currently carry no monetary/contract-value field, and
      no CRM monetary field anywhere in this codebase carries a currency
      column today either) before deciding whether to add anything.
