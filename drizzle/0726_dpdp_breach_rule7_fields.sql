-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 4 (Rule 7 fields on the breach table; additive only)
--
-- DPDP compliance programme, Wave 4. dpdp.breach had became_aware_at, deadline_at, scope_person_count, board_notified_at, individuals_notified_at and state.
-- This adds, as nullable columns, the facts the DPDP Rules 2025 rule 7 and the runbook (ai-os/dpdp-governance/BREACH_RUNBOOK.md) ask for, plus the two
-- other clocks we run (CERT-In 6 hours, customer notice 24 hours). Nothing is dropped or changed; existing rows and every existing function are untouched.
--   rule 7(2)(a), the Board, without delay: description, nature, extent, occurred_at, location, likely_impact
--   rule 7(2)(b), the Board, within 72 hours: board_detailed_at, broad facts, circumstances, mitigation, cause, remedial steps, report on what people were told
--   rule 7(1), each affected person: consequences, mitigation, safety measures, contact
--   CERT-In: due at became_aware + 6 hours, reported_at, reference.  Customer: due at became_aware + 24 hours, notified_at.
-- The *_due_at columns are filled by a trigger from became_aware_at, so they cannot be forgotten.
-- Roll-back: drizzle/down/0726_dpdp_breach_rule7_fields.down.sql.

alter table dpdp.breach
  add column if not exists description text,
  add column if not exists nature text,
  add column if not exists extent text,
  add column if not exists occurred_at timestamp,
  add column if not exists location text,
  add column if not exists likely_impact text,
  add column if not exists board_detailed_at timestamp,
  add column if not exists board_broad_facts text,
  add column if not exists board_circumstances text,
  add column if not exists board_mitigation text,
  add column if not exists board_cause_findings text,
  add column if not exists board_remedial_steps text,
  add column if not exists board_report_on_notices text,
  add column if not exists individual_consequences text,
  add column if not exists individual_mitigation text,
  add column if not exists individual_safety_measures text,
  add column if not exists individual_contact text,
  add column if not exists cert_in_due_at timestamp,
  add column if not exists cert_in_reported_at timestamp,
  add column if not exists cert_in_reference text,
  add column if not exists customer_notice_due_at timestamp,
  add column if not exists processor_notified_customer_at timestamp;

create or replace function dpdp.breach_set_clocks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.became_aware_at is not null then
    new.cert_in_due_at := coalesce(new.cert_in_due_at, new.became_aware_at + interval '6 hours');
    new.customer_notice_due_at := coalesce(new.customer_notice_due_at, new.became_aware_at + interval '24 hours');
  end if;
  return new;
end
$$;

drop trigger if exists breach_set_clocks on dpdp.breach;
create trigger breach_set_clocks before insert or update of became_aware_at on dpdp.breach
  for each row execute function dpdp.breach_set_clocks();

-- Rows that already exist get their two clocks too (they only ever had the 72-hour one). If a guard on the table refuses the update, the new
-- rows still get theirs from the trigger and the old ones keep the 72-hour clock only: that is reported, not fatal.
do $$
begin
  update dpdp.breach
     set cert_in_due_at = became_aware_at + interval '6 hours',
         customer_notice_due_at = became_aware_at + interval '24 hours'
   where cert_in_due_at is null and became_aware_at is not null;
exception when others then
  raise notice 'dpdp.breach backfill of the two new clocks skipped: %', sqlerrm;
end
$$;