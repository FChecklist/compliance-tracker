-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 2 (encrypt Sales Partner payout details: PAN, bank account, IFSC, UPI id)
--
-- DPDP compliance programme, Wave 2. dpdp.partner_payout_detail held PAN, bank account number, IFSC, account name and UPI id as plain text. Now:
--  * the sensitive columns are stored encrypted (pgcrypto pgp_sym_encrypt, base64, prefix 'enc1:') in dpdp.partner_payout_store, the old table renamed
--    in place (its row-level security, revokes and constraints come with it);
--  * the key is the Supabase Vault secret named dpdp_payout_key (Vault is already used here for dpdp_timer_url and dpdp_timer_secret). It is never in the
--    repository, and no function that returns it can be run by a browser role. If the secret is missing, saving and reading payout details FAIL; nothing is
--    ever written in plain text instead;
--  * dpdp.partner_payout_detail is now a VIEW over the store that decrypts on read, with INSTEAD OF triggers that encrypt on write. Every other function
--    that reads the table (the partner's own masked view, the owner's payout list and held list, the activation check) is unchanged and keeps working;
--    only public.dpdp_partner_save_payout_details changes, because a view takes no ON CONFLICT (update first, then insert);
--  * existing rows are encrypted in place by this migration. It REFUSES TO RUN until the Vault secret exists (see LIVE STEPS in the PR), so a half-done
--    state cannot happen.
-- Roll-back: drizzle/down/0699_dpdp_partner_payout_encrypted.down.sql (decrypts back and restores the table; needs the same Vault secret).

do $$
begin
  if (select count(*) from vault.decrypted_secrets where name = 'dpdp_payout_key' and length(decrypted_secret) >= 32) = 0 then
    raise exception 'Create the Vault secret dpdp_payout_key (at least 32 characters) before applying this migration' using errcode = '55000';
  end if;
end
$$;

create or replace function dpdp.payout_key()
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'dpdp_payout_key';
  if v_key is null or length(v_key) < 32 then
    raise exception 'The payout encryption key (Vault secret dpdp_payout_key) is not set' using errcode = '55000';
  end if;
  return v_key;
end
$$;

create or replace function dpdp.payout_enc(p_plain text)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_plain is null then
    return null;
  end if;
  if left(p_plain, 5) = 'enc1:' then
    return p_plain; -- already encrypted: never encrypt twice
  end if;
  return 'enc1:' || encode(extensions.pgp_sym_encrypt(p_plain, dpdp.payout_key()), 'base64');
end
$$;

create or replace function dpdp.payout_dec(p_stored text)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_stored is null then
    return null;
  end if;
  if left(p_stored, 5) <> 'enc1:' then
    return p_stored; -- a row written before this migration and not yet converted
  end if;
  return extensions.pgp_sym_decrypt(decode(substr(p_stored, 6), 'base64'), dpdp.payout_key());
end
$$;

revoke all on function dpdp.payout_key(), dpdp.payout_enc(text), dpdp.payout_dec(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'dpdp' and c.relname = 'partner_payout_detail' and c.relkind = 'r') then
    alter table dpdp.partner_payout_detail rename to partner_payout_store;
  end if;
end
$$;

update dpdp.partner_payout_store
   set upi_id = dpdp.payout_enc(upi_id), account_name = dpdp.payout_enc(account_name), account_number = dpdp.payout_enc(account_number),
       ifsc = dpdp.payout_enc(ifsc), pan = dpdp.payout_enc(pan)
 where left(coalesce(upi_id, account_number, ifsc, pan, account_name, ''), 5) <> 'enc1:';

create or replace view dpdp.partner_payout_detail with (security_barrier = true) as
select identity_id, method,
       dpdp.payout_dec(upi_id) as upi_id, dpdp.payout_dec(account_name) as account_name, dpdp.payout_dec(account_number) as account_number,
       dpdp.payout_dec(ifsc) as ifsc, dpdp.payout_dec(pan) as pan, created_at, updated_at
  from dpdp.partner_payout_store;
revoke all on dpdp.partner_payout_detail from public, anon, authenticated;

create or replace function dpdp.partner_payout_detail_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into dpdp.partner_payout_store (identity_id, method, upi_id, account_name, account_number, ifsc, pan, created_at, updated_at)
    values (new.identity_id, new.method, dpdp.payout_enc(new.upi_id), dpdp.payout_enc(new.account_name), dpdp.payout_enc(new.account_number),
            dpdp.payout_enc(new.ifsc), dpdp.payout_enc(new.pan),
            coalesce(new.created_at, clock_timestamp() at time zone 'UTC'), coalesce(new.updated_at, clock_timestamp() at time zone 'UTC'));
    return new;
  elsif tg_op = 'UPDATE' then
    update dpdp.partner_payout_store
       set method = new.method, upi_id = dpdp.payout_enc(new.upi_id), account_name = dpdp.payout_enc(new.account_name),
           account_number = dpdp.payout_enc(new.account_number), ifsc = dpdp.payout_enc(new.ifsc), pan = dpdp.payout_enc(new.pan),
           updated_at = coalesce(new.updated_at, clock_timestamp() at time zone 'UTC')
     where identity_id = old.identity_id;
    return new;
  else
    delete from dpdp.partner_payout_store where identity_id = old.identity_id;
    return old;
  end if;
end
$$;
revoke all on function dpdp.partner_payout_detail_write() from public, anon, authenticated;

drop trigger if exists partner_payout_detail_write on dpdp.partner_payout_detail;
create trigger partner_payout_detail_write instead of insert or update or delete on dpdp.partner_payout_detail
  for each row execute function dpdp.partner_payout_detail_write();

create or replace function public.dpdp_partner_save_payout_details(
  p_method text,
  p_upi_id text default null,
  p_account_name text default null,
  p_account_number text default null,
  p_ifsc text default null,
  p_pan text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_identity text;
  v_p dpdp.sales_partner;
  v_method text := lower(btrim(coalesce(p_method, '')));
  v_upi text := nullif(lower(btrim(coalesce(p_upi_id, ''))), '');
  v_name text := nullif(btrim(regexp_replace(coalesce(p_account_name, ''), '\s+', ' ', 'g')), '');
  v_acct text := nullif(regexp_replace(coalesce(p_account_number, ''), '[\s-]', '', 'g'), '');
  v_ifsc text := nullif(upper(btrim(coalesce(p_ifsc, ''))), '');
  v_pan text := nullif(upper(btrim(coalesce(p_pan, ''))), '');
  v_old dpdp.partner_payout_detail;
  v_changed boolean := false;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_activated boolean;
begin
  if v_email = '' then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  v_identity := public.dpdp__caller_identity_id();
  select * into v_p from dpdp.sales_partner where identity_id = v_identity for update;
  if v_p.identity_id is null then
    raise exception 'Accept the partner terms first, then add your payout details.' using errcode = '42501';
  end if;
  if v_p.status = 'ended' then
    raise exception 'Your partnership has ended. Write to us if you want to join again.' using errcode = '42501';
  end if;
  if v_method not in ('upi', 'bank') then
    raise exception 'Choose how you want to be paid: UPI or bank transfer.' using errcode = '22023';
  end if;
  if v_name is not null and v_name !~ '^[A-Za-z][A-Za-z .''-]{1,79}$' then
    raise exception 'The name must use letters only, 2 to 80 characters.' using errcode = '22023';
  end if;
  if v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'That PAN does not look right. It has 5 letters, 4 digits and 1 letter. Leave it empty if you prefer.' using errcode = '22023';
  end if;

  if v_method = 'upi' then
    if v_upi is null or v_upi !~ '^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,31}$' then
      raise exception 'That UPI id does not look right. It looks like name@bank.' using errcode = '22023';
    end if;
    v_acct := null;
    v_ifsc := null;
  else
    if v_name is null then
      raise exception 'Enter the name on the bank account.' using errcode = '22023';
    end if;
    if v_acct is null or v_acct !~ '^[0-9]{9,18}$' then
      raise exception 'The account number must be 9 to 18 digits.' using errcode = '22023';
    end if;
    if v_ifsc is null or v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
      raise exception 'That IFSC code does not look right. It has 11 characters, for example HDFC0001234.' using errcode = '22023';
    end if;
    v_upi := null;
  end if;

  select * into v_old from dpdp.partner_payout_detail where identity_id = v_identity;
  if v_old.identity_id is not null then
    v_changed := (v_old.method, v_old.upi_id, v_old.account_number, v_old.ifsc) is distinct from (v_method, v_upi, v_acct, v_ifsc);
  end if;

  -- dpdp.partner_payout_detail is now a view over the encrypted store (this migration): a view takes no ON CONFLICT, so update first, then insert.
  update dpdp.partner_payout_detail
     set method = v_method, upi_id = v_upi, account_name = v_name, account_number = v_acct, ifsc = v_ifsc, pan = v_pan, updated_at = v_now
   where identity_id = v_identity;
  if not found then
    insert into dpdp.partner_payout_detail (identity_id, method, upi_id, account_name, account_number, ifsc, pan, created_at, updated_at)
    values (v_identity, v_method, v_upi, v_name, v_acct, v_ifsc, v_pan, v_now, v_now);
  end if;

  -- The audit row names the method and nothing else.
  perform public.dpdp__partner_event(v_identity, 'partner_payout_details_saved', 'Saved payout details', v_method);
  if v_changed then
    perform public.dpdp__partner_notify(v_identity, 'details_changed', replace(gen_random_uuid()::text, '-', ''),
      jsonb_build_object('at', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), false);
  end if;
  v_activated := public.dpdp__partner_try_activate(v_identity);
  return jsonb_build_object('ok', true, 'status', (select sp.status from dpdp.sales_partner sp where sp.identity_id = v_identity), 'activated', v_activated);
end
$$;
