-- PROJEXA-BUILD-001 U-46 step 1 (database), migration 1 of 8 (register rows BR-483 to BR-489, BR-581; spec
-- ai-os/projexa-build-001/UNIVERSAL_AI_WORK_LINK_SPEC.md sections 9.1, 10.7 and 10.9): the three small configuration tables of the
-- Universal AI Work Link. They hold facts, not per-call state, and they are read by the SQL functions of migrations 4 to 6.
--
-- WHAT
--   platform.ai_work_link_settings       one row (id = true). writes_enabled is the switch of spec section 10.9: false until spike S-1
--                                        passes, and while it is false every link has effective level 0 and every function answers
--                                        available = false. THIS FILE NEVER SETS IT TRUE; a separate, reviewed migration does, and
--                                        setting it back to false is the kill switch for every link at once. A re-run of this file
--                                        never resets a switch that was already flipped.
--   platform.ai_work_link_record_kinds   one row per Tier-1 record kind of spec section 6.2 (project, boqs, boq_lines, ...): the money
--                                        columns that are hidden below rank 3 and the filter and sort allow-list of section 6.6.
--                                        Filled by migration 8 (generated).
--   platform.ai_work_link_functions      one row per pipeline function: whether it is on links at all (link_level null = on none, with
--                                        an excluded_reason), its kind, its minimum role rank and its free-text parameters (spec
--                                        section 9.1 and 9.11). Filled by migration 8 (generated from function-registry.ts).
--
-- GRANTS: RLS on and forced with no policy on all three; revoked from everyone including app_runtime and service_role (schema
--   platform's default privileges grant app_runtime and service_role read and write on every new table, see 0618), then SELECT for
--   service_role only. Nothing is granted to anon, authenticated or PUBLIC. The tables are written only by migrations, and read by
--   the SECURITY DEFINER functions of migrations 4 to 6 (owner postgres).
--
-- TIMESTAMPS: timestamptz only (spec section 10.7, register row BR-487).
--
-- DATA LOSS: none. Additive: three tables and the one settings row (writes_enabled = false).
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the claim (ACTIVE-CLAIMS, PHASE 4 LINK ADDENDUM and the continuation
--   addendum, item 5, 2026-09-25) is on main and the always-aborted rehearsal of ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md
--   passed. Idempotent: create if not exists, and the row insert does nothing when the row exists.
--
-- ORDER: migrations 0621 to 0628 are applied in number order and rolled back in reverse order (the down files say why).
--
-- ROLLBACK: drizzle/down/0621_build001_awl_config_tables.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS platform;

-- 1. the switch --------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.ai_work_link_settings (
  id boolean NOT NULL DEFAULT true,
  writes_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_work_link_settings_pkey PRIMARY KEY (id),
  CONSTRAINT ai_work_link_settings_single_row CHECK (id)
);

INSERT INTO platform.ai_work_link_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 2. the Tier-1 record kinds ------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.ai_work_link_record_kinds (
  kind text NOT NULL,
  money_columns text[] NOT NULL,
  filters jsonb NOT NULL,
  CONSTRAINT ai_work_link_record_kinds_pkey PRIMARY KEY (kind),
  CONSTRAINT ai_work_link_record_kinds_filters_object CHECK (jsonb_typeof(filters) = 'object')
);

-- 3. the function allow-list ------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.ai_work_link_functions (
  function_id text NOT NULL,
  product text NOT NULL,
  kind text NOT NULL,
  link_level smallint,
  money_sensitive boolean NOT NULL,
  min_role_rank smallint NOT NULL,
  excluded_reason text,
  text_params text[] NOT NULL DEFAULT '{}',
  CONSTRAINT ai_work_link_functions_pkey PRIMARY KEY (function_id),
  CONSTRAINT ai_work_link_functions_kind_check CHECK (kind IN ('read', 'write')),
  CONSTRAINT ai_work_link_functions_level_check CHECK (link_level IN (0, 1, 2)),
  CONSTRAINT ai_work_link_functions_rank_check CHECK (min_role_rank BETWEEN 0 AND 6),
  -- a function is either on links (a level) or excluded (a reason), never both and never neither
  CONSTRAINT ai_work_link_functions_level_or_reason CHECK ((link_level IS NULL) = (excluded_reason IS NOT NULL))
);

-- 4. access: nobody but the owner and the SECURITY DEFINER functions -------------------------------------------------------------
ALTER TABLE platform.ai_work_link_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_work_link_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_work_link_record_kinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_work_link_record_kinds FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_work_link_functions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_work_link_functions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE platform.ai_work_link_settings FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON TABLE platform.ai_work_link_record_kinds FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON TABLE platform.ai_work_link_functions FROM PUBLIC, anon, authenticated, app_runtime, service_role;
GRANT SELECT ON TABLE platform.ai_work_link_settings TO service_role;
GRANT SELECT ON TABLE platform.ai_work_link_record_kinds TO service_role;
GRANT SELECT ON TABLE platform.ai_work_link_functions TO service_role;

COMMIT;
