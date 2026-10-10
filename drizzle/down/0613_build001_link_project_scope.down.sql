-- Down-migration for drizzle/0613_build001_link_project_scope.sql
-- (PROJEXA-BUILD-001 U-18 / U-19 stage A). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it
-- deliberately, after the same always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the exact pre-0613 schema of platform.user_ai_links and
--   compliance.api_keys -- the 11 added user_ai_links columns and the 2 added
--   api_keys columns are dropped with their checks, the two per-product
--   unique indexes are dropped, the product-blind unique index
--   user_ai_links_one_active_per_user (org_id, user_id) WHERE status =
--   'active' (drizzle/0330) is recreated, and user_ai_links.token is NOT NULL
--   again.
--
-- DATA LOSS, read before running:
--   1. Every product = 'projexa' row of platform.user_ai_links is DELETED.
--      A projexa row has no plaintext token, so it cannot exist once token
--      is NOT NULL again: PROJEXA links minted after 0613 are lost, and the
--      AI connectors holding them stop working.
--   2. For every remaining row, the values of the dropped columns (project_id,
--      token_hash, authority_level, allowed_functions, hide_personal, label,
--      expires_at, created_by_user_id, call_count, write_count, product) are
--      lost. VERIDIAN rows keep id, org_id, user_id, token, status and their
--      timestamps, so the VERIDIAN chat link keeps resolving.
--   3. Every compliance.api_keys row with key_kind = 'project_ai' is set
--      is_active = false BEFORE its project_id column is dropped, so no
--      project-scoped key turns into an org-wide key. Those keys stop
--      working; 'org_service' keys are untouched apart from losing the two
--      columns.
--
-- WHEN IT REFUSES (raises; the transaction rolls back and nothing changes):
--   - a row that is not a projexa link has a NULL token (for example a later
--     change that clears the plaintext of revoked VERIDIAN links, spec
--     section 10.8). token NOT NULL cannot come back while such a row exists;
--     the guard below names the count. Give each such row a token or delete
--     it, then run this file again.
--   - a later migration added a table that references platform.user_ai_links(id)
--     (the U-45 call log / intent tables) and holds rows for projexa links:
--     the DELETE fails on the foreign key. Run that migration's own down
--     file first.
--
-- Safe to run twice: every step checks for its own object first.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. projexa links go (see DATA LOSS 1), then the NULL-token guard ----------
DO $$
DECLARE
  v_null_tokens bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'platform' AND table_name = 'user_ai_links'
               AND column_name = 'product') THEN
    EXECUTE 'DELETE FROM platform.user_ai_links WHERE product = ''projexa''';
  END IF;

  SELECT count(*) INTO v_null_tokens FROM platform.user_ai_links WHERE token IS NULL;
  IF v_null_tokens > 0 THEN
    RAISE EXCEPTION 'DOWN 0613 REFUSED: % platform.user_ai_links row(s) that are not projexa links have a NULL token, so token NOT NULL cannot be restored. Nothing was changed. Give each such row a token or delete it, then run this file again.', v_null_tokens;
  END IF;
END $$;

-- 2. project_ai keys are switched off before their scope column goes ---------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'compliance' AND table_name = 'api_keys'
               AND column_name = 'key_kind') THEN
    EXECUTE 'UPDATE compliance.api_keys SET is_active = false, updated_at = now() WHERE key_kind = ''project_ai'' AND is_active';
  END IF;
END $$;

-- 3. compliance.api_keys back to 13 columns -----------------------------------
ALTER TABLE compliance.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_project_ai_requires_project,
  DROP CONSTRAINT IF EXISTS api_keys_key_kind_check;

ALTER TABLE compliance.api_keys
  DROP COLUMN IF EXISTS key_kind,
  DROP COLUMN IF EXISTS project_id;

-- 4. platform.user_ai_links indexes: back to the product-blind one ------------
DROP INDEX IF EXISTS platform.user_ai_links_one_live_veridian;
DROP INDEX IF EXISTS platform.user_ai_links_one_live_per_user_project;

CREATE UNIQUE INDEX IF NOT EXISTS user_ai_links_one_active_per_user
  ON platform.user_ai_links (org_id, user_id)
  WHERE status = 'active';

-- 5. platform.user_ai_links constraints and columns --------------------------
ALTER TABLE platform.user_ai_links
  DROP CONSTRAINT IF EXISTS user_ai_links_projexa_shape,
  DROP CONSTRAINT IF EXISTS user_ai_links_token_hash_key,
  DROP CONSTRAINT IF EXISTS user_ai_links_authority_level_check,
  DROP CONSTRAINT IF EXISTS user_ai_links_product_check;

ALTER TABLE platform.user_ai_links
  DROP COLUMN IF EXISTS write_count,
  DROP COLUMN IF EXISTS call_count,
  DROP COLUMN IF EXISTS created_by_user_id,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS label,
  DROP COLUMN IF EXISTS hide_personal,
  DROP COLUMN IF EXISTS allowed_functions,
  DROP COLUMN IF EXISTS authority_level,
  DROP COLUMN IF EXISTS token_hash,
  DROP COLUMN IF EXISTS project_id,
  DROP COLUMN IF EXISTS product;

-- Step 1's guard has already refused any remaining NULL token.
ALTER TABLE platform.user_ai_links ALTER COLUMN token SET NOT NULL;

COMMIT;
