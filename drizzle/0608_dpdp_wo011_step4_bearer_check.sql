-- WO-DPDP-011 Step 4, addendum: the Edge Function must work with ONLY the
-- platform-injected env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) plus
-- Vault, because `supabase secrets set` is not runnable from the PM's
-- machine. When DPDP_TIMER_SECRET is not set as a function secret, the
-- function verifies the cron's bearer through this service_role-only RPC
-- instead, against the SAME Vault secret the cron reads
-- (vault.decrypted_secrets name 'dpdp_timer_secret', see 0606 §12).
--
-- Both sides are sha256-hashed before comparison, so the comparison is on
-- fixed-length digests rather than the raw secret (constant-time-ish; the
-- caller already holds service_role, this only guards the timer path).
-- Additive: one function, one grant. Applied separately from 0606.
create or replace function public.dpdp_timer_check_bearer(p_bearer text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if p_bearer is null or length(p_bearer) < 24 then
    return false;
  end if;
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'dpdp_timer_secret'
  order by s.created_at desc
  limit 1;
  if v_secret is null or length(v_secret) < 24 then
    return false;
  end if;
  return encode(sha256(convert_to(p_bearer, 'UTF8')), 'hex') = encode(sha256(convert_to(v_secret, 'UTF8')), 'hex');
end
$$;

revoke all on function public.dpdp_timer_check_bearer(text) from public, anon, authenticated;
grant execute on function public.dpdp_timer_check_bearer(text) to service_role;
