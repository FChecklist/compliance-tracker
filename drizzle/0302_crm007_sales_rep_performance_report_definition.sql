-- CRM-007 "Sales Representative Performance Dashboard" -- gap analysis
-- sap_mapping.sqlite/sap_reports, id='CRM-007', module CRM, LOW priority,
-- veridian_mapping_status='BUILD_NEW' (re-read fresh from the sqlite row
-- directly on 2026-07-30, not trusted from a summary).
--
-- Real finding (veridian_gap_notes): ownerId already exists on both
-- crm_leads and crm_opportunities (used by bulkReassignLeads/
-- bulkReassignOpportunities in crm-service.ts), so per-rep grouping was
-- always possible -- but no per-sales-rep aggregated dashboard existed
-- anywhere. NO NEW SCHEMA in this PR: crm_opportunities
-- (estimatedValue/stage/ownerId/aiWinProbability/createdAt),
-- crm_stage_history (won/lost transition dates), and crm_activities
-- (assignedToId) already carry every column this report aggregates over.
-- This migration only seeds the report_definitions catalog row -- same
-- "aggregation, not schema" shape as the sibling SD-007/FI-GL-007 report-
-- definition migrations built the same day.
--
-- execution_type='external_service' -- see crm-service.ts's new
-- getSalesRepPerformanceDashboard()/aggregateSalesRepPerformance() for the
-- real computation (pipeline value, weighted pipeline value, closed won/
-- lost revenue, win rate, average deal size, average sales cycle, and
-- activity count per rep) and
-- src/app/api/v1/projexa/sales-rep-performance/route.ts for its real route.
--
-- classifications=["sales"] only (deliberately no "financial"/"compliance"/
-- "construction"/"project") so deriveReportDomainFromClassifications()
-- (report-engine-service.ts) resolves this to the "custom" domain, which
-- that function's own if-chain checks last and which
-- report-domain-enablement-service.ts leaves ungated (getReportDomainGate
-- returns null for "custom") -- the real gate for this report is
-- requireSalesEnabled(), called inside getSalesRepPerformanceDashboard()
-- itself, same as every other function in crm-service.ts.
--
-- Honest, disclosed gaps left open (see crm-service.ts's own header comment
-- on this section for the full reasoning, not fabricated here):
--   1. Revenue Target / Target Achievement %: the sqlite row's own
--      input_data_required says a per-rep-per-period revenue target is a
--      "prerequisite data element" -- grepped schema.ts fresh, no
--      target/quota table exists anywhere in this codebase. Reported as
--      null on every rep row, never fabricated or defaulted.
--   2. Weighted Pipeline Value uses aiWinProbability (Wave 75 AI
--      enrichment) as the only per-opportunity win-probability this schema
--      has -- opportunities never scored by analyzeOpportunity() are
--      honestly excluded from the weighted sum, not assumed at 0%/100%.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Sales Representative Performance Dashboard',
   'Per-sales-rep scorecard: open pipeline value, AI-win-probability-weighted pipeline value, closed won/lost revenue, win rate, average deal size, average sales cycle (days from opportunity creation to close), and activity count (calls/meetings/tasks assigned to that rep), grouped by crm_opportunities.ownerId / crm_activities.assignedToId. Optional periodStart/periodEnd window and ownerIds filter. Honest, disclosed gap: revenue target and target-achievement percentage are not computed -- no per-rep-per-period revenue-target table exists in this schema (the SAP row''s own input_data_required lists a maintained target as a prerequisite data element this codebase does not yet have); reported as null on every rep row, never fabricated.',
   'software_report', '["sales"]'::jsonb, 'on_demand', NULL,
   'external_service', '{"kind":"external_service","sourceService":"crm-service.ts","sourceFunction":"getSalesRepPerformanceDashboard","requiredParams":[]}'::jsonb, '["table"]'::jsonb,
   'built', NULL, 'system');
