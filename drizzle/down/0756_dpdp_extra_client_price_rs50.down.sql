-- Rollback of 0756: puts the Professional extra-client price back to Rs 20 a month (2000 paise), the value 0755 set. Data only.
-- Only moves a price that still holds 5000: a price the owner has set to anything else since is not undone. Re-runnable.
-- After this, 0756 can be applied again.
update dpdp.plan
set extra_client_monthly_paise = 2000,
    updated_at = (clock_timestamp() at time zone 'UTC')
where key = 'firm' and extra_client_monthly_paise = 5000;
