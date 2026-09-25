-- Base snapshot for the PGlite rollback replay (BR-207). Generated 2026-09-25T10:57:02Z by:
--   node scripts/verify/gen-base-snapshot.mjs --tables compliance.erp_currencies,compliance.erp_exchange_rates --function compliance.current_org_id
-- Schema only, read from the live catalog (pcrjmlpuqsbocqfwoxod). Regenerate with the same command; do not edit by hand
-- except to add an object the generator leaves out (see the generator's header).
-- left out: foreign key erp_currencies_org_id_fkey on compliance.erp_currencies references compliance.organisations, not in the snapshot
-- left out: foreign key erp_exchange_rates_org_id_fkey on compliance.erp_exchange_rates references compliance.organisations, not in the snapshot
SET check_function_bodies = off;
CREATE SCHEMA IF NOT EXISTS compliance;
CREATE OR REPLACE FUNCTION compliance.current_org_id()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'compliance', 'pg_temp'
AS $function$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')
$function$;
CREATE TABLE compliance.erp_currencies (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  symbol text,
  is_base_currency boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.erp_exchange_rates (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  from_currency_id text NOT NULL,
  to_currency_id text NOT NULL,
  rate numeric NOT NULL,
  rate_date date NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  source text DEFAULT 'manual'::text NOT NULL
);
ALTER TABLE compliance.erp_currencies ADD CONSTRAINT erp_currencies_pkey PRIMARY KEY (id);
ALTER TABLE compliance.erp_exchange_rates ADD CONSTRAINT erp_exchange_rates_pkey PRIMARY KEY (id);
ALTER TABLE compliance.erp_currencies ADD CONSTRAINT erp_currencies_org_id_code_key UNIQUE (org_id, code);
ALTER TABLE compliance.erp_exchange_rates ADD CONSTRAINT erp_exchange_rates_from_currency_id_fkey FOREIGN KEY (from_currency_id) REFERENCES compliance.erp_currencies(id);
ALTER TABLE compliance.erp_exchange_rates ADD CONSTRAINT erp_exchange_rates_to_currency_id_fkey FOREIGN KEY (to_currency_id) REFERENCES compliance.erp_currencies(id);
CREATE UNIQUE INDEX erp_currencies_one_base_per_org ON compliance.erp_currencies USING btree (org_id) WHERE is_base_currency;
CREATE INDEX idx_erp_currencies_org_id ON compliance.erp_currencies USING btree (org_id);
CREATE INDEX idx_erp_exchange_rates_from_currency_id ON compliance.erp_exchange_rates USING btree (from_currency_id);
CREATE INDEX idx_erp_exchange_rates_org_id ON compliance.erp_exchange_rates USING btree (org_id);
CREATE INDEX idx_erp_exchange_rates_to_currency_id ON compliance.erp_exchange_rates USING btree (to_currency_id);
ALTER TABLE compliance.erp_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_currencies FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_exchange_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_org_scoped ON compliance.erp_currencies AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_erp_currencies ON compliance.erp_currencies AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_org_scoped ON compliance.erp_exchange_rates AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_erp_exchange_rates ON compliance.erp_exchange_rates AS PERMISSIVE FOR ALL TO service_role USING (true);
GRANT DELETE ON TABLE compliance.erp_currencies TO app_runtime;
GRANT INSERT ON TABLE compliance.erp_currencies TO app_runtime;
GRANT SELECT ON TABLE compliance.erp_currencies TO app_runtime;
GRANT UPDATE ON TABLE compliance.erp_currencies TO app_runtime;
GRANT DELETE ON TABLE compliance.erp_currencies TO service_role;
GRANT INSERT ON TABLE compliance.erp_currencies TO service_role;
GRANT SELECT ON TABLE compliance.erp_currencies TO service_role;
GRANT UPDATE ON TABLE compliance.erp_currencies TO service_role;
GRANT DELETE ON TABLE compliance.erp_exchange_rates TO app_runtime;
GRANT INSERT ON TABLE compliance.erp_exchange_rates TO app_runtime;
GRANT SELECT ON TABLE compliance.erp_exchange_rates TO app_runtime;
GRANT UPDATE ON TABLE compliance.erp_exchange_rates TO app_runtime;
GRANT DELETE ON TABLE compliance.erp_exchange_rates TO service_role;
GRANT INSERT ON TABLE compliance.erp_exchange_rates TO service_role;
GRANT SELECT ON TABLE compliance.erp_exchange_rates TO service_role;
GRANT UPDATE ON TABLE compliance.erp_exchange_rates TO service_role;
RESET check_function_bodies;
