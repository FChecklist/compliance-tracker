-- PRE-APPROVED-LIVE-DDL: Owner delegated full PM authority and ordered the 100-point audit gaps closed (project manager order, "100% proper fix ... no asking"), in chat on 2026-10-06; owner approved the G-09 design (veridian_credentials moves to the compliance side so organisation provisioning runs inside the projexa-api Edge Function). Adds one table and four SECURITY DEFINER functions; nothing existing is altered.
-- G-09 (AUDIT-100): PROJEXA ORGANISATION PROVISIONING WITHOUT A VERCEL ROUTE AND WITHOUT A KEY ON ANY USER LAPTOP.
--
-- WHAT
--   compliance.projexa_org_credentials   PROJEXA organisation id (uuid, from the PROJEXA Supabase project) -> VERIDIAN organisation id + the organisation's
--     VERIDIAN API key (plaintext, because it is sent upstream as a Bearer token: the same thing PROJEXA public.veridian_credentials has held until now).
--     SECRECY IS AT LEAST AS STRONG AS TODAY: row level security is ENABLED and FORCED with NO policy, every grant is revoked from public, anon, authenticated
--     and app_runtime, and nobody but the table owner (migration role) can reach it directly: service_role too goes only through the functions below. It is NOT exposed to PostgREST
--     (schema compliance is not an exposed schema) and the plaintext is only ever returned by projexa_org_credential_get, granted to service_role alone.
--   public.projexa_provision_org(p_name, p_country, p_currency, p_key_hash, p_key_prefix) -> (outcome, organisation_id)
--     the whole of POST /api/v1/platform/provision-org + provisionOrganisation() + the 'projexa' REQUIRED_BRANCHES_BY_APPLICATION step, in ONE transaction:
--     organisation (free plan, $20 cost cap, country default IN, primary branch = projexa), a free slug (-1 .. -20 on collision), the base currency, the
--     VERI Reward / VERI Chat v2 / construction / erp / sales / hr enablements, the current calendar fiscal year and the 6-account chart, the "General"
--     department and ONE org api_keys row (the caller supplies only the SHA-256 hash and prefix of a key it generated; this function never sees the key).
--     The seeding steps are non-fatal exactly as in TypeScript (a sub-transaction each); the organisation and its api key are not. Because it is ONE
--     transaction a failure leaves NOTHING behind (the TypeScript route could leave an orphaned organisation; this cannot).
--     outcomes: created | bad_input | not_configured (the 'projexa' platform_applications row is missing or inactive).
--   public.projexa_org_credential_put(p_projexa_org_id, p_veridian_org_id, p_api_key) -> outcome
--     stored | exists (first writer wins, never overwritten: the repair race) | bad_input | key_mismatch (the key's SHA-256 is not an active api_keys row of that
--     VERIDIAN organisation) -- a credentials row can therefore never point at a key that does not belong to the organisation it names.
--   public.projexa_org_credential_get(p_projexa_org_id) -> (veridian_org_id, api_key)     the only reader of the plaintext
--   public.projexa_org_veridian_id_get(p_projexa_org_id) -> veridian_org_id               the member-link lookup (never the key)
--
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, revoked from public, anon, authenticated and app_runtime; granted to service_role alone.
-- DATA LOSS: none. Applying it twice changes nothing (CREATE ... IF NOT EXISTS / CREATE OR REPLACE).
-- BACKFILL of the existing PROJEXA public.veridian_credentials rows is a SEPARATE, reviewed step: scripts/g09-backfill-credentials.mjs (never run by this migration).
-- ROLLBACK: drizzle/down/0729_projexa_org_credentials_and_provision.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS compliance.projexa_org_credentials (
  projexa_org_id uuid PRIMARY KEY,
  veridian_org_id text NOT NULL UNIQUE REFERENCES compliance.organisations (id) ON DELETE CASCADE,
  veridian_api_key text NOT NULL CHECK (btrim(veridian_api_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE compliance.projexa_org_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.projexa_org_credentials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE compliance.projexa_org_credentials FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON TABLE compliance.projexa_org_credentials FROM app_runtime';
  END IF;
END $$;

COMMENT ON TABLE compliance.projexa_org_credentials IS 'G-09: PROJEXA organisation id -> VERIDIAN organisation id + its API key. RLS forced, no policy, no grants: reachable only through public.projexa_org_credential_* (service_role).';

CREATE OR REPLACE FUNCTION public.projexa_provision_org(p_name text, p_country text, p_currency text, p_key_hash text, p_key_prefix text)
RETURNS TABLE(outcome text, organisation_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_country text := coalesce(nullif(upper(btrim(coalesce(p_country, ''))), ''), 'IN');
  v_cur text := coalesce(nullif(upper(btrim(coalesce(p_currency, ''))), ''), 'INR');
  v_app_id text;
  v_app_name text;
  v_branch text;
  v_base text;
  v_slug text;
  v_n int := 0;
  v_org text;
  v_year int := extract(year from (now() AT TIME ZONE 'UTC'))::int;
  v_cur_name text;
BEGIN
  IF v_name = '' OR coalesce(p_key_hash, '') !~ '^[0-9a-f]{64}$' OR btrim(coalesce(p_key_prefix, '')) = '' THEN
    RETURN QUERY SELECT 'bad_input'::text, NULL::text;
    RETURN;
  END IF;
  IF length(v_name) > 200 THEN v_name := left(v_name, 200); END IF;

  SELECT a.id, a.display_name INTO v_app_id, v_app_name FROM compliance.platform_applications a WHERE a.application_key = 'projexa' AND a.is_active;
  IF v_app_id IS NULL THEN
    RETURN QUERY SELECT 'not_configured'::text, NULL::text;
    RETURN;
  END IF;

  -- provisioning is low volume: one at a time keeps the slug check and the insert one decision
  PERFORM pg_advisory_xact_lock(hashtext('projexa_provision_org'));

  SELECT b.id INTO v_branch FROM platform.product_branches b WHERE b.branch_key = 'projexa';

  -- slugify() of org-provisioning-service.ts, then the first free "-N" (N = 1..20)
  v_base := left(btrim(regexp_replace(lower(btrim(v_name)), '[^a-z0-9]+', '-', 'g'), '-'), 60);
  IF v_base = '' THEN v_base := 'org'; END IF;
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM compliance.organisations o WHERE o.slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
    EXIT WHEN v_n > 20;
  END LOOP;

  INSERT INTO compliance.organisations (name, slug, plan, country, primary_product_branch_id, monthly_cost_cap_usd, cost_cap_enforcement_enabled)
  VALUES (v_name, v_slug, 'free', v_country, v_branch, 20, true)
  RETURNING id INTO v_org;

  -- base currency (non-fatal)
  BEGIN
    v_cur_name := CASE v_cur WHEN 'AED' THEN 'UAE Dirham' WHEN 'INR' THEN 'Indian Rupee' WHEN 'USD' THEN 'US Dollar' WHEN 'EUR' THEN 'Euro'
      WHEN 'GBP' THEN 'Pound Sterling' WHEN 'SAR' THEN 'Saudi Riyal' WHEN 'QAR' THEN 'Qatari Riyal' WHEN 'OMR' THEN 'Omani Rial'
      WHEN 'BHD' THEN 'Bahraini Dinar' WHEN 'KWD' THEN 'Kuwaiti Dinar' ELSE v_cur END;
    INSERT INTO compliance.erp_currencies (org_id, code, name, symbol, is_base_currency) VALUES (v_org, v_cur, v_cur_name, v_cur, true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'projexa_provision_org: base currency seeding failed (non-fatal): %', SQLERRM;
  END;

  -- the two free branches every organisation gets (non-fatal, one each)
  BEGIN
    INSERT INTO compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled, enabled_at)
    SELECT v_org, b.id, true, now() FROM platform.product_branches b WHERE b.branch_key = 'veri_reward';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'projexa_provision_org: veri_reward enablement failed (non-fatal): %', SQLERRM;
  END;
  BEGIN
    INSERT INTO compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled, enabled_at)
    SELECT v_org, b.id, true, now() FROM platform.product_branches b WHERE b.branch_key = 'veri_chat_v2';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'projexa_provision_org: veri_chat_v2 enablement failed (non-fatal): %', SQLERRM;
  END;

  -- fiscal year + minimal chart of accounts (non-fatal, insert-only)
  BEGIN
    INSERT INTO compliance.erp_fiscal_years (org_id, year_name, start_date, end_date, is_closed)
    VALUES (v_org, 'FY' || v_year, make_date(v_year, 1, 1), make_date(v_year, 12, 31), false);
    INSERT INTO compliance.erp_accounts (org_id, account_name, account_number, root_type, account_type, is_group) VALUES
      (v_org, 'Assets', '1000', 'asset', NULL, true),
      (v_org, 'Liabilities', '2000', 'liability', NULL, true),
      (v_org, 'Equity', '3000', 'equity', NULL, true),
      (v_org, 'Revenue', '4000', 'income', 'income', false),
      (v_org, 'Direct Costs', '5000', 'expense', 'expense', false),
      (v_org, 'Overheads', '6000', 'expense', 'expense', false);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'projexa_provision_org: fiscal year / chart seeding failed (non-fatal): %', SQLERRM;
  END;

  INSERT INTO compliance.departments (name, org_id) VALUES ('General', v_org);

  -- REQUIRED_BRANCHES_BY_APPLICATION.projexa (non-fatal)
  BEGIN
    INSERT INTO compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled, enabled_at)
    SELECT v_org, b.id, true, now() FROM platform.product_branches b WHERE b.branch_key IN ('construction', 'erp', 'sales', 'hr')
    ON CONFLICT (org_id, product_branch_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'projexa_provision_org: required branch enablement failed (non-fatal): %', SQLERRM;
  END;

  -- the organisation's one service key (the hash only: the caller keeps the key)
  INSERT INTO compliance.api_keys (name, key_hash, key_prefix, org_id, scopes, is_active, issued_for_application_id)
  VALUES (v_app_name || ' (provisioned)', p_key_hash, left(btrim(p_key_prefix), 16), v_org, 'read,write', true, v_app_id);

  RETURN QUERY SELECT 'created'::text, v_org;
END
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_org_credential_put(p_projexa_org_id uuid, p_veridian_org_id text, p_api_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_n int;
BEGIN
  IF p_projexa_org_id IS NULL OR btrim(coalesce(p_veridian_org_id, '')) = '' OR btrim(coalesce(p_api_key, '')) = '' THEN
    RETURN 'bad_input';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM compliance.api_keys k
     WHERE k.org_id = p_veridian_org_id AND k.is_active AND k.key_hash = encode(sha256(convert_to(p_api_key, 'UTF8')), 'hex')
  ) THEN
    RETURN 'key_mismatch';
  END IF;
  INSERT INTO compliance.projexa_org_credentials (projexa_org_id, veridian_org_id, veridian_api_key)
  VALUES (p_projexa_org_id, p_veridian_org_id, p_api_key)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN CASE WHEN v_n = 1 THEN 'stored' ELSE 'exists' END;
END
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_org_credential_get(p_projexa_org_id uuid)
RETURNS TABLE(veridian_org_id text, api_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.veridian_org_id, c.veridian_api_key FROM compliance.projexa_org_credentials c WHERE c.projexa_org_id = p_projexa_org_id
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_org_veridian_id_get(p_projexa_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.veridian_org_id FROM compliance.projexa_org_credentials c WHERE c.projexa_org_id = p_projexa_org_id
$fn$;

REVOKE ALL ON FUNCTION public.projexa_provision_org(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_org_credential_put(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_org_credential_get(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_org_veridian_id_get(uuid) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_provision_org(text, text, text, text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_org_credential_put(uuid, text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_org_credential_get(uuid) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_org_veridian_id_get(uuid) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_provision_org(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_org_credential_put(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_org_credential_get(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_org_veridian_id_get(uuid) TO service_role;

COMMIT;
