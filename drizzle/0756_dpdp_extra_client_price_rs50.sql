-- DPDP PRICING, SECOND STEP: the Professional extra-client price goes from Rs 20 to Rs 50 a month (Rs 300 a year).
--
-- OWNER DECISION (chat, 2026-11-02, later the same day as 0755): a Professional pays Rs 999 a month including 10 clients, plus Rs 50 a month for
-- each client beyond 10 (was Rs 20). The year is half price, as before, so Rs 300 a year for each client beyond 10 (was Rs 120). Everything else in
-- 0755 stands: Organisation Rs 999 a month / Rs 5,994 a year, the Rs 99 trial pack for 90 days, a flat price per extra client with no volume
-- discount, yearly = 6 months charged.
--
-- WHY THIS IS DATA ONLY: 0755 reads the extra-client price from the plan row at charge time (dpdp.account_monthly_total_paise uses
-- dpdp.plan.extra_client_monthly_paise; the refusal text of dpdp_create_client_org interpolates it; dpdp_my_account and dpdp_public_plans pass it on
-- as extraClientMonthlyPaise). No function body carries the number, so no function is replaced here and the 23 function bodies 0755 wrote stay as
-- they are, byte for byte. Nothing is dropped, revoked or granted.
--
-- The price an account has already LOCKED is the base (locked_monthly_paise); the extra-client price is read at each charge, so this change applies
-- from the next charge of every Professional account. Live on 2026-11-02 before this file: 0 accounts, 0 payments, so no customer's price moves.
--
-- Re-runnable and safe: it only moves a price that still holds the 0755 value (2000). A price the owner has since set to something else, or a plan
-- row already at 5000, is left alone. Numbering: 0755 is the last on this branch and on main, so this is 0756.
update dpdp.plan
set extra_client_monthly_paise = 5000,
    updated_at = (clock_timestamp() at time zone 'UTC')
where key = 'firm' and extra_client_monthly_paise = 2000;
