-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02/03 in live Claude Code sessions: "the COMPLETE PROJEXA runs offline in the user's browser" and "a user sees their own organisation's data as per role"; additive schema/function work on project pcrjmlpuqsbocqfwoxod is within the standing owner authority for this chain (see 0683, 0684).
-- PROJEXA SYNC: ERP / HR / INTERIOR / KNOWLEDGE-BASE ORGANISATION KINDS (feat/projexa-sync-more-kinds).
--
-- WHAT
--   18 more ORGANISATION kinds beside the 9 of 0684 (27 in all; the 28 project kinds of 0683 are not touched), so these PROJEXA modules can be copied for offline use:
--     inventory        warehouses (erp_warehouses), item_groups (erp_item_groups), stock_items (erp_items), stock_entries (erp_stock_ledger_entries)
--     finance          accounts (erp_accounts), fiscal_years (erp_fiscal_years), budgets (erp_budgets, header only)
--     procurement      purchase_orders (erp_purchase_orders), goods_receipts (erp_purchase_receipts), requisitions (erp_purchase_requisitions), rfqs (erp_rfqs); headers only
--     sales            quotations (erp_quotations), sales_orders (erp_sales_orders), invoices (erp_sales_invoices); headers only
--     interior         floor_plans (interior_floor_plans), mood_boards (interior_mood_boards); headers only
--     other            knowledge_base (knowledge_base_pages: published, not archived), employees (employee_profiles, allow-listed)
--   public.projexa_sync__org_kinds()   REPLACED: the 9 of 0684 in the same order, then the 18.
--   public.projexa_sync__org_src()     REPLACED: the 9 rows of 0684 unchanged, then the 18 (relation, scope, EXPLICIT COLUMN ALLOW-LIST, money columns, minimum role rank).
--   public.projexa_sync__org_strict_money()  NEW: the kinds whose money is shown ONLY to rank >= 3 AND a role the organisation lets see cost (6 of the 18).
--   public.projexa_sync__org_hidden_cols()   REPLACED: 0684's rule unchanged for the 9 old kinds; a strict-money kind additionally hides its money columns from a role
--                                      the organisation's cost_visibility_config does not let see cost, at ANY rank.
--   the 18 tables get 0679's three statement-level tracking triggers in mode 'org' (platform.projexa_track__attach). platform.projexa_track_change() is NOT redefined here.
--   NOT touched: the pull / pull_ids / ids / changes / manifest functions of 0684 and 0686 are generic over the list and need no change.
--
-- AUTHORITY AND "NEVER MORE THAN THE ONLINE API". Online, every one of these reads is gated by requireAuthOrApiKey / requireRoleOrScope(member, read) (or a bare org check) and
-- the ERP read paths apply NO money redaction at all. Here: (1) a minimum rank of 2 (member) for every kind except budgets (3, finance), so viewer / client_viewer / external_auditor /
-- stage_0 receive none of them; (2) money columns are NULL below rank 3 (0684's rule) and, for the 6 strict kinds, also for a role without cost visibility; (3) every query is
-- scoped t.org_id = the person's organisation, one scope string used by the candidate list, the row fetch, the id inventory and the exact-ids mode; (4) a row that names a project
-- (stock_entries, purchase_orders, quotations, sales_orders, invoices, floor_plans, mood_boards) is left out while that project is PRIVATE (ai_work_link__can_read_project: only
-- 'private' restricts), so a restricted project's rows never leave through an organisation kind (stricter than the online API, which has no project check on these tables);
-- (5) never `select *`: an explicit allow-list intersected with the columns that really exist.
-- Left out ON PURPOSE: created_by / requested_by / lead ids, irn, dunning columns, journal_entry_id, employee date_of_birth, emergency-contact fields and income_tax_slab_id (the online
-- employee list returns them to a member; they are personal data a laptop does not need), the whole of payroll / payslips / salary structures / loans / leave (online gate not derivable),
-- sealed supplier quotations, recruitment, GRC, kpi_entries, CRM leads.
-- NOT SYNCED (cannot be, by this engine): line-item tables (PO / quotation / sales order / invoice / receipt / requisition / RFQ lines, budget lines, floor-plan rooms and placements,
-- mood-board items) have no org_id and no created_at, which the organisation engine's scope, cursor and tracking trigger all need. Header rows only.
-- KNOWN LIMIT: a project that BECOMES private later does not emit a tombstone for rows already copied; the next id-inventory reconcile removes them.
--
-- COST. Per kind one trigger call per tracked statement, one set-based upsert only for rows whose allow-listed columns really changed. Pages are the 0684 keyset (200 default, 500 max);
-- a laptop pays one request per page per kind, no per-row requests. erp_stock_ledger_entries is the only table that grows without bound (one row per stock movement).
-- LOCKS. SHARE ROW EXCLUSIVE on each of the 18 tables, taken together NOWAIT with a short retry, held until COMMIT; none on a re-apply. lock_timeout 5 s; one transaction.
-- DATA LOSS: none. No table altered; functions replaced with a superset answer; triggers added. Applying it twice changes nothing.
-- ORDER: after 0684 and 0686. ROLLBACK: drizzle/down/0691_projexa_sync_erp_hr_kinds.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the list ------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync__org_kinds()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT ARRAY['vendors', 'customers', 'companies', 'boq_categories', 'currencies', 'exchange_rates', 'departments', 'org_people', 'cost_visibility', 'warehouses', 'item_groups', 'stock_items', 'stock_entries', 'accounts', 'fiscal_years', 'budgets', 'purchase_orders', 'goods_receipts', 'requisitions', 'rfqs', 'quotations', 'sales_orders', 'invoices', 'floor_plans', 'mood_boards', 'knowledge_base', 'employees']::text[] $fn$;

-- 2. the sources ---------------------------------------------------------------------------------------------------------------------------------
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
       ARRAY[]::text[], 1),
    ('warehouses', 'compliance.erp_warehouses', 't.org_id = $1',
       ARRAY['id', 'warehouse_name', 'parent_warehouse_id', 'is_group', 'address', 'created_at'],
       ARRAY[]::text[], 2),
    ('item_groups', 'compliance.erp_item_groups', 't.org_id = $1',
       ARRAY['id', 'group_name', 'parent_group_id', 'created_at'],
       ARRAY[]::text[], 2),
    ('stock_items', 'compliance.erp_items', 't.org_id = $1',
       ARRAY['id', 'item_code', 'item_name', 'item_group_id', 'uom', 'is_stock_item', 'is_sales_item', 'is_purchase_item', 'standard_selling_rate', 'standard_buying_rate', 'is_active', 'has_batch_no', 'has_serial_no', 'hsn_sac_code', 'created_at', 'updated_at'],
       ARRAY['standard_selling_rate', 'standard_buying_rate'], 2),
    ('stock_entries', 'compliance.erp_stock_ledger_entries', 't.org_id = $1 AND (t.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM compliance.projects p WHERE p.id = t.project_id AND p.access_level::text = ''private''))',
       ARRAY['id', 'item_id', 'warehouse_id', 'posting_date', 'voucher_type', 'voucher_id', 'quantity_change', 'valuation_rate', 'balance_qty', 'balance_value', 'transaction_uom', 'transaction_qty', 'batch_id', 'serial_id', 'project_id', 'created_at'],
       ARRAY['valuation_rate', 'balance_value'], 2),
    ('accounts', 'compliance.erp_accounts', 't.org_id = $1',
       ARRAY['id', 'account_name', 'account_number', 'parent_account_id', 'root_type', 'account_type', 'is_group', 'currency_id', 'is_frozen', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2),
    ('fiscal_years', 'compliance.erp_fiscal_years', 't.org_id = $1',
       ARRAY['id', 'year_name', 'start_date', 'end_date', 'is_closed', 'created_at'],
       ARRAY[]::text[], 2),
    ('budgets', 'compliance.erp_budgets', 't.org_id = $1',
       ARRAY['id', 'fiscal_year_id', 'company_id', 'cost_center_id', 'name', 'action_if_exceeded', 'status', 'submitted_at', 'created_at', 'updated_at'],
       ARRAY[]::text[], 3),
    ('purchase_orders', 'compliance.erp_purchase_orders', 't.org_id = $1 AND (t.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM compliance.projects p WHERE p.id = t.project_id AND p.access_level::text = ''private''))',
       ARRAY['id', 'supplier_id', 'po_number', 'order_date', 'expected_delivery_date', 'status', 'grand_total', 'currency_id', 'exchange_rate', 'company_id', 'project_id', 'created_at', 'updated_at'],
       ARRAY['grand_total'], 2),
    ('goods_receipts', 'compliance.erp_purchase_receipts', 't.org_id = $1',
       ARRAY['id', 'supplier_id', 'purchase_order_id', 'receipt_number', 'posting_date', 'status', 'putaway_status', 'created_at'],
       ARRAY[]::text[], 2),
    ('requisitions', 'compliance.erp_purchase_requisitions', 't.org_id = $1',
       ARRAY['id', 'requisition_number', 'department_id', 'purpose', 'posting_date', 'status', 'created_at'],
       ARRAY[]::text[], 2),
    ('rfqs', 'compliance.erp_rfqs', 't.org_id = $1',
       ARRAY['id', 'rfq_number', 'requisition_id', 'posting_date', 'status', 'created_at'],
       ARRAY[]::text[], 2),
    ('quotations', 'compliance.erp_quotations', 't.org_id = $1 AND (t.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM compliance.projects p WHERE p.id = t.project_id AND p.access_level::text = ''private''))',
       ARRAY['id', 'customer_id', 'quotation_number', 'quotation_date', 'valid_till', 'status', 'grand_total', 'version', 'revision_of', 'project_id', 'currency_id', 'exchange_rate', 'company_id', 'created_at'],
       ARRAY['grand_total'], 2),
    ('sales_orders', 'compliance.erp_sales_orders', 't.org_id = $1 AND (t.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM compliance.projects p WHERE p.id = t.project_id AND p.access_level::text = ''private''))',
       ARRAY['id', 'customer_id', 'opportunity_id', 'quotation_id', 'so_number', 'order_date', 'delivery_date', 'status', 'grand_total', 'project_id', 'currency_id', 'exchange_rate', 'company_id', 'created_at', 'updated_at'],
       ARRAY['grand_total'], 2),
    ('invoices', 'compliance.erp_sales_invoices', 't.org_id = $1 AND (t.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM compliance.projects p WHERE p.id = t.project_id AND p.access_level::text = ''private''))',
       ARRAY['id', 'client_id', 'customer_id', 'invoice_number', 'posting_date', 'due_date', 'currency_id', 'subtotal', 'tax_amount', 'grand_total', 'outstanding_amount', 'status', 'sales_order_id', 'exchange_rate', 'company_id', 'project_id', 'e_invoice_status', 'created_at', 'updated_at'],
       ARRAY['subtotal', 'tax_amount', 'grand_total', 'outstanding_amount'], 2),
    ('floor_plans', 'compliance.interior_floor_plans', 't.org_id = $1 AND (t.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM compliance.projects p WHERE p.id = t.project_id AND p.access_level::text = ''private''))',
       ARRAY['id', 'project_id', 'name', 'floor_level', 'status', 'created_at'],
       ARRAY[]::text[], 2),
    ('mood_boards', 'compliance.interior_mood_boards', 't.org_id = $1 AND (t.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM compliance.projects p WHERE p.id = t.project_id AND p.access_level::text = ''private''))',
       ARRAY['id', 'project_id', 'room_or_area', 'title', 'description', 'status', 'created_at'],
       ARRAY[]::text[], 2),
    ('knowledge_base', 'compliance.knowledge_base_pages', 't.org_id = $1 AND NOT t.is_archived AND t.is_published',
       ARRAY['id', 'parent_page_id', 'slug', 'title', 'content', 'version', 'is_archived', 'is_published', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2),
    ('employees', 'compliance.employee_profiles', 't.org_id = $1',
       ARRAY['id', 'user_id', 'employee_code', 'job_title', 'employment_type', 'date_of_joining', 'employment_status', 'company_id', 'created_at', 'updated_at'],
       ARRAY[]::text[], 2)
  ) AS v(k, r, s, c, m, n) WHERE v.k = p_kind
$fn$;

-- 3. money: the strict kinds and the hidden-columns rule ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync__org_strict_money(p_kind text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT p_kind = ANY (ARRAY['stock_items', 'stock_entries', 'purchase_orders', 'quotations', 'sales_orders', 'invoices']::text[]) $fn$;

-- 0684's rule for every old kind (below rank 3 every money column; a role the organisation lets see cost none; else only project-value columns, which no organisation kind has);
-- a strict-money kind also hides its money from a role without cost visibility, whatever its rank
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
  IF public.projexa_sync__org_strict_money(p_kind) THEN
    RETURN v_money;
  END IF;
  RETURN ARRAY(SELECT c FROM unnest(v_money) AS c WHERE c = ANY (ARRAY['rate_project', 'qty_project', 'project_value']));
END
$fn$;

-- 4. tracking triggers of 0679 in mode 'org' for the 18 tables (a missing table is skipped by the attacher) --------------------------------------
DO $$
DECLARE
  v_specs jsonb := '[
    {"k": "warehouses", "t": "erp_warehouses", "m": "org"},
    {"k": "item_groups", "t": "erp_item_groups", "m": "org"},
    {"k": "stock_items", "t": "erp_items", "m": "org"},
    {"k": "stock_entries", "t": "erp_stock_ledger_entries", "m": "org"},
    {"k": "accounts", "t": "erp_accounts", "m": "org"},
    {"k": "fiscal_years", "t": "erp_fiscal_years", "m": "org"},
    {"k": "budgets", "t": "erp_budgets", "m": "org"},
    {"k": "purchase_orders", "t": "erp_purchase_orders", "m": "org"},
    {"k": "goods_receipts", "t": "erp_purchase_receipts", "m": "org"},
    {"k": "requisitions", "t": "erp_purchase_requisitions", "m": "org"},
    {"k": "rfqs", "t": "erp_rfqs", "m": "org"},
    {"k": "quotations", "t": "erp_quotations", "m": "org"},
    {"k": "sales_orders", "t": "erp_sales_orders", "m": "org"},
    {"k": "invoices", "t": "erp_sales_invoices", "m": "org"},
    {"k": "floor_plans", "t": "interior_floor_plans", "m": "org"},
    {"k": "mood_boards", "t": "interior_mood_boards", "m": "org"},
    {"k": "knowledge_base", "t": "knowledge_base_pages", "m": "org"},
    {"k": "employees", "t": "employee_profiles", "m": "org"}
  ]'::jsonb;
BEGIN
  PERFORM platform.projexa_track__attach(v_specs);
  -- self-check (sql:SQL-08): a second pass must find nothing left to do
  IF platform.projexa_track__attach(v_specs) <> 0 THEN
    RAISE EXCEPTION 'projexa tracking self-check failed: triggers are not as specified';
  END IF;
END $$;

-- 5. grants --------------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.projexa_sync__org_strict_money(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__org_kinds() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__org_src(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__org_hidden_cols(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_strict_money(text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_kinds() FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_src(text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__org_hidden_cols(text, text, text) FROM app_runtime';
  END IF;
END $$;

COMMIT;
