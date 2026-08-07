# PROGRESS -- task-20260718-081005-crm---sales-modules--leads

Scope: 13 Review Framework findings for CRM & Sales Modules / Leads (see
`prompt.txt`). Read the live implementation first (crm-service.ts,
/api/crm/leads/**, /crm page) before writing anything -- notes below record
what was actually found vs. the original gap description.

## Findings & plan

1. **[Low] Data Model Completeness & Referential Integrity** -- confirmed real
   gap (companyId/convertedClientId are bare text, no FK, matches this
   codebase's established convention per schema.ts comments). Plan: add
   `findOrphanedLeadReferences()` + a periodic `/api/internal/crm-data-integrity/run`
   cron (not a DB FK, to stay consistent with the rest of the schema).
2. **[Medium] Business Rule & Validation Accuracy** -- confirmed real gap
   (`updateLead()` accepts any status with zero transition check). Plan: add
   `VALID_LEAD_TRANSITIONS` mirroring `recruitment-service.ts`'s
   `VALID_STAGE_TRANSITIONS` pattern, enforce in `updateLead()`.
3. **[Low] Multi-Tenant / Multi-Project Isolation** -- gap description says
   "none identified", recommends periodic re-verification. Folded into #6
   below (RLS is enabled but not FORCEd on crm_leads/crm_opportunities/
   crm_stage_history -- same class of gap 0215/0223/0219 already fixed for
   sibling tables, just never applied to these three).
4. **[High] Reporting & Export Accuracy** -- partially already resolved:
   `report_definitions` already has built, executable "Lead Register"/"Lead
   Source Report"/"Lead Status Report" rows (0183_sales_report_definitions.sql)
   wired through report-engine-service.ts's TABLE_REGISTRY. Genuine remaining
   gap: no CSV output anywhere, no export action on the CRM UI itself. Plan:
   add `GET /api/crm/leads/export` (CSV) + a UI "Export CSV" button.
5. **[Low] AI Copilot / Worker Agent Integration Depth** -- confirmed
   (scoring is manual-only). Plan: `/api/internal/crm-lead-scoring/run` cron,
   auto-scores new/stale leads for orgs with Sales enabled.
6. **[Medium] Audit Trail & Change History** -- `createLead()`/`updateLead()`
   already write `crm_stage_history` correctly (verified by direct code
   read). Genuine remaining gap: RLS enabled-not-forced on crm_leads/
   crm_opportunities/crm_stage_history (never covered by 0215/0219/0223's
   sweeps). Plan: FORCE RLS migration + a test proving the stage-history
   write actually happens on create/update.
7. **[High] Search, Filter & Bulk Operations** -- confirmed (GET /api/crm/leads
   returns a flat unfiltered array; `listLeadsPaged`/`bulkReassignLeads`
   already exist in the service layer but nothing in `/api/crm/**` calls
   them). Plan: wire GET to accept search/status/owner/source params (back-
   compat preserved), add a bulk-reassign route, add filter bar + bulk-select
   UI.
8. **[Medium] Error Handling & Data Validation Messaging** -- confirmed
   (generic try/catch, no field-level messages). Plan: Zod validation on
   create/update with field-level issues in the JSON error body + UI surface.
9. **[Low] Cross-Module Integration Consistency** -- `sales_commission_*`/
   `sales_referrals` are confirmed (by reading sales-engine-service.ts) to be
   the platform's own partner/channel-referral program for NEW ORG signups,
   not an org's internal CRM leads -- wiring `convertLeadToClient()` into
   that system would be a category error. VERI Reward's own
   `veriRewardReferrals` is the same (user-invites-user growth loop, not
   CRM). Real, honest wiring: award VERI Reward points to the lead's owner
   when a lead whose `source` is a tracked referral converts, gated by
   `isVeriRewardEnabledForOrg()`.
10. **[High] Notification & Alert Trigger Correctness** -- confirmed gap.
    `notificationTypeEnum` already has `assignment` and `deadline_reminder`
    values that fit both triggers -- no enum change needed (verified against
    schema.ts). Plan: notify on lead-assigned at creation, and a
    `/api/internal/crm-lead-followup-alerts/run` cron for overdue
    `nextActionDate`.
11. **[Critical] Documentation & In-App Help Coverage** -- confirmed gap. KB
    pages are org-scoped (no platform-wide row), so a static inline help
    panel component is the safer artifact vs. seeding data cross-org; links
    out to /knowledge-base for full docs. Plan: `LeadLifecycleHelp` panel on
    the CRM page.
12. **[Critical] Data Import/Export Template Fidelity** -- confirmed gap
    (zero import path for leads). Plan: `POST /api/crm/leads/import`
    following `/api/compliance/import`'s CSV pattern + a downloadable
    template + UI upload button.
13. **[High] Localization Readiness** -- verified: there is no
    platform-wide i18n framework anywhere in this codebase (no i18next/
    next-intl, no `t()` translation calls found outside currency
    formatting). This is a platform-wide gap, not CRM/Leads-specific --
    nothing to fix at the leads-schema level (matches the recommended
    approach's own "no schema change needed"). Documented, no code change.

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, registered this session's claim, pushed.
- [x] Read current implementation (crm-service.ts, /api/crm/leads/**,
      /crm page, report_definitions, schema.ts) against all 13 findings.

## Remaining
- [ ] #2 status transition validation
- [ ] #6 FORCE RLS migration + stage-history test
- [ ] #7 search/filter/bulk (API + UI)
- [ ] #8 Zod field-level validation (API + UI)
- [ ] #4 CSV export
- [ ] #12 CSV import + template
- [ ] #1 orphan-check cron
- [ ] #5 auto-scoring cron
- [ ] #10 notification triggers (assignment + overdue cron)
- [ ] #9 VERI Reward wiring on convert
- [ ] #11 in-app help panel
- [ ] vercel.json cron registration
- [ ] typecheck/lint/build/test, then PR
