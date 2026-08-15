-- FI-AP-008 (sap_mapping.sqlite gap analysis, "Subcontractor Payment
-- Application Status", BUILD_NEW/HIGH). Seeds a single platform-wide
-- compliance.report_definitions row (org_id = NULL, created_by = 'system'),
-- following the exact executionType='external_service' precedent
-- drizzle/0183_sales_report_definitions.sql established and this wave's own
-- sibling PRs (FI-AR-004's drizzle/0290_fi_ar_004_dunning_list.sql,
-- FI-AP-005's drizzle/0269_ap_payment_proposal_report_definition.sql) reuse
-- -- see erp-payment-entries-service.ts's new
-- subcontractorPaymentApplicationStatus() (this same PR) for the real
-- implementation, and src/app/api/v1/projexa/
-- subcontractor-payment-application-status/route.ts for its real route.
--
-- No schema/column changes accompany this migration. Discovery (see that
-- function's own header comment for the full writeup): unlike
-- compliance.construction_progress_claims (a genuinely new BUILD_NEW table
-- shipped this same wave for the CUSTOMER-facing billing claim), the
-- SUBCONTRACTOR-facing (money flowing OUT) equivalent of that state machine
-- already exists -- erp_payment_entries (Wave B, VERIDIAN Review Framework)
-- already has a real draft -> submitted -> approved/rejected workflow with
-- real submittedAt/decidedAt timestamps for paymentType='pay',
-- partyType='supplier' rows linked to a purchase invoice. This PR is a
-- genuine REUSE of that existing, already-timestamped data -- the real gap
-- it closes is the missing report/worklist layer, not the underlying
-- schema.
--
-- status = 'built': the report genuinely runs today against real
-- erp_payment_entries/erp_purchase_invoices/erp_suppliers data. Honest,
-- disclosed limitation (see subcontractorPaymentApplicationStatus's own
-- header comment): a payment entry's 'cancelled' status has no dedicated
-- timestamp column anywhere in this schema (cancelPaymentEntry only writes
-- status, never a cancelledAt) -- createdAt is used as the best available
-- aging clock-start for that one status, not invented as a new column
-- since a single additional nullable timestamp for one rarely-hit terminal
-- state was judged out of proportion for this report's scope.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Subcontractor Payment Application Status', 'Worklist of every subcontractor payment application (a real erp_payment_entries pay/supplier row linked to a purchase invoice) with its current status, submission date, amount, and days-in-current-status aging signal, plus subcontractor invoices with no payment application started yet. Cancelled applications age from createdAt (no dedicated cancelledAt column exists on erp_payment_entries).', 'software_report', '["finance","procurement","construction"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-payment-entries-service.ts","sourceFunction":"subcontractorPaymentApplicationStatus","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
