-- VERIDIAN_CONSOLIDATED_COMPLETION Stage 9 (2026-07-29), unified "search
-- everything" layer -- first real, bounded slice. Confirmed by reading the
-- real schema first (superboss-register.py's system_index/check_duplicate/
-- search cover ONLY internal ai-os inventory -- system_index, wiring_registry,
-- knowledge_engine, capability_registry -- zero customer data; real customer
-- content search today is fragmented and mostly absent: only
-- compliance.compliance_items (search_vector + idx_ct2_ci_search_vector) and
-- compliance.documents (unnamed to_tsvector GIN expression index,
-- idx_documents_fulltext_search) have any keyword search at all; tasks (1899
-- rows), projects, tickets, crm_leads, notices, comments, conversations have
-- none. compliance.audit_search (0229_audit_search_view, 2026-07-19) already
-- proved the exact right pattern for a different domain (audit trail
-- search) -- this view is that same pattern applied to the still-uncovered
-- "real work content" domain, deliberately starting with just the two
-- tables that already carry real search indexes today (zero new indexes,
-- zero backfill, pure additive read-only view). Every other real candidate
-- entity (tasks/projects/tickets/crm_leads/notices/comments/conversations)
-- needs its own tsvector column + index + app write-path wiring first --
-- genuinely separate, larger work, deliberately NOT done here (see the
-- Stage 9 report for the full real gap list); one more UNION ALL branch is
-- how each gets added later, exactly as audit_search's own header documents
-- for its three sources.
--
-- SECURITY: identical belt-and-suspenders convention as audit_search --
-- `security_invoker = true` (PG15+, applies RLS as the querying role, not
-- this view's owner) PLUS an explicit `org_id = compliance.current_org_id()`
-- filter on every branch (same expression every real RLS policy in this
-- schema already uses), so an unset app.current_org_id GUC fails closed
-- (zero rows) rather than open. Grants SELECT only to app_runtime --
-- service_role already has direct unscoped table access and has no need for
-- a scoped view; no other role is granted anything.
--
-- REPO/DB NUMBERING NOTE (found during this same task, updated during the
-- 2026-07-30 CI-fix pass): the live Supabase migration for this view was
-- applied via the MCP apply_migration tool under the label
-- "0256_content_search_view" -- at that moment this repo's own drizzle/
-- history (on origin/main, a fresh worktree) turned out to already go up to
-- 0268, i.e. the live DB's applied-migration names and this repo's
-- committed file sequence have drifted apart (a real, pre-existing gap: the
-- server's live migration history includes many "wave*"/"priority*"-named
-- entries with no corresponding numbered file in this repo at all, e.g.
-- 0251_crm_wave1_fix_stale_crm_activities_shape applied live but absent
-- here). This file was originally filed at 0269 (the then-next-free repo
-- number) to avoid colliding with 0256_worker_agent_domain_groups.sql, but by
-- the time this PR was rebased onto main (2026-07-30, after #629/#636/#638/
-- #642/#644/#645/#646/#648/#650/#651 merged), main itself had already grown
-- TWO other files independently numbered 0269
-- (0269_ap_purchase_invoice_retention.sql and
-- 0269_construction_progress_claims_workflow.sql) and its true highest number
-- had advanced to 0279; at least seven other still-open PRs (#610/#618/#634/
-- #635/#637/#639, plus this one) also independently claimed 0269, and #653
-- separately claimed 0280-0282. This file is therefore renumbered to 0283 --
-- verified against fresh origin/main AND every other currently-open PR's
-- claimed migration numbers at rebase time -- to land on real clean ground.
-- The SQL below is byte-identical to what was actually applied live
-- (verified: view exists, security_invoker=true, returns 0 rows with no org
-- context set, returns only the calling org's rows with it set) -- only
-- this file's own name/number differs from the live migration's label.
-- Reconciling the wider repo/DB migration-history drift (the 0269 pileup
-- itself, and the wave*/priority* live-vs-repo gap) is a separate,
-- pre-existing issue, not something this task attempts to fix.
--
-- SECOND REBASE NOTE (2026-07-31): main advanced one more merge past the
-- prior 0302 renumbering (#639, Stage 12 dispatch_outcomes, unrelated to
-- this view) with no new file-number collision on 0302 -- but this file's
-- OWN journal entry now lands (necessarily, as the newest-appended entry)
-- AFTER 0284_content_search_tasks (Stage 12's extension of this same view
-- to add a third `tasks` UNION ALL branch, merged to main ahead of this PR
-- via #633). A plain re-apply of this file's original 2-branch
-- CREATE OR REPLACE VIEW, running after 0284 in journal order on a fresh
-- database, would silently drop the tasks branch 0284 already added --
-- a real regression, not a numbering formality. Fixed by recreating the
-- view here with the SAME 3-branch shape 0284 already established (verified
-- against a fresh checkout of origin/main's 0284_content_search_tasks.sql),
-- making this file idempotent-safe and order-independent: whichever of
-- these two files a fresh migrate() run applies second, the end state is
-- identical. compliance.tasks.search_vector / its trigger / its GIN index
-- are 0284's own concern and untouched here.
--
-- THIRD REBASE NOTE (2026-08-02, master-directive Phase 2 closure pass):
-- renumbered 0302 -> 0311. 0302 was reused by 0302_sales_pipeline_dashboard_targets.sql
-- (merged to main ahead of this PR) and, independently, by at least 8 other
-- still-open PRs (#635/#652/#655/#663/#664/#666/#667/#668) that had also
-- claimed it -- not this PR's fault, the same "everyone grabs the next
-- number off a stale main" race documented in the notes above. Verified
-- 0311 free against fresh origin/main (tops out at 0303) and every one of
-- the 80 currently-open PRs' live head trees (highest claimed elsewhere:
-- 0310, PR #665). No content change to the view itself.
CREATE OR REPLACE VIEW compliance.content_search
WITH (security_invoker = true) AS
SELECT
  'compliance_items' AS source_table,
  id,
  org_id,
  title,
  description AS snippet,
  search_vector AS search_tsv,
  created_at,
  updated_at
FROM compliance.compliance_items
WHERE org_id = compliance.current_org_id()
UNION ALL
SELECT
  'documents' AS source_table,
  id,
  org_id,
  name AS title,
  (extracted_data ->> 'summary') AS snippet,
  to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(extracted_data ->> 'summary', '')) AS search_tsv,
  created_at,
  created_at AS updated_at
FROM compliance.documents
WHERE org_id = compliance.current_org_id()
UNION ALL
SELECT
  'tasks' AS source_table,
  id,
  org_id,
  title,
  description AS snippet,
  search_vector AS search_tsv,
  created_at,
  updated_at
FROM compliance.tasks
WHERE org_id = compliance.current_org_id();

COMMENT ON VIEW compliance.content_search IS
  'VERIDIAN_CONSOLIDATED_COMPLETION Stage 9/12 unified read-only search surface over real customer-content tables that carry a trigger-maintained keyword search index: compliance_items.search_vector, documents fulltext GIN expression index, and (Stage 12, #633) tasks.search_vector. RLS-safe by construction (security_invoker + explicit current_org_id() filter on every branch, same convention as compliance.audit_search). Still not unified across the full customer-data surface -- projects/tickets/crm_leads/notices/comments/conversations/notifications each still need this same treatment; add each as one more UNION ALL branch.';

GRANT SELECT ON compliance.content_search TO app_runtime;
