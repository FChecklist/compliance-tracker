-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "complete the PROJEXA local-first system ... the whole database of that user and their organisation (as per role) live on the laptop" and "a user sees their own organisation's data as per role" (requirements R4 and G5). This migration adds the ORGANISATION-LEVEL master data to the local-first sync (cloud package lf-b1-org-masters).
-- PROJEXA SYNC: ORGANISATION MASTERS (claude/lf-b1-org-masters).
--
-- WHAT
--   9 ORGANISATION kinds, beside the 28 project kinds of 0683 (which are not touched):
--     vendors          compliance.erp_suppliers              boq_categories   compliance.construction_boq_categories
--     customers        compliance.erp_customers              currencies       compliance.erp_currencies
--     companies        compliance.erp_companies              exchange_rates   compliance.erp_exchange_rates
--     departments      compliance.departments                org_people       compliance.users
--     cost_visibility  compliance.cost_visibility_config
--   (`org_people`, not `people`: `people` is already an AI-link record kind with a PROJECT scope and its own masking.)
--   public.projexa_sync__org_kinds()           the ONE list of organisation kinds (kept apart from public.projexa_sync__kinds(), which stays the 28 project kinds).
--   public.projexa_sync__org_src(kind)         per kind: the relation, the EXPLICIT COLUMN ALLOW-LIST, the money columns among them, and the MINIMUM ROLE RANK.
--   public.projexa_sync__org_hidden_cols(...)  the money columns a role may not see (the rule of ai_work_link__hidden_cols, 0624, applied to these kinds' money columns).
--   public.projexa_sync__org_view_class(...)   a fingerprint of what a role may read of the organisation kinds (gate + hidden columns). Peers may hand each other
--                                              organisation rows only when this is equal. The project `view_class` (0678) is NOT changed, so project peer sharing and
--                                              the work-job visibility of 0682 behave exactly as before.
--   public.projexa_sync_org_pull / projexa_sync_org_pull_ids / projexa_sync_org_ids / projexa_sync_org_changes
--                                              keyset pull, exact rows by id, the id inventory (deletes) and the change feed of the organisation kinds.
--   public.projexa_sync_manifest(...)          REPLACED (additive): 0678's answer plus `org_kinds` (only the kinds the person's role may read) and `org_view_class`.
--   platform.projexa_track_change()            REPLACED: 0683's function plus the organisation kinds, which are filed under the SENTINEL project id '__org__' in
--                                              platform.projexa_record_head and platform.projexa_change_log. For them the content hash is over the ALLOW-LISTED
--                                              columns only, so a login (users.last_login_at) or a password change is NOT a new version and nothing outside the
--                                              allow-list influences what a laptop sees.
--   9 triggers `projexa_track_change` on the tables above (a table missing in an environment is skipped).
--
-- AUTHORITY. The person is resolved by public.projexa_read_resolve_user and checked by projexa_sync__ctx exactly as for every project kind. EVERY query is
-- scoped `t.org_id = <the person's organisation>`, and that scope is ONE string (projexa_sync__org_src.scope_sql) used by the candidate list, the row
-- fetch, the id inventory and the exact-ids mode. ROLE GATE: rank (ai_work_link__role_rank) >= the kind's min_rank, else the one AW404 (the same
-- answer as an unknown kind): vendors, customers, companies, boq_categories, currencies, exchange_rates, departments, org_people need a member (2);
-- cost_visibility is readable by every person (1) so a viewer's laptop can hide cost fields the same way the server does. A viewer / client_viewer /
-- external_auditor / stage_0 therefore never receives vendor, customer or company master data.
-- COLUMNS. Never `select *`: every row is jsonb_build_object over the kind's allow-list INTERSECTED with the columns that really exist (so schema drift
-- cannot make a function fail, and a column added later never leaks until it is added here). Left out ON PURPOSE: tax ids (gstin, pan_number), bank
-- accounts (they live in other tables and are never joined), passwords and passcodes, auth ids, avatar, login times, onboarding state, risk/sanction
-- screening and tax-withholding links, reporting lines, the person who changed a cost setting. org_people: id, name, role, is_active and email, the email
-- MASKED with public.ai_work_link__mask_email for everyone except the person themself (0625/0643's own rule for a user link, hide_personal = true).
-- MONEY. credit_limit (vendors, customers) is the only money column; it is NULL below rank 3, exactly as ai_work_link__hidden_cols treats money.
--
-- WIRE. A pull/ids page of an organisation kind has the shape of a project page (items with id, updated_at, version, data); the Edge function signs
-- every item with project = '__org__'. The change feed of the organisation is asked for with project_id '__org__' (projexa_sync_org_changes), and lists
-- only the organisation kinds the person's role may read. See supabase/functions/projexa-sync/README.md.
--
-- ERRORS (coded, same as 0677): AW404 NOT_FOUND (unknown kind, a kind the role may not read); AW400 BAD_CURSOR / BAD_LIMIT. A person who does not
-- resolve gets {"status": <reason>} and no data.
-- COST. One small indexed upsert and one append per REAL change of a master row (inside the business write's transaction). erp_exchange_rates is
-- refreshed by a daily live feed: that is a few rows per currency per organisation per day.
-- LOCKS. CREATE TRIGGER takes a SHARE ROW EXCLUSIVE lock on each table for an instant (compliance.users included); lock_timeout 5 s; one transaction.
-- GRANTS: SECURITY DEFINER for the entry points, search_path = pg_catalog, pg_temp, timezone UTC; every function revoked from public, anon,
-- authenticated, app_runtime; the six entry points are granted to service_role alone; the helpers to nobody.
-- DATA LOSS: none. No table is altered; functions are added or replaced with a superset answer; triggers are added. Applying it twice changes nothing.
-- ROLLBACK: drizzle/down/0684_projexa_sync_org_masters.down.sql (drops the 9 triggers FIRST, then restores 0683's trigger function and 0678's manifest
-- exactly, then drops the new functions).

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the list ------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync__org_kinds()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT ARRAY['vendors', 'customers', 'companies', 'boq_categories', 'currencies', 'exchange_rates', 'departments', 'org_people', 'cost_visibility']::text[] $fn$;

-- 2. the sources: relation, scope (on $1 = the organisation), column allow-list, money columns, minimum role rank --------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync__org_src(p_kind text)
RETURNS TABLE (rel text, scope_sql text, cols text[], money_cols text[], min_rank integer)
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.r, 't.org_id = $1', v.c, v.m, v.n FROM (VALUES
    ('vendors',         'compliance.erp_suppliers',
       ARRAY['id', 'supplier_name', 'supplier_type', 'trade', 'project_id', 'default_payment_terms_days', 'credit_limit', 'qualification_status', 'is_active', 'created_at', 'updated_at'],
       ARRAY['credit_limit'], 2),
    ('customers',       'compliance.erp_customers',
       ARRAY['id', 'customer_name', 'client_id', 'default_payment_terms_days', 'credit_limit', 'is_active', 'created_at', 'updated_at'],
       ARRAY['credit_limit'], 2),
    ('companies',       'compliance.erp_companies',
       ARRAY['id', 'company_name', 'abbr', 'parent_company_id', 'is_group', 'default_currency_id', 'country', 'date_of_incorporation', 'is_active', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2),
    ('boq_categories',  'compliance.construction_boq_categories',
       ARRAY['id', 'name', 'sort_order', 'is_active', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2),
    ('currencies',      'compliance.erp_currencies',
       ARRAY['id', 'code', 'name', 'symbol', 'is_base_currency', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2),
    ('exchange_rates',  'compliance.erp_exchange_rates',
       ARRAY['id', 'from_currency_id', 'to_currency_id', 'rate', 'rate_date', 'source', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2),
    ('departments',     'compliance.departments',
       ARRAY['id', 'name', 'description', 'head_id', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2),
    ('org_people',      'compliance.users',
       ARRAY['id', 'name', 'role', 'is_active', 'email'],
       ARRAY[]::text[], 2),
    ('cost_visibility', 'compliance.cost_visibility_config',
       ARRAY['id', 'role', 'can_see_cost', 'changed_at', 'created_at'],
       ARRAY[]::text[], 1)
  ) AS v(k, r, c, m, n) WHERE v.k = p_kind
$fn$;

-- the allow-listed columns of a kind that really exist, in allow-list order
CREATE OR REPLACE FUNCTION public.projexa_sync__org_cols(p_kind text)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT coalesce(array_agg(c.col ORDER BY c.n), '{}'::text[])
  FROM public.projexa_sync__org_src(p_kind) s, unnest(s.cols) WITH ORDINALITY AS c(col, n)
  WHERE EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(s.rel) AND a.attname = c.col AND NOT a.attisdropped AND a.attnum > 0)
$fn$;

-- 3. role: may read, hidden money columns, view class --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync__org_can_read(p_kind text, p_role text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT coalesce((SELECT public.ai_work_link__role_rank(p_role) >= s.min_rank FROM public.projexa_sync__org_src(p_kind) s), false)
$fn$;

-- ai_work_link__hidden_cols's rule (0624) for these kinds' money columns: below rank 3 every money column; a role the organisation lets see cost none;
-- otherwise only the project-value columns, which no organisation kind has
CREATE OR REPLACE FUNCTION public.projexa_sync__org_hidden_cols(p_kind text, p_org text, p_role text)
RETURNS text[]
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_money text[];
BEGIN
  SELECT s.money_cols INTO v_money FROM public.projexa_sync__org_src(p_kind) s;
  IF v_money IS NULL OR cardinality(v_money) = 0 THEN
    RETURN '{}'::text[];
  END IF;
  IF public.ai_work_link__role_rank(p_role) < 3 THEN
    RETURN v_money;
  END IF;
  IF public.ai_work_link__cost_visible(p_org, p_role) THEN
    RETURN '{}'::text[];
  END IF;
  RETURN ARRAY(SELECT c FROM unnest(v_money) AS c WHERE c = ANY (ARRAY['rate_project', 'qty_project', 'project_value']));
END
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_sync__org_view_class(p_org text, p_role text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT substr(md5('org|' ||
    coalesce((SELECT string_agg(k.kind || ':' || public.projexa_sync__org_can_read(k.kind, p_role)::text || ':' ||
                                coalesce((SELECT string_agg(c, ',' ORDER BY c) FROM unnest(public.projexa_sync__org_hidden_cols(k.kind, p_org, p_role)) AS c), ''), ';' ORDER BY k.kind)
              FROM unnest(public.projexa_sync__org_kinds()) AS k(kind)), '')
  ), 1, 16)
$fn$;

-- 4. the row: jsonb_build_object over the existing allow-listed columns; a hidden money column is NULL; org_people's email masked unless it is the person ($2)
CREATE OR REPLACE FUNCTION public.projexa_sync__org_row_sql(p_kind text, p_hidden text[])
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT 'jsonb_build_object(' || string_agg(
    format('%L, ', c.col) || CASE
      WHEN c.col = 'id' THEN 't.id::text'
      WHEN c.col = ANY (coalesce(p_hidden, '{}'::text[])) THEN 'NULL'
      WHEN p_kind = 'org_people' AND c.col = 'email' THEN 'CASE WHEN t.id::text = $2 THEN t.email ELSE public.ai_work_link__mask_email(t.email) END'
      WHEN c.col = 'role' THEN 't.role::text'
      ELSE format('t.%I', c.col)
    END, ', ' ORDER BY c.n) || ')'
  FROM unnest(public.projexa_sync__org_cols(p_kind)) WITH ORDINALITY AS c(col, n)
$fn$;

-- p_cands is [{id, ts}] in the order to answer; one query, scoped by the kind's scope on the organisation, each item with its version
CREATE OR REPLACE FUNCTION public.projexa_sync__org_items(p_org text, p_user text, p_kind text, p_hidden text[], p_cands jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_src record;
  v_items jsonb;
BEGIN
  SELECT s.rel, s.scope_sql INTO v_src FROM public.projexa_sync__org_src(p_kind) s;
  IF NOT FOUND OR jsonb_array_length(p_cands) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;
  EXECUTE format(
    'SELECT coalesce(jsonb_agg(jsonb_build_object(''id'', t.id::text, ''updated_at'', c.e ->> ''ts'', '
    || '''version'', coalesce((SELECT h.version FROM platform.projexa_record_head h WHERE h.org_id = $1 AND h.kind = $3 AND h.record_id = t.id::text), 0), '
    || '''data'', %1$s) ORDER BY c.n), ''[]''::jsonb) '
    || 'FROM jsonb_array_elements($4) WITH ORDINALITY AS c(e, n) JOIN %2$s t ON t.id::text = c.e ->> ''id'' WHERE %3$s',
    public.projexa_sync__org_row_sql(p_kind, p_hidden), v_src.rel, v_src.scope_sql)
    INTO v_items USING p_org, p_user, p_kind, p_cands;
  RETURN coalesce(v_items, '[]'::jsonb);
END
$fn$;

-- the person, their organisation and their role, or NULL (the caller answers {"status": ...})
CREATE OR REPLACE FUNCTION public.projexa_sync__org_who(p_sub text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_ctx jsonb;
BEGIN
  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;
  RETURN v_ctx;
END
$fn$;

-- 5. keyset pull --------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_org_pull(p_sub text, p_email text, p_kind text, p_after_ts text, p_after_id text, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_ctx jsonb;
  v_org text;
  v_role text;
  v_src record;
  v_ts text;
  v_cands jsonb;
  v_n integer;
  v_after_ts timestamptz;
  v_where text := '';
  v_hidden text[];
  v_has_more boolean := false;
  v_last jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'BAD_LIMIT' USING ERRCODE = 'AW400';
  END IF;
  v_ctx := public.projexa_sync__org_who(p_sub, p_email);
  IF v_ctx ->> 'status' IS DISTINCT FROM 'ok' THEN
    RETURN v_ctx;
  END IF;
  v_org := v_ctx ->> 'org_id';
  v_role := v_ctx ->> 'live_role';

  SELECT s.rel, s.scope_sql INTO v_src FROM public.projexa_sync__org_src(p_kind) s;
  IF NOT FOUND OR NOT public.projexa_sync__org_can_read(p_kind, v_role) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;

  v_ts := format('(coalesce(t.%1$I, t.created_at))::timestamptz', public.projexa_sync__cursor_field(v_src.rel));
  IF p_after_ts IS NOT NULL OR p_after_id IS NOT NULL THEN
    IF p_after_ts IS NULL OR p_after_id IS NULL OR p_after_ts !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
       OR p_after_id !~ '^[A-Za-z0-9._:-]{1,64}$' THEN
      RAISE EXCEPTION 'BAD_CURSOR' USING ERRCODE = 'AW400';
    END IF;
    v_after_ts := p_after_ts::timestamptz;
    v_where := format(' AND (%s, t.id::text) > ($2, $3)', v_ts);
  END IF;

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(jsonb_build_object(''id'', c.id, ''ts'', to_char(c.ts AT TIME ZONE ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')) ORDER BY c.ts, c.id), ''[]''::jsonb) '
    || 'FROM (SELECT t.id::text AS id, %1$s AS ts FROM %2$s t WHERE %3$s%4$s ORDER BY %1$s, t.id::text LIMIT %5$s) c',
    v_ts, v_src.rel, v_src.scope_sql, v_where, p_limit + 1)
    INTO v_cands USING v_org, v_after_ts, p_after_id;

  v_n := jsonb_array_length(v_cands);
  IF v_n > p_limit THEN
    v_has_more := true;
    v_cands := v_cands - p_limit;
  END IF;
  v_hidden := public.projexa_sync__org_hidden_cols(p_kind, v_org, v_role);
  v_n := jsonb_array_length(v_cands);
  v_last := CASE WHEN v_n > 0 THEN v_cands -> (v_n - 1) END;
  RETURN jsonb_build_object(
    'status', 'ok',
    'items', public.projexa_sync__org_items(v_org, v_ctx ->> 'user_id', p_kind, v_hidden, v_cands),
    'has_more', v_has_more,
    'next_ts', v_last ->> 'ts',
    'next_id', v_last ->> 'id',
    'hidden_fields', to_jsonb(v_hidden),
    'money_visible', (v_ctx ->> 'live_rank')::integer >= 3,
    'redacted', coalesce(cardinality(v_hidden), 0) > 0);
END
$fn$;

-- 6. exact rows by id ---------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_org_pull_ids(p_sub text, p_email text, p_kind text, p_ids text[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_ctx jsonb;
  v_org text;
  v_role text;
  v_src record;
  v_ts text;
  v_cands jsonb;
  v_hidden text[];
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) < 1 OR cardinality(p_ids) > 200 THEN
    RAISE EXCEPTION 'BAD_LIMIT' USING ERRCODE = 'AW400';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_ids) AS x WHERE x IS NULL OR x !~ '^[A-Za-z0-9._:-]{1,64}$') THEN
    RAISE EXCEPTION 'BAD_CURSOR' USING ERRCODE = 'AW400';
  END IF;
  v_ctx := public.projexa_sync__org_who(p_sub, p_email);
  IF v_ctx ->> 'status' IS DISTINCT FROM 'ok' THEN
    RETURN v_ctx;
  END IF;
  v_org := v_ctx ->> 'org_id';
  v_role := v_ctx ->> 'live_role';
  SELECT s.rel, s.scope_sql INTO v_src FROM public.projexa_sync__org_src(p_kind) s;
  IF NOT FOUND OR NOT public.projexa_sync__org_can_read(p_kind, v_role) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;

  v_ts := format('(coalesce(t.%1$I, t.created_at))::timestamptz', public.projexa_sync__cursor_field(v_src.rel));
  EXECUTE format(
    'SELECT coalesce(jsonb_agg(jsonb_build_object(''id'', c.id, ''ts'', to_char(c.ts AT TIME ZONE ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')) ORDER BY c.id), ''[]''::jsonb) '
    || 'FROM (SELECT t.id::text AS id, %1$s AS ts FROM %2$s t WHERE %3$s AND t.id::text = ANY($2) ORDER BY t.id::text) c',
    v_ts, v_src.rel, v_src.scope_sql)
    INTO v_cands USING v_org, p_ids;

  v_hidden := public.projexa_sync__org_hidden_cols(p_kind, v_org, v_role);
  RETURN jsonb_build_object(
    'status', 'ok',
    'items', public.projexa_sync__org_items(v_org, v_ctx ->> 'user_id', p_kind, v_hidden, v_cands),
    'has_more', false,
    'next_ts', NULL,
    'next_id', NULL,
    'hidden_fields', to_jsonb(v_hidden),
    'money_visible', (v_ctx ->> 'live_rank')::integer >= 3,
    'redacted', coalesce(cardinality(v_hidden), 0) > 0);
END
$fn$;

-- 7. id inventory (deletes) ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_org_ids(p_sub text, p_email text, p_kind text, p_after_id text DEFAULT NULL, p_limit integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_ctx jsonb;
  v_src record;
  v_ids jsonb;
  v_n integer;
  v_has_more boolean := false;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'BAD_LIMIT' USING ERRCODE = 'AW400';
  END IF;
  IF p_after_id IS NOT NULL AND p_after_id !~ '^[A-Za-z0-9._:-]{1,64}$' THEN
    RAISE EXCEPTION 'BAD_CURSOR' USING ERRCODE = 'AW400';
  END IF;
  v_ctx := public.projexa_sync__org_who(p_sub, p_email);
  IF v_ctx ->> 'status' IS DISTINCT FROM 'ok' THEN
    RETURN v_ctx;
  END IF;
  SELECT s.rel, s.scope_sql INTO v_src FROM public.projexa_sync__org_src(p_kind) s;
  IF NOT FOUND OR NOT public.projexa_sync__org_can_read(p_kind, v_ctx ->> 'live_role') THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(c.id ORDER BY c.id), ''[]''::jsonb) FROM (SELECT t.id::text AS id FROM %1$s t WHERE %2$s%3$s ORDER BY t.id::text LIMIT %4$s) c',
    v_src.rel, v_src.scope_sql, CASE WHEN p_after_id IS NULL THEN '' ELSE ' AND t.id::text > $2' END, p_limit + 1)
    INTO v_ids USING v_ctx ->> 'org_id', p_after_id;

  v_n := jsonb_array_length(v_ids);
  IF v_n > p_limit THEN
    v_has_more := true;
    v_ids := v_ids - p_limit;
    v_n := p_limit;
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'ids', v_ids, 'has_more', v_has_more, 'next_id', CASE WHEN v_n > 0 THEN v_ids ->> (v_n - 1) END);
END
$fn$;

-- 8. the organisation's change feed (project '__org__'), only the kinds the person's role may read ------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_org_changes(p_sub text, p_email text, p_after_seq bigint, p_limit integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_ctx jsonb;
  v_org text;
  v_kinds text[];
  v_head bigint;
  v_rows jsonb;
  v_n integer;
  v_has_more boolean := false;
  v_next bigint;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'BAD_LIMIT' USING ERRCODE = 'AW400';
  END IF;
  IF p_after_seq IS NOT NULL AND p_after_seq < 0 THEN
    RAISE EXCEPTION 'BAD_CURSOR' USING ERRCODE = 'AW400';
  END IF;
  v_ctx := public.projexa_sync__org_who(p_sub, p_email);
  IF v_ctx ->> 'status' IS DISTINCT FROM 'ok' THEN
    RETURN v_ctx;
  END IF;
  v_org := v_ctx ->> 'org_id';
  v_kinds := ARRAY(SELECT k FROM unnest(public.projexa_sync__org_kinds()) AS k WHERE public.projexa_sync__org_can_read(k, v_ctx ->> 'live_role'));

  SELECT coalesce(max(c.seq), 0) INTO v_head FROM platform.projexa_change_log c WHERE c.org_id = v_org AND c.project_id = '__org__';
  IF p_after_seq IS NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'changes', '[]'::jsonb, 'next_seq', v_head, 'has_more', false, 'head_seq', v_head);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('seq', x.seq, 'kind', x.kind, 'id', x.record_id, 'version', x.version, 'op', x.op::text) ORDER BY x.seq), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT c.seq, c.kind, c.record_id, c.version, c.op FROM platform.projexa_change_log c
        WHERE c.org_id = v_org AND c.project_id = '__org__' AND c.seq > p_after_seq AND c.kind = ANY (v_kinds)
        ORDER BY c.seq LIMIT p_limit + 1) x;

  v_n := jsonb_array_length(v_rows);
  IF v_n > p_limit THEN
    v_has_more := true;
    v_rows := v_rows - p_limit;
    v_n := p_limit;
  END IF;
  v_next := CASE WHEN v_n > 0 THEN (v_rows -> (v_n - 1) ->> 'seq')::bigint ELSE p_after_seq END;
  RETURN jsonb_build_object('status', 'ok', 'changes', v_rows, 'next_seq', v_next, 'has_more', v_has_more, 'head_seq', v_head);
END
$fn$;

-- 9. the manifest, additive: 0678's answer plus org_kinds and org_view_class -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_manifest(p_sub text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_ctx jsonb;
  v_projects jsonb;
  v_kinds jsonb;
  v_org_kinds jsonb;
BEGIN
  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'status', pr.status::text)
                            ORDER BY pr.is_active DESC, pr.created_at DESC, pr.id), '[]'::jsonb)
    INTO v_projects
  FROM compliance.projects pr
  WHERE pr.org_id = v_org AND public.ai_work_link__can_read_project(pr.access_level::text, pr.lead_user_id, v_user, v_ctx ->> 'live_role');

  SELECT jsonb_agg(jsonb_build_object('kind', k.kind, 'project_scoped', true, 'cursor_field', public.projexa_sync__cursor_field((SELECT s.rel FROM public.projexa_sync__src(k.kind) s)), 'deletes_supported', true) ORDER BY k.n)
    INTO v_kinds
  FROM unnest(public.projexa_sync__kinds()) WITH ORDINALITY AS k(kind, n);

  -- only the organisation kinds this person's role may read (the others answer the one 404)
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'project_scoped', false, 'cursor_field', public.projexa_sync__cursor_field((SELECT s.rel FROM public.projexa_sync__org_src(k.kind) s)),
                                               'deletes_supported', true, 'peer_shareable', k.kind <> 'org_people') ORDER BY k.n), '[]'::jsonb)
    INTO v_org_kinds
  FROM unnest(public.projexa_sync__org_kinds()) WITH ORDINALITY AS k(kind, n)
  WHERE public.projexa_sync__org_can_read(k.kind, v_ctx ->> 'live_role');

  RETURN jsonb_build_object(
    'status', 'ok',
    'user', jsonb_build_object('id', v_user, 'name', v_ctx ->> 'user_name', 'role', v_ctx ->> 'live_role', 'org_id', v_org),
    'projects', v_projects,
    'kinds', v_kinds,
    'view_class', public.projexa_sync__view_class(v_org, v_ctx ->> 'live_role'),
    'org_kinds', v_org_kinds,
    'org_view_class', public.projexa_sync__org_view_class(v_org, v_ctx ->> 'live_role'));
END
$fn$;

-- 10. the trigger function: 0683's, plus the organisation kinds under the sentinel project '__org__' ---------------------------------------------
CREATE OR REPLACE FUNCTION platform.projexa_track_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_kind text := TG_ARGV[0];
  v_row jsonb;
  v_op char(1);
  v_id text;
  v_org text;
  v_project text;
  v_hash text;
  v_prev record;
  v_ver bigint;
  v_actor text;
  v_cols text[];
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_row := to_jsonb(OLD);
      v_op := 'D';
    ELSE
      v_row := to_jsonb(NEW);
      v_op := CASE TG_OP WHEN 'INSERT' THEN 'I' ELSE 'U' END;
    END IF;
    v_id := v_row ->> 'id';
    v_org := v_row ->> 'org_id';
    v_actor := coalesce(v_row ->> 'updated_by_id', v_row ->> 'updated_by', v_row ->> 'created_by_id', v_row ->> 'requested_by_id', v_row ->> 'raised_by_id', v_row ->> 'recorded_by_id');

    IF v_kind = ANY (public.projexa_sync__org_kinds()) THEN
      -- an organisation master: the sentinel project, and the version follows the ALLOW-LISTED columns only
      v_project := '__org__';
      SELECT s.cols INTO v_cols FROM public.projexa_sync__org_src(v_kind) s;
      SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO v_row FROM jsonb_each(v_row) AS e WHERE e.key = ANY (v_cols) AND e.key <> 'updated_at';
      v_actor := NULL;
    ELSIF v_kind = 'project' THEN
      v_project := v_id;
    ELSIF v_kind = 'boq_lines' THEN
      SELECT b.project_id INTO v_project FROM compliance.construction_boqs b WHERE b.id = (v_row ->> 'boq_id') AND b.org_id = v_org;
    ELSIF v_kind = 'timesheets' THEN
      SELECT i.project_id INTO v_project FROM compliance.pms_issues i WHERE i.id = (v_row ->> 'issue_id') AND i.org_id = v_org;
    ELSIF v_kind = 'documents' THEN
      IF v_row ->> 'linked_entity_type' IS DISTINCT FROM 'project' THEN
        RETURN NULL;
      END IF;
      v_project := v_row ->> 'linked_entity_id';
    ELSIF v_kind = 'meeting_minutes' THEN
      IF v_row ->> 'context_entity_type' IS DISTINCT FROM 'project' THEN
        RETURN NULL;
      END IF;
      v_project := v_row ->> 'context_entity_id';
    ELSE
      v_project := v_row ->> 'project_id';
    END IF;

    SELECT h.version, h.content_hash, h.deleted, h.project_id INTO v_prev
    FROM platform.projexa_record_head h WHERE h.org_id = v_org AND h.kind = v_kind AND h.record_id = v_id FOR UPDATE;

    -- a child removed together with its parent (cascade): the parent is already gone, so the project is the one we recorded before
    IF v_project IS NULL AND FOUND THEN
      v_project := v_prev.project_id;
    END IF;
    IF v_org IS NULL OR v_id IS NULL OR v_project IS NULL THEN
      RETURN NULL;
    END IF;

    v_hash := encode(sha256(convert_to((v_row - 'updated_at' - 'search_vector' - 'embedding')::text, 'UTF8')), 'hex');
    IF FOUND THEN
      IF v_op <> 'D' AND NOT v_prev.deleted AND v_prev.content_hash = v_hash THEN
        RETURN NULL; -- not a real change
      END IF;
      v_ver := v_prev.version + 1;
    ELSE
      v_ver := 1;
    END IF;

    INSERT INTO platform.projexa_record_head (org_id, kind, record_id, project_id, version, content_hash, deleted, updated_at, actor_id)
    VALUES (v_org, v_kind, v_id, v_project, v_ver, v_hash, v_op = 'D', clock_timestamp(), v_actor)
    ON CONFLICT (org_id, kind, record_id)
    DO UPDATE SET project_id = EXCLUDED.project_id, version = EXCLUDED.version, content_hash = EXCLUDED.content_hash, deleted = EXCLUDED.deleted, updated_at = EXCLUDED.updated_at, actor_id = EXCLUDED.actor_id;

    INSERT INTO platform.projexa_change_log (org_id, project_id, kind, record_id, version, op, content_hash, actor_id, db_role)
    VALUES (v_org, v_project, v_kind, v_id, v_ver, v_op, v_hash, v_actor, session_user::text);
  EXCEPTION WHEN OTHERS THEN
    -- tracking is best effort by design: it must never be the reason a business write fails
    RAISE WARNING 'projexa_track_change(%): % (%)', v_kind, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION platform.projexa_track_change() FROM PUBLIC, anon, authenticated, app_runtime;

-- 11. the 9 triggers ------------------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('vendors', 'erp_suppliers'), ('customers', 'erp_customers'), ('companies', 'erp_companies'), ('boq_categories', 'construction_boq_categories'),
    ('currencies', 'erp_currencies'), ('exchange_rates', 'erp_exchange_rates'), ('departments', 'departments'), ('org_people', 'users'),
    ('cost_visibility', 'cost_visibility_config')
  ) AS v(kind, tbl)
  LOOP
    IF to_regclass('compliance.' || r.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_change ON compliance.%I', r.tbl);
      EXECUTE format('CREATE TRIGGER projexa_track_change AFTER INSERT OR UPDATE OR DELETE ON compliance.%I FOR EACH ROW EXECUTE FUNCTION platform.projexa_track_change(%L)', r.tbl, r.kind);
    END IF;
  END LOOP;
END $$;

-- 12. grants ---------------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.projexa_sync__org_kinds() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__org_src(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__org_cols(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__org_can_read(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__org_hidden_cols(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__org_view_class(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__org_row_sql(text, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__org_items(text, text, text, text[], jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__org_who(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync_org_pull(text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_org_pull_ids(text, text, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_org_ids(text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_org_changes(text, text, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_manifest(text, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_kinds() FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_src(text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_cols(text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_can_read(text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_hidden_cols(text, text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_view_class(text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_row_sql(text, text[]) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_items(text, text, text, text[], jsonb) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_who(text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_org_pull(text, text, text, text, text, integer) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_org_pull_ids(text, text, text, text[]) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_org_ids(text, text, text, text, integer) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_org_changes(text, text, bigint, integer) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_manifest(text, text) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_sync_org_pull(text, text, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_org_pull_ids(text, text, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_org_ids(text, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_org_changes(text, text, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_manifest(text, text) TO service_role;

COMMIT;
