-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 1 rollback
-- Restores the column default only. Re-apply 0610 (dpdp_ai_link_create), 0695 (dpdp_timer_mint_email_ai_link) and 0694 (dpdp_ai_link_register)
-- to restore the old function bodies. Existing links stay hidden (the owner's choice is not guessed back).
alter table dpdp.ai_link alter column hide_emails set default false;
