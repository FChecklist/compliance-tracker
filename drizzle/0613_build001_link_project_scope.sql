-- PROJEXA-BUILD-001 U-18 / U-19, stage A (Phase 2): the database side of
-- project-scoped AI links and API keys. Schema only; no row is revoked,
-- deleted or rewritten by this file.
--
-- WHAT
--   platform.user_ai_links, extended in place (UNIVERSAL_AI_WORK_LINK_SPEC
--   section 10.7 / 10.11, decisions PMD-26 A-05 and OD-13):
--     + product text NOT NULL DEFAULT 'veridian'
--         CHECK user_ai_links_product_check: 'veridian' | 'projexa'
--     + project_id, token_hash (UNIQUE user_ai_links_token_hash_key),
--       authority_level (CHECK user_ai_links_authority_level_check: 0 | 1),
--       allowed_functions, hide_personal, label, expires_at (timestamptz),
--       created_by_user_id, call_count, write_count
--     token drops NOT NULL: a projexa row stores no plaintext, only its hash
--     + CHECK user_ai_links_projexa_shape: a projexa row needs project_id,
--       token_hash and expires_at and a NULL token; a veridian row is
--       unchanged (org-wide, plaintext, no expiry, as today)
--     the product-blind unique index user_ai_links_one_active_per_user
--     (org_id, user_id) WHERE status = 'active' (drizzle/0330) is replaced by
--       user_ai_links_one_live_veridian         (org_id, user_id)
--         WHERE status = 'active' AND product = 'veridian'
--       user_ai_links_one_live_per_user_project (user_id, project_id)
--         WHERE status = 'active' AND product = 'projexa'
--   compliance.api_keys (PMD-07, PMD-08):
--     + project_id text, NULLABLE: the PROJEXA proxy key is org-wide by
--       design, and the 36 existing keys have no project to backfill
--     + key_kind text NOT NULL DEFAULT 'org_service'
--         CHECK api_keys_key_kind_check: 'org_service' | 'project_ai'
--     + CHECK api_keys_project_ai_requires_project: a 'project_ai' key needs
--       a project_id
--
-- WHY
--   The link a person hands to an outside AI must be scoped to one project
--   and one person (PMD-07), and the live VERIDIAN chat link must keep
--   working untouched (PMD-26, OD-13). One table serves both products, told
--   apart by `product`. Existing rows take the column default 'veridian':
--   on 2026-09-25 that is 2 rows, both active, both minted by the VERIDIAN
--   chat picker (getOrCreateUserAiLink), one in the Demo Organization and
--   one in the PROJEXA demo org, both last used 2026-08-29. They stay
--   active; this file revokes nothing.
--
-- NOT IN THIS FILE (later items U-45/U-46): the call-log, intent,
--   functions, record_kinds and settings tables of spec section 10.7, and
--   the compliance.submissions columns. platform.rpc_resolve_ai_link_token
--   (drizzle/0584) is unchanged: it matches `token = p_token`, and a projexa
--   row has a NULL token, so a projexa row can never resolve through the
--   VERIDIAN MCP route.
--
-- SEQUENCING: the Drizzle declarations in src/lib/db/schema.ts name the new
--   columns, so a build carrying them must not serve traffic before this
--   file is applied (same rule as drizzle/0584's header).
--
-- HOW IT IS APPLIED: through the Supabase MCP (apply_migration) by the PM,
--   after the always-aborted rollback rehearsal of LIVE_FACTS section (b)
--   (its error text must begin PASS_ROLLED_BACK) and after the PGlite
--   forward/down proof src/lib/ai-links/user-ai-links-migration.pglite.test.ts
--   passes. Idempotent: every step checks for its own object first, so a
--   second run changes nothing.
--
-- DATA LOSS: none. Additive: new columns with defaults, one NOT NULL
--   relaxed, new checks that every existing row satisfies, and one unique
--   index replaced by two narrower ones that every existing row satisfies.
--
-- ROLLBACK: drizzle/down/0613_build001_link_project_scope.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- platform.user_ai_links: columns --------------------------------------------
ALTER TABLE platform.user_ai_links
  ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT 'veridian',
  ADD COLUMN IF NOT EXISTS project_id text,
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS authority_level smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allowed_functions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hide_personal boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by_user_id text,
  ADD COLUMN IF NOT EXISTS call_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS write_count integer NOT NULL DEFAULT 0;

ALTER TABLE platform.user_ai_links ALTER COLUMN token DROP NOT NULL;

-- platform.user_ai_links: constraints ----------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'platform.user_ai_links'::regclass
                   AND conname = 'user_ai_links_product_check') THEN
    ALTER TABLE platform.user_ai_links
      ADD CONSTRAINT user_ai_links_product_check
      CHECK (product IN ('veridian', 'projexa'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'platform.user_ai_links'::regclass
                   AND conname = 'user_ai_links_authority_level_check') THEN
    ALTER TABLE platform.user_ai_links
      ADD CONSTRAINT user_ai_links_authority_level_check
      CHECK (authority_level IN (0, 1));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'platform.user_ai_links'::regclass
                   AND conname = 'user_ai_links_token_hash_key') THEN
    ALTER TABLE platform.user_ai_links
      ADD CONSTRAINT user_ai_links_token_hash_key UNIQUE (token_hash);
  END IF;

  -- A-05 / OD-13: a projexa row is project-scoped, hashed, plaintext-free
  -- and expiring; a veridian row is unchanged.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'platform.user_ai_links'::regclass
                   AND conname = 'user_ai_links_projexa_shape') THEN
    ALTER TABLE platform.user_ai_links
      ADD CONSTRAINT user_ai_links_projexa_shape
      CHECK (product = 'veridian'
             OR (project_id IS NOT NULL
                 AND token_hash IS NOT NULL
                 AND token IS NULL
                 AND expires_at IS NOT NULL));
  END IF;
END $$;

-- platform.user_ai_links: one live link per product --------------------------
CREATE UNIQUE INDEX IF NOT EXISTS user_ai_links_one_live_veridian
  ON platform.user_ai_links (org_id, user_id)
  WHERE status = 'active' AND product = 'veridian';

CREATE UNIQUE INDEX IF NOT EXISTS user_ai_links_one_live_per_user_project
  ON platform.user_ai_links (user_id, project_id)
  WHERE status = 'active' AND product = 'projexa';

DROP INDEX IF EXISTS platform.user_ai_links_one_active_per_user;

-- compliance.api_keys ---------------------------------------------------------
ALTER TABLE compliance.api_keys
  ADD COLUMN IF NOT EXISTS project_id text,
  ADD COLUMN IF NOT EXISTS key_kind text NOT NULL DEFAULT 'org_service';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'compliance.api_keys'::regclass
                   AND conname = 'api_keys_key_kind_check') THEN
    ALTER TABLE compliance.api_keys
      ADD CONSTRAINT api_keys_key_kind_check
      CHECK (key_kind IN ('org_service', 'project_ai'));
  END IF;

  -- Written as "<> 'project_ai' OR ..." (not "= 'org_service' OR ...") so
  -- that api_keys_key_kind_check stays the only check naming both kinds.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'compliance.api_keys'::regclass
                   AND conname = 'api_keys_project_ai_requires_project') THEN
    ALTER TABLE compliance.api_keys
      ADD CONSTRAINT api_keys_project_ai_requires_project
      CHECK (key_kind <> 'project_ai' OR project_id IS NOT NULL);
  END IF;
END $$;

COMMIT;
