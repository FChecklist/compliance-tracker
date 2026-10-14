-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-14 (owner order: the DPDP audit fixes of DPDP_DATA_AUDIT_2026-10-14.md section 7). Roll-back file for 0760_dpdp_audit_note_failure.sql; it is not run unless the project manager decides to undo that migration.
-- Roll-back of 0760: removes the function only. Rows it already added to dpdp.audit_failure stay (that table is an append-only record).
drop function if exists public.dpdp_audit_note_failure(text, text);
