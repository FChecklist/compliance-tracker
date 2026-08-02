-- lead_source_effectiveness (sap_mapping.sqlite gap analysis, confirmed
-- BUILD_NEW, genuinely absent from the 80-row sap_reports classification
-- PR #677 completed -- see ai-os/tasks/sap_reports/PHASE_1_SAP_LOGIC_EXTRACTED.yaml
-- for the original formula spec). Seeds a single platform-wide
-- compliance.report_definitions row (org_id = NULL, created_by = 'system'),
-- following the exact executionType='external_service' precedent
-- drizzle/0183_sales_report_definitions.sql established, same as
-- drizzle/0274_sd007_sales_order_document_flow_report_definition.sql.
--
-- Honest, disclosed gap, per the original spec's own instruction: CAC
-- (customer acquisition cost) is deliberately NOT computed -- this schema
-- has no marketing-spend-by-source table, and the spec explicitly says to
-- omit CAC rather than fabricate a cost figure with no real input.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Lead Source Effectiveness', 'Groups closed leads by source (referral/website/cold_outreach/etc.) and reports conversion rate (won / total closed deals from that source) and average won-deal size per source. No new tables -- a GROUP BY over the existing crm_leads/crm_opportunities schema.', 'software_report', '["sales"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"crm-service.ts","sourceFunction":"getLeadSourceEffectivenessReport","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', 'CAC (customer acquisition cost) is not computed -- no marketing-spend-by-source data exists in this schema today; omitted rather than fabricated.', 'system');
