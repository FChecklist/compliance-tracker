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
13. **[High] Localization Readiness** -- verified, and corrected an earlier
    wrong assumption in this same investigation: the platform DOES have a
    real i18n framework wired at the root (`next-intl`, `NextIntlClientProvider`
    in `src/app/layout.tsx`, `messages/en.json`+`messages/hi.json`) -- but
    the message catalog only has `Nav`/`Auth`/`Login`/`Signup` namespaces.
    Every authenticated-app page, CRM/Leads included, is 100% hardcoded
    English (`useTranslations` has zero callers anywhere under
    `src/app/(app)/**`, confirmed by grep). This is a genuine, but
    platform-wide, gap -- translating only the Leads page while every other
    authenticated page stays hardcoded English would be an inconsistent
    half-measure, not a real fix, and is out of one CRM-scoped PR's
    coherent scope. Matches the finding's own recommended approach ("no
    schema change needed for leads itself") -- documented for the tracker,
    no code change made here.

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, registered this session's claim, pushed.
- [x] Read current implementation (crm-service.ts, /api/crm/leads/**,
      /crm page, report_definitions, schema.ts) against all 13 findings.
- [x] #2 status transition validation (`VALID_LEAD_TRANSITIONS`, enforced in `updateLead()`)
- [x] #6 FORCE RLS migration (`drizzle/0225_force_rls_crm_leads_stage_history.sql`) --
      **not yet applied live** (no DB-access tool available in this session;
      prior FORCE-RLS migrations in this history were applied live via the
      Supabase MCP by a session that had it -- flagged as a follow-up).
      Stage-history write-on-create/update itself verified correct by
      direct code read (no gap there).
- [x] #7 search/filter/bulk: `GET /api/crm/leads` now accepts
      search/status/ownerId/source/companyId + page/pageSize (back-compat
      preserved for zero-param callers), `POST /api/crm/leads/bulk-reassign`,
      filter bar + checkbox bulk-select + bulk-reassign toolbar in the UI
- [x] #8 Zod field-level validation on create/update (`ServiceError.fields`,
      additive constructor param -- every other 2-arg `ServiceError` call
      site is unaffected), rendered under each input in the New Lead dialog
- [x] #4 CSV export (`GET /api/crm/leads/export`, honors active filters) +
      "Export CSV" button. `report_definitions` rows for lead source/status
      were already built (0183) -- documented, not duplicated.
- [x] #12 CSV import (`POST /api/crm/leads/import`) + downloadable template
      (`GET /api/crm/leads/import/template`) + upload button in the UI
- [x] #1 orphan-check cron (`/api/internal/crm-data-integrity/run`, weekly)
- [x] #5 auto-scoring cron (`/api/internal/crm-lead-scoring/run`, daily)
- [x] #10 notification triggers: new-lead-assigned (on create + PATCH
      reassignment) + overdue-follow-up cron
      (`/api/internal/crm-lead-followup-alerts/run`, daily) -- reused
      existing `assignment`/`deadline_reminder` enum values, no schema change
- [x] #9 VERI Reward wiring: `convertLeadToClient()` awards points to the
      lead's owner when `source` matches a tracked-referral pattern, gated
      by `isVeriRewardEnabledForOrg()`
- [x] #11 in-app help panel (`LeadLifecycleHelp`, static content + deep
      link to /knowledge-base)
- [x] #13 investigated for real (corrected an earlier wrong "no i18n
      framework exists" draft note -- next-intl is real and wired at the
      root, just not extended to any authenticated page yet), documented
      as a platform-wide gap out of this PR's scope, no code change
- [x] vercel.json cron registration (3 new entries)
- [x] New pure-function test file `crm-service.test.ts` (11 tests, all
      passing) covering `VALID_LEAD_TRANSITIONS` + the Zod schemas
- [x] `bun x eslint` on every touched file: clean, zero warnings/errors
- [x] `bun test src/lib/services/crm-service.test.ts` +
      `crm-accounts-service.test.ts` (pre-existing, unaffected): 49/49 pass
- [x] Full-repo `tsc --noEmit` OOMs in this sandbox regardless of
      `--max-old-space-size` (pre-existing sandbox memory limit, not
      introduced by this change) -- full verification deferred to CI's
      real Type Check job, which runs with proper resources
- [x] Committed + pushed to `worker/task-20260718-081005-crm---sales-modules--leads`

## Remaining
- [x] Opened PR: https://github.com/FChecklist/compliance-tracker/pull/1014
- [ ] CI had not registered any check runs (beyond the Vercel preview,
      which failed on an unrelated "Deployment rate limited" infra flake)
      as of this session's last check, several minutes after PR creation --
      unclear whether that's a delay or needs a `git commit --allow-empty`
      nudge/synchronize event. Next invocation: check `gh pr checks 1014`
      again; if still nothing, push an empty commit to force a
      `synchronize` event, then let CI run and fix anything it catches.
- [ ] Flag for a follow-up session with Supabase MCP access: apply
      `drizzle/0225_force_rls_crm_leads_stage_history.sql` live.
- [ ] Once merged, move this session's ACTIVE-CLAIMS.yaml entry from
      `active:` to `recently_completed:`.
