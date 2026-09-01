-- V2-16 (CRM performance-under-load indexes + load-test harness).
-- Redispatch of a task originally blocked 2026-07-20 by a spend-governance
-- gate before any work started; ai-os/TIER3_RELEVANCE_TRIAGE_REPORT_2026-07-26.md
-- re-confirmed the gap is still real. Adds the named composite indexes only
-- -- no column/table changes, nothing here alters existing query results.
--
-- Each index below is backed by a real query pattern grepped from the
-- service layer (crm-service.ts / crm-accounts-service.ts /
-- sales-engine-service.ts / veri-reward-service.ts), not guessed:
--
--   crm_leads / crm_opportunities: listLeadsPaged()/listOpportunitiesPaged()
--   filter org_id + status/stage, order by created_at desc, paginated --
--   today only single-column org_id/status/stage indexes exist (migration
--   0031), so under load Postgres still has to bitmap-AND two separate
--   indexes (or seq-scan) instead of a single composite index walk.
--
--   crm_leads / crm_opportunities (next_action_date): getSalesPipelineOverview()
--   -- the pipeline/funnel dashboard's overdue-follow-up counts -- filters
--   org_id + next_action_date IS NOT NULL + next_action_date <= today, with
--   ZERO index support today (next_action_date has never been indexed).
--   Partial index (WHERE next_action_date IS NOT NULL) since the overdue
--   count query only ever looks at non-null rows.
--
--   crm_accounts: listAccountsPaged() filters org_id + lifecycle_stage,
--   order by created_at desc, paginated -- same gap as leads/opportunities
--   above (migration 0219 only added single-column org_id/lifecycle_stage
--   indexes).
--
--   crm_contacts: crm-accounts-service.ts repeatedly queries
--   (account_id, org_id) together (getAccountRelated(), listContactsForAccount(),
--   setPrimaryContact(), listContactsPaged() with an accountId filter) --
--   migration 0219 only added single-column org_id/account_id indexes.
--
--   sales_referrals: markReferralPaidIfApplicable() filters
--   (org_id, status) together -- migration 0087 only added single-column
--   org_id/status indexes.
--
--   veri_reward_referrals: the referral-history read path filters
--   (org_id, referrer_user_id) together, ordered by created_at desc --
--   migration 0092 indexed org_id and referral_token but never
--   referrer_user_id at all (not even single-column).
--
-- Tier2 (schema change) -- NOT applied against any live/shared database by
-- this session, per this task's own constraint that Tier2 always holds for
-- Owner sign-off, same "left for the supervising session" convention as
-- drizzle/0262 and others (see ai-os/boss/ACTIVE-CLAIMS.yaml). Validated
-- instead via scripts/crm-perf-load-test.ts against a disposable, throwaway
-- local Postgres container -- see docs/testing/CRM_PERF_LOAD_TEST_RESULTS.md
-- for real before/after EXPLAIN ANALYZE numbers proving these indexes are
-- used and measurably faster at 50k+ rows.
--
-- IF NOT EXISTS throughout, additive-only, safe to run any number of times.
-- CREATE INDEX (not CONCURRENTLY): matches every other index migration in
-- this repo's drizzle/ history (plain migrations run inside the normal
-- migration transaction) -- if the supervising session applies this against
-- a table already holding a large number of live rows, consider re-running
-- the two CREATE INDEX statements CONCURRENTLY (outside a transaction)
-- instead, to avoid holding a write lock for the duration of the build.

CREATE INDEX IF NOT EXISTS idx_crm_leads_org_status_created
  ON compliance.crm_leads (org_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_crm_opportunities_org_stage
  ON compliance.crm_opportunities (org_id, stage);

CREATE INDEX IF NOT EXISTS idx_crm_leads_org_next_action
  ON compliance.crm_leads (org_id, next_action_date)
  WHERE next_action_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_opportunities_org_next_action
  ON compliance.crm_opportunities (org_id, next_action_date)
  WHERE next_action_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_accounts_org_lifecycle_created
  ON compliance.crm_accounts (org_id, lifecycle_stage, created_at);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_org_account
  ON compliance.crm_contacts (org_id, account_id);

CREATE INDEX IF NOT EXISTS idx_sales_referrals_org_status
  ON compliance.sales_referrals (org_id, status);

CREATE INDEX IF NOT EXISTS idx_veri_reward_referrals_org_referrer
  ON compliance.veri_reward_referrals (org_id, referrer_user_id);
