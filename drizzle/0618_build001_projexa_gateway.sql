-- PROJEXA-BUILD-001 U-25 (PMD-01): the database side of the identity gateway -- a PROJEXA browser session reads verdian-ai
-- construction data of its own organisation through the Edge Function projexa-read, with no Vercel function in the path.
--
-- WHAT
--   platform.projexa_gateway_settings (one row, id = 1)
--     enabled         the fail-closed switch of the whole gateway. Default false, and THIS FILE NEVER SETS IT TRUE: the PM flips it
--                     by a separate, reviewed migration. Off, the Edge Function answers 503 and the data wrapper returns 'disabled'.
--     email_fallback  whether a caller whose token sub is not linked may be matched by the token's email (below). Default false,
--                     so the pilot serves only the PROJEXA accounts linked through compliance.users.auth_user_id (MASTER_PLAN
--                     phase 3 default; linking the unlinked accounts is owner question OQ-15, and an email match must not decide it
--                     silently). Also flipped only by a reviewed migration.
--     updated_at
--   public.projexa_read_enabled() returns boolean
--     the switch; false when the row is missing.
--   public.projexa_read_resolve_user(p_sub text, p_email text) returns table (user_id text, org_id text, reason text)
--     always one row. p_sub is the verified token's sub (a PROJEXA auth user id). The linked user is the compliance.users row with
--     auth_user_id = p_sub: exactly one active row with an organisation -> (user id, org id, null); more than one -> reason
--     'ambiguous'; rows but none active -> 'deactivated'; a linked row without an organisation -> 'not_linked'. With no linked row
--     at all, and only when email_fallback is on, the same rule is applied to the rows whose lower(email) equals lower(p_email).
--     Otherwise 'not_linked'. An organisation is never guessed: anything but exactly one active user gives no org id.
--   public.projexa_read_boq_lines(p_sub, p_email, p_project_id, p_after, p_limit) returns jsonb
--     {"status":"disabled"} when the switch is off; {"status":"not_linked"|"deactivated"|"ambiguous"} when the caller does not
--     resolve; {"status":"not_found"} when p_project_id is not a compliance.projects row of the caller's organisation (another
--     organisation's project and a missing project give the same answer); otherwise {"status":"ok","rows":[...],"nextAfter":...}:
--     the line items of every BOQ of that project, ordered by line id in byte order (COLLATE "C"), at most p_limit (1 to 500)
--     after p_after, nextAfter set only when another page exists. Numbers are returned as text (exact). The project-side fields
--     qty_project and rate_project are never selected (src/lib/services/cost-visibility-service.ts is their one gate).
--
-- ORGANISATION ISOLATION: the organisation comes only from the verified sub, never from the request, and every tenant table read
--   carries its own org filter: compliance.projects.org_id, compliance.construction_boqs.org_id AND
--   compliance.construction_boq_line_items.org_id must all equal the caller's organisation (three independently stored columns).
--   Row-level security does NOT add a second layer here, and this is deliberate, not an omission: (1) Postgres refuses
--   `SET [LOCAL] ROLE` inside a SECURITY DEFINER function ("cannot set parameter "role" within security-definer function"; proven
--   on PGlite by src/lib/services/projexa-read-gateway.test.ts), so the function cannot become app_runtime; (2) the owner, postgres,
--   has BYPASSRLS on verdian-ai (pg_roles, read 2026-09-25), so setting app.current_org_id inside the function would change
--   nothing. The explicit filters are the isolation; BR-320 (scripts/verify/gateway-crossorg-sql.sh) proves separately, as
--   app_runtime, that the tenant policies themselves also isolate these tables.
--
-- GRANTS: the three functions are SECURITY DEFINER with search_path = '', revoked from public, anon and authenticated (Supabase's
--   default privileges in schema public grant EXECUTE on every new function to both), granted to service_role alone (guard G-5 in
--   ai-os/SHARED_BOUNDARY.md returns 0; nothing to app_runtime). The table has RLS on and forced with no policy, and is revoked from
--   everyone including app_runtime (schema platform's default privileges grant app_runtime and service_role read/write on every new
--   table), then granted SELECT to service_role only. No grant on any compliance.construction_* table changes (BR-321).
--
-- DATA LOSS: none. Additive: one table with its one row (the switch, off), three functions.
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the claim (ACTIVE-CLAIMS, phase 3 addendum 2, 2026-09-25) is on main
--   and the always-aborted rehearsal of ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md passed. Idempotent: create if not exists,
--   create or replace, and the row insert does nothing when the row exists (a re-run never resets a switch the PM already flipped).
--
-- ROLLBACK: drizzle/down/0618_build001_projexa_gateway.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the switch -----------------------------------------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.projexa_gateway_settings (
  id smallint NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT false,
  email_fallback boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projexa_gateway_settings_pkey PRIMARY KEY (id),
  CONSTRAINT projexa_gateway_settings_single_row CHECK (id = 1)
);

INSERT INTO platform.projexa_gateway_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE platform.projexa_gateway_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.projexa_gateway_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.projexa_gateway_settings FROM PUBLIC, anon, authenticated, app_runtime, service_role;
GRANT SELECT ON TABLE platform.projexa_gateway_settings TO service_role;

CREATE OR REPLACE FUNCTION public.projexa_read_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT coalesce((SELECT s.enabled FROM platform.projexa_gateway_settings s WHERE s.id = 1), false)
$fn$;

REVOKE ALL ON FUNCTION public.projexa_read_enabled() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projexa_read_enabled() TO service_role;

-- 2. who is calling --------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_read_resolve_user(p_sub text, p_email text)
RETURNS TABLE (user_id text, org_id text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_sub uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_fallback boolean;
  v_usable integer;
  v_inactive integer;
  v_all integer;
  v_user text;
  v_org text;
BEGIN
  IF p_sub ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_sub := p_sub::uuid;
  END IF;

  IF v_sub IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE u.is_active AND u.org_id IS NOT NULL),
           count(*) FILTER (WHERE NOT u.is_active),
           count(*),
           min(u.id) FILTER (WHERE u.is_active AND u.org_id IS NOT NULL),
           min(u.org_id) FILTER (WHERE u.is_active AND u.org_id IS NOT NULL)
      INTO v_usable, v_inactive, v_all, v_user, v_org
      FROM compliance.users u
     WHERE u.auth_user_id = v_sub;
    IF v_usable = 1 THEN
      RETURN QUERY SELECT v_user, v_org, NULL::text;
      RETURN;
    ELSIF v_usable > 1 THEN
      RETURN QUERY SELECT NULL::text, NULL::text, 'ambiguous'::text;
      RETURN;
    ELSIF v_inactive > 0 THEN
      RETURN QUERY SELECT NULL::text, NULL::text, 'deactivated'::text;
      RETURN;
    ELSIF v_all > 0 THEN
      -- linked, active, but no organisation: nothing to scope to, and an explicit link is never overridden by an email match
      RETURN QUERY SELECT NULL::text, NULL::text, 'not_linked'::text;
      RETURN;
    END IF;
  END IF;

  SELECT coalesce((SELECT s.email_fallback FROM platform.projexa_gateway_settings s WHERE s.id = 1), false) INTO v_fallback;
  IF v_fallback AND v_email <> '' THEN
    SELECT count(*) FILTER (WHERE u.is_active AND u.org_id IS NOT NULL),
           count(*) FILTER (WHERE NOT u.is_active),
           min(u.id) FILTER (WHERE u.is_active AND u.org_id IS NOT NULL),
           min(u.org_id) FILTER (WHERE u.is_active AND u.org_id IS NOT NULL)
      INTO v_usable, v_inactive, v_user, v_org
      FROM compliance.users u
     WHERE lower(u.email) = v_email;
    IF v_usable = 1 THEN
      RETURN QUERY SELECT v_user, v_org, NULL::text;
      RETURN;
    ELSIF v_usable > 1 THEN
      RETURN QUERY SELECT NULL::text, NULL::text, 'ambiguous'::text;
      RETURN;
    ELSIF v_inactive > 0 THEN
      RETURN QUERY SELECT NULL::text, NULL::text, 'deactivated'::text;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT NULL::text, NULL::text, 'not_linked'::text;
END
$fn$;

REVOKE ALL ON FUNCTION public.projexa_read_resolve_user(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projexa_read_resolve_user(text, text) TO service_role;

-- 3. one project's BOQ line items, one page ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_read_boq_lines(p_sub text, p_email text, p_project_id text, p_after text, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_after text := nullif(p_after, '');
  v_user text;
  v_org text;
  v_reason text;
  v_rows jsonb;
  v_count integer;
  v_next text;
BEGIN
  IF NOT public.projexa_read_enabled() THEN
    RETURN jsonb_build_object('status', 'disabled');
  END IF;

  IF p_project_id IS NULL OR p_project_id = '' OR length(p_project_id) > 128 OR length(v_after) > 128
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'projexa_read_boq_lines: p_project_id (1 to 128 characters), p_after (at most 128) and p_limit (1 to 500) are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason
    FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;

  -- The project must be the caller's organisation's. Another organisation's project and a missing one answer the same.
  IF NOT EXISTS (SELECT 1 FROM compliance.projects p WHERE p.id = p_project_id AND p.org_id = v_org) THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT coalesce(jsonb_agg(t.j ORDER BY t.k), '[]'::jsonb), count(*)::integer
    INTO v_rows, v_count
    FROM (
      SELECT l.id COLLATE "C" AS k,
             jsonb_build_object(
               'id', l.id,
               'boqId', l.boq_id,
               'boqTitle', b.title,
               'boqVersion', b.version,
               'boqStatus', b.status::text,
               'parentLineItemId', l.parent_line_item_id,
               'activityId', l.activity_id,
               'itemCode', l.item_code,
               'category', l.category,
               'description', l.description,
               'unit', l.unit,
               'quantity', l.quantity::text,
               'rate', l.rate::text,
               'amount', l.amount::text,
               'qtyContract', l.qty_contract::text,
               'rateContract', l.rate_contract::text,
               'materialCost', l.material_cost::text,
               'labourCost', l.labour_cost::text,
               'equipmentCost', l.equipment_cost::text,
               'overheadPercent', l.overhead_percent::text,
               'profitPercent', l.profit_percent::text,
               'breakdownPercentage', l.breakdown_percentage::text,
               'budgetPercentage', l.budget_percentage::text,
               'vendorId', l.vendor_id,
               'vendorAmount', l.vendor_amount::text,
               'materialAmount', l.material_amount::text,
               'manpowerAmount', l.manpower_amount::text,
               'createdAt', l.created_at
             ) AS j
        FROM compliance.construction_boq_line_items l
        JOIN compliance.construction_boqs b ON b.id = l.boq_id
       WHERE b.project_id = p_project_id
         AND b.org_id = v_org
         AND l.org_id = v_org
         AND (v_after IS NULL OR l.id COLLATE "C" > v_after COLLATE "C")
       ORDER BY l.id COLLATE "C"
       LIMIT p_limit + 1
    ) t;

  -- One row more than asked for was read only to know whether another page exists.
  IF v_count > p_limit THEN
    v_rows := v_rows - p_limit;
    v_next := v_rows -> (p_limit - 1) ->> 'id';
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'rows', v_rows, 'nextAfter', v_next);
END
$fn$;

REVOKE ALL ON FUNCTION public.projexa_read_boq_lines(text, text, text, text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projexa_read_boq_lines(text, text, text, text, integer) TO service_role;

COMMIT;
