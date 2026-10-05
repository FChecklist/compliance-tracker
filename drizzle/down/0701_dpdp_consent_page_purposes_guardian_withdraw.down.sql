-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 3 roll-back
-- Removes the new functions and columns. Re-apply drizzle/0609_dpdp_wo011_step5_rpc.sql afterwards to restore the original dpdp_parent_consent_preview.
-- Consent answers recorded by the new functions stay in dpdp.consent_record (that table is not touched); only the guardian columns are dropped.
drop function if exists public.dpdp_consent_withdraw(text, text);
drop function if exists public.dpdp_parent_consent_v2(text, jsonb, jsonb);
drop function if exists dpdp.consent_notice_text(dpdp.consent_campaign, text);
drop function if exists dpdp.consent_purposes(dpdp.consent_campaign);
alter table dpdp.consent_token drop column if exists guardian_recorded_at, drop column if exists guardian_relation, drop column if exists guardian_name;
alter table dpdp.consent_campaign drop column if exists principal_is_child, drop column if exists purposes;
alter table dpdp.notice_version drop column if exists body_text;
