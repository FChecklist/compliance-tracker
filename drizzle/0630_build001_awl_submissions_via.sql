-- PROJEXA-BUILD-002 WP-09a (register row AW-502; spec section 9.7 C-1; write-path gap report items G1 and G8): the two provenance columns of
-- compliance.submissions, so that a submission that came through an AI work link can be listed and counted. COLUMNS ONLY: no backfill, no
-- index, no policy change, no trigger, no function.
--
-- WHAT
--   compliance.submissions.via         text NULL    NULL for every session and app submission; 'ai_link' for one that came through an AI
--                                                   work link. CHECK submissions_via_check: via IS NULL OR via = 'ai_link'.
--   compliance.submissions.ai_link_id  text NULL    the link (platform.user_ai_links.id) that a link submission came through. A text id in
--                                                   another schema, so no foreign key (the intent table's own link_id has one; this table
--                                                   is written by the pipeline as app_runtime, which cannot read the link table).
--   Both columns are NULL on every row that exists today and stay NULL: history is not invented (the same posture as drizzle/0525 and
--   0571). The pipeline writes them from BUILD-002 WP-09a on (src/lib/pipeline/run-submission.ts); src/lib/db/schema.ts declares them.
--
-- ORDER OF DEPLOY: apply this file BEFORE the code that declares the columns reaches a database. drizzle lists every column of a table in
--   an INSERT, so once schema.ts names via and ai_link_id, every insert into compliance.submissions names them, and a database without
--   the columns refuses it. One Supabase project serves every environment (CLAUDE.md), so apply, then merge.
--
-- GRANTS AND RLS: unchanged. The table keeps its policies and its table grants; a new column inherits the table's privileges.
--
-- DATA LOSS: none. Additive: two nullable columns and one check that no existing row can violate (both columns are new, so every row is NULL).
--
-- IF EXISTS: the table is always there on the live database. The guard exists so that the replay of a LATER link migration (0631), whose base
--   snapshot does not hold compliance.submissions, can still compose this file before it (scripts/verify/awl-rollback.mjs composeBases).
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal passed. NOT applied by the engineer who wrote
--   it. Idempotent: add column if not exists, and the check is added only when it is not there.
--
-- ROLLBACK: drizzle/down/0630_build001_awl_submissions_via.down.sql (drops the two columns and the check; the values written since are lost)

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE IF EXISTS compliance.submissions ADD COLUMN IF NOT EXISTS via text;
ALTER TABLE IF EXISTS compliance.submissions ADD COLUMN IF NOT EXISTS ai_link_id text;

DO $do$
BEGIN
  IF to_regclass('compliance.submissions') IS NOT NULL THEN
    -- dynamic, so the cast is not resolved when the table is absent (a plpgsql AND does not short-circuit)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('compliance.submissions') AND conname = 'submissions_via_check') THEN
      EXECUTE 'ALTER TABLE compliance.submissions ADD CONSTRAINT submissions_via_check CHECK (via IS NULL OR via = ''ai_link'')';
    END IF;
  END IF;
END
$do$;

COMMIT;
