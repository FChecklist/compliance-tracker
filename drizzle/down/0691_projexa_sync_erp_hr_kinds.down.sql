-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "complete the PROJEXA local-first system ... the whole database of that user and their organisation (as per role) live on the laptop"; this is the rollback of 0691, run deliberately by the PM.
-- Down-migration for drizzle/0691_projexa_sync_erp_hr_kinds.sql. Run deliberately by the PM, not by any script. Roll back strictly in reverse (this file before 0690 .. 0686 / 0684).
-- Inside: the 18 tables' tracking triggers go FIRST, then the list, sources and hidden-columns rule are put back to 0684's definitions (9 kinds), then the strict-money helper is dropped.
-- DATA LOSS: version heads / change-log rows already written for the 18 kinds stay (harmless: the list no longer has them and the org feed filters them out); no business table is touched.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_warehouses', 'erp_item_groups', 'erp_items', 'erp_stock_ledger_entries', 'erp_accounts', 'erp_fiscal_years', 'erp_budgets', 'erp_purchase_orders', 'erp_purchase_receipts', 'erp_purchase_requisitions', 'erp_rfqs', 'erp_quotations', 'erp_sales_orders', 'erp_sales_invoices', 'interior_floor_plans', 'interior_mood_boards', 'knowledge_base_pages', 'employee_profiles']::text[] LOOP
    IF to_regclass('compliance.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_i ON compliance.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_u ON compliance.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_d ON compliance.%I', t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.projexa_sync__org_kinds()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT ARRAY['vendors', 'customers', 'companies', 'boq_categories', 'currencies', 'exchange_rates', 'departments', 'org_people', 'cost_visibility']::text[] $fn$;

CREATE OR REPLACE FUNCTION public.projexa_sync__org_src(p_kind text)
RETURNS TABLE (rel text, scope_sql text, cols text[], money_cols text[], min_rank integer)
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.r, v.s, v.c, v.m, v.n FROM (VALUES
    ('vendors', 'compliance.erp_suppliers', 't.org_id = $1',
       ARRAY['id', 'supplier_name', 'supplier_type', 'trade', 'project_id', 'default_payment_terms_days', 'credit_limit', 'qualification_status', 'is_active', 'created_at', 'updated_at'],
       ARRAY['credit_limit'], 2),
    ('customers', 'compliance.erp_customers', 't.org_id = $1',
       ARRAY['id', 'customer_name', 'client_id', 'default_payment_terms_days', 'credit_limit', 'is_active', 'created_at', 'updated_at'],
       ARRAY['credit_limit'], 2),
    ('companies', 'compliance.erp_companies', 't.org_id = $1',
       ARRAY['id', 'company_name', 'abbr', 'parent_company_id', 'is_group', 'default_currency_id', 'country', 'date_of_incorporation', 'is_active', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2),
    ('boq_categories', 'compliance.construction_boq_categories', 't.org_id = $1',
       ARRAY['id', 'name', 'sort_order', 'is_active', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2),
    ('currencies', 'compliance.erp_currencies', 't.org_id = $1',
       ARRAY['id', 'code', 'name', 'symbol', 'is_base_currency', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2),
    ('exchange_rates', 'compliance.erp_exchange_rates', 't.org_id = $1',
       ARRAY['id', 'from_currency_id', 'to_currency_id', 'rate', 'rate_date', 'source', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2),
    ('departments', 'compliance.departments', 't.org_id = $1',
       ARRAY['id', 'name', 'description', 'head_id', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2),
    ('org_people', 'compliance.users', 't.org_id = $1',
       ARRAY['id', 'name', 'role', 'is_active', 'email'],
       ARRAY[]::text[], 2),
    ('cost_visibility', 'compliance.cost_visibility_config', 't.org_id = $1',
       ARRAY['id', 'role', 'can_see_cost', 'changed_at', 'created_at'],
       ARRAY[]::text[], 1)
  ) AS v(k, r, s, c, m, n) WHERE v.k = p_kind
$fn$;

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

DROP FUNCTION IF EXISTS public.projexa_sync__org_strict_money(text);

COMMIT;
