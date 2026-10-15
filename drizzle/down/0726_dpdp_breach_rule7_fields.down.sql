-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 4 roll-back
-- Drops the trigger and the columns 0726 added. Facts typed into those columns are lost; export them first if any breach has been recorded.
drop trigger if exists breach_set_clocks on dpdp.breach;
drop function if exists dpdp.breach_set_clocks();
alter table dpdp.breach
  drop column if exists description, drop column if exists nature, drop column if exists extent, drop column if exists occurred_at,
  drop column if exists location, drop column if exists likely_impact, drop column if exists board_detailed_at, drop column if exists board_broad_facts,
  drop column if exists board_circumstances, drop column if exists board_mitigation, drop column if exists board_cause_findings,
  drop column if exists board_remedial_steps, drop column if exists board_report_on_notices, drop column if exists individual_consequences,
  drop column if exists individual_mitigation, drop column if exists individual_safety_measures, drop column if exists individual_contact,
  drop column if exists cert_in_due_at, drop column if exists cert_in_reported_at, drop column if exists cert_in_reference,
  drop column if exists customer_notice_due_at, drop column if exists processor_notified_customer_at;
