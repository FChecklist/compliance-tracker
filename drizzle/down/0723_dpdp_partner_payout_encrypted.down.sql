-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 2 roll-back
-- Decrypts the payout details back into the original table (needs the same Vault secret dpdp_payout_key) and removes the view, the triggers and the
-- helper functions. Re-apply 0674 (dpdp_partner_save_payout_details) afterwards to restore the original function body.
drop trigger if exists partner_payout_detail_write on dpdp.partner_payout_detail;
drop view if exists dpdp.partner_payout_detail;
do $$
begin
  if to_regclass('dpdp.partner_payout_store') is not null then
    update dpdp.partner_payout_store
       set upi_id = dpdp.payout_dec(upi_id), account_name = dpdp.payout_dec(account_name), account_number = dpdp.payout_dec(account_number),
           ifsc = dpdp.payout_dec(ifsc), pan = dpdp.payout_dec(pan);
    alter table dpdp.partner_payout_store rename to partner_payout_detail;
  end if;
end
$$;
drop function if exists dpdp.partner_payout_detail_write();
drop function if exists dpdp.payout_dec(text);
drop function if exists dpdp.payout_enc(text);
drop function if exists dpdp.payout_key();
