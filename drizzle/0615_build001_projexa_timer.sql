-- PROJEXA-BUILD-001 U-21 (PMD-12): the database side of the PROJEXA timer -- the exchange-rate refresh moves off the Vercel cron
-- (vercel.json "/api/internal/exchange-rate-refresh/run", 30 9 * * *) onto pg_cron -> pg_net -> the Edge Function projexa-timer.
--
-- WHAT
--   public.projexa_timer_check_bearer(p_bearer text) returns boolean
--     compares sha256(p_bearer) with sha256 of the Vault secret 'projexa_timer_secret'; false on a short bearer or a missing secret.
--     Same model as public.dpdp_timer_check_bearer (drizzle/0608), reading PROJEXA's own secret, never the DPDP one.
--   public.projexa_timer_exchange_plan() returns jsonb
--     one entry per org that has a base currency: {orgId, baseId, baseCode, others:[{id, code}]}. Read only.
--   public.projexa_timer_apply_exchange_rates(p_org_id text, p_rate_date date, p_pairs jsonb) returns integer
--     for one org and one day: checks that every currency id in p_pairs belongs to that org and every rate is positive, deletes that
--     day's source = 'live' rows, inserts the pairs as source = 'live', returns the number inserted. It is the SQL twin of
--     refreshOrgLiveRates in src/lib/services/erp-accounting-service.ts: idempotent per (org, day), never touches a 'manual' rate.
--   cron job 'projexa-exchange-rate-refresh' at 30 9 * * * (UTC): net.http_post to the URL in Vault 'projexa_timer_url' with the bearer
--     in Vault 'projexa_timer_secret' and body {"job":"exchange_rate_refresh"}. Created only when the cron schema exists.
--
-- GRANTS: all three functions are SECURITY DEFINER with search_path = '', revoked from public, anon and authenticated, granted to
--   service_role alone (guard query G-5 in ai-os/SHARED_BOUNDARY.md returns 0). Nothing is granted to app_runtime.
--
-- NOT IN THIS FILE: the two Vault secrets. Their values are generated inside the database by the PM (vault.create_secret with a
--   random value) and are never written to a file, a log or a document. Until they exist the cron job runs and fails harmlessly.
--
-- WHY THREE WRAPPERS: the Edge Function reaches the database through PostgREST with the service-role key, and PostgREST exposes only
--   schema public. compliance.erp_exchange_rates has FORCE ROW LEVEL SECURITY; these functions run as their owner.
--
-- DATA LOSS: none. Additive (three functions and one cron row). The first run of the job writes today's source = 'live' rates for
--   every org that has a base currency and at least one other currency (3 orgs on 2026-09-25).
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the claim (ACTIVE-CLAIMS, 2026-09-25) is on main and the
--   always-aborted rehearsal of ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md passed. Idempotent: create or replace, and
--   cron.schedule upserts by job name.
--
-- ROLLBACK: drizzle/down/0615_build001_projexa_timer.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. bearer check ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_timer_check_bearer(p_bearer text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_secret text;
BEGIN
  IF p_bearer IS NULL OR length(p_bearer) < 24 THEN
    RETURN false;
  END IF;
  SELECT s.decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets s
  WHERE s.name = 'projexa_timer_secret'
  ORDER BY s.created_at DESC
  LIMIT 1;
  IF v_secret IS NULL OR length(v_secret) < 24 THEN
    RETURN false;
  END IF;
  RETURN encode(sha256(convert_to(p_bearer, 'UTF8')), 'hex') = encode(sha256(convert_to(v_secret, 'UTF8')), 'hex');
END
$fn$;

REVOKE ALL ON FUNCTION public.projexa_timer_check_bearer(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projexa_timer_check_bearer(text) TO service_role;

-- 2. plan: which orgs, which base, which other currencies ----------------------------
CREATE OR REPLACE FUNCTION public.projexa_timer_exchange_plan()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_out jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'orgId', b.org_id,
           'baseId', b.id,
           'baseCode', b.code,
           'others', (
             SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code) ORDER BY o.code, o.id), '[]'::jsonb)
             FROM compliance.erp_currencies o
             WHERE o.org_id = b.org_id AND o.id <> b.id
           )
         ) ORDER BY b.org_id), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT DISTINCT ON (c.org_id) c.id, c.org_id, c.code
    FROM compliance.erp_currencies c
    WHERE c.is_base_currency
    ORDER BY c.org_id, c.created_at, c.id
  ) b;
  RETURN v_out;
END
$fn$;

REVOKE ALL ON FUNCTION public.projexa_timer_exchange_plan() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projexa_timer_exchange_plan() TO service_role;

-- 3. apply one org's rates for one day ---------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_timer_apply_exchange_rates(p_org_id text, p_rate_date date, p_pairs jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_count integer;
BEGIN
  IF p_org_id IS NULL OR p_rate_date IS NULL OR jsonb_typeof(p_pairs) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'projexa_timer_apply_exchange_rates: p_org_id, p_rate_date and an array p_pairs are required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_pairs) AS x("fromCurrencyId" text, "toCurrencyId" text, rate numeric)
    WHERE x."fromCurrencyId" IS NULL OR x."toCurrencyId" IS NULL OR x.rate IS NULL OR x.rate <= 0
       OR NOT EXISTS (SELECT 1 FROM compliance.erp_currencies c WHERE c.id = x."fromCurrencyId" AND c.org_id = p_org_id)
       OR NOT EXISTS (SELECT 1 FROM compliance.erp_currencies c WHERE c.id = x."toCurrencyId" AND c.org_id = p_org_id)
  ) THEN
    RAISE EXCEPTION 'projexa_timer_apply_exchange_rates: a pair names a currency outside org % or carries a non-positive rate', p_org_id;
  END IF;

  DELETE FROM compliance.erp_exchange_rates
  WHERE org_id = p_org_id AND rate_date = p_rate_date AND source = 'live';

  INSERT INTO compliance.erp_exchange_rates (org_id, from_currency_id, to_currency_id, rate, rate_date, source)
  SELECT p_org_id, x."fromCurrencyId", x."toCurrencyId", x.rate, p_rate_date, 'live'
  FROM jsonb_to_recordset(p_pairs) AS x("fromCurrencyId" text, "toCurrencyId" text, rate numeric);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

REVOKE ALL ON FUNCTION public.projexa_timer_apply_exchange_rates(text, date, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projexa_timer_apply_exchange_rates(text, date, jsonb) TO service_role;

-- 4. the cron job (only where pg_cron is installed) --------------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule(
      'projexa-exchange-rate-refresh',
      '30 9 * * *',
      $cron$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'projexa_timer_url'),
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'projexa_timer_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{"job":"exchange_rate_refresh"}'::jsonb,
          timeout_milliseconds := 300000
        )
      $cron$
    );
  END IF;
END
$do$;

COMMIT;
