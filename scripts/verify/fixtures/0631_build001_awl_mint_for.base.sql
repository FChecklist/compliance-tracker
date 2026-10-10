-- Base snapshot for the PGlite rollback replay (BR-207). Generated 2026-09-25T17:56:30Z by:
--   node scripts/verify/gen-base-snapshot.mjs --tables platform.user_ai_links --function compliance.current_org_id
-- Schema only, read from the live catalog (pcrjmlpuqsbocqfwoxod). Regenerate with the same command; do not edit by hand
-- except to add an object the generator leaves out (see the generator's header).
SET check_function_bodies = off;
CREATE SCHEMA IF NOT EXISTS compliance;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE OR REPLACE FUNCTION compliance.current_org_id()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'compliance', 'pg_temp'
AS $function$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')
$function$;
CREATE TABLE platform.user_ai_links (
  id text NOT NULL,
  org_id text NOT NULL,
  user_id text NOT NULL,
  token text,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  product text DEFAULT 'veridian'::text NOT NULL,
  project_id text,
  token_hash text,
  authority_level smallint DEFAULT 0 NOT NULL,
  allowed_functions text[] DEFAULT '{}'::text[] NOT NULL,
  hide_personal boolean DEFAULT true NOT NULL,
  label text,
  expires_at timestamp with time zone,
  created_by_user_id text,
  call_count integer DEFAULT 0 NOT NULL,
  write_count integer DEFAULT 0 NOT NULL
);
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_pkey PRIMARY KEY (id);
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_token_hash_key UNIQUE (token_hash);
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_token_key UNIQUE (token);
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_authority_level_check CHECK ((authority_level = ANY (ARRAY[0, 1])));
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_product_check CHECK ((product = ANY (ARRAY['veridian'::text, 'projexa'::text])));
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_projexa_shape CHECK (((product = 'veridian'::text) OR ((project_id IS NOT NULL) AND (token_hash IS NOT NULL) AND (token IS NULL) AND (expires_at IS NOT NULL))));
CREATE UNIQUE INDEX user_ai_links_one_live_per_user_project ON platform.user_ai_links USING btree (user_id, project_id) WHERE ((status = 'active'::text) AND (product = 'projexa'::text));
CREATE UNIQUE INDEX user_ai_links_one_live_veridian ON platform.user_ai_links USING btree (org_id, user_id) WHERE ((status = 'active'::text) AND (product = 'veridian'::text));
CREATE INDEX user_ai_links_token_idx ON platform.user_ai_links USING btree (token) WHERE (status = 'active'::text);
ALTER TABLE platform.user_ai_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_org_scoped ON platform.user_ai_links AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id())) WITH CHECK ((org_id = compliance.current_org_id()));
GRANT DELETE ON TABLE platform.user_ai_links TO app_runtime;
GRANT INSERT ON TABLE platform.user_ai_links TO app_runtime;
GRANT SELECT ON TABLE platform.user_ai_links TO app_runtime;
GRANT UPDATE ON TABLE platform.user_ai_links TO app_runtime;
GRANT DELETE ON TABLE platform.user_ai_links TO service_role;
GRANT INSERT ON TABLE platform.user_ai_links TO service_role;
GRANT SELECT ON TABLE platform.user_ai_links TO service_role;
GRANT UPDATE ON TABLE platform.user_ai_links TO service_role;
RESET check_function_bodies;
