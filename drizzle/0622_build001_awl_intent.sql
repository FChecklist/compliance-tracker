-- PROJEXA-BUILD-001 U-46 step 1 (database), migration 2 of 8 (register rows BR-486, BR-487; spec sections 9.2, 9.3 and 10.7): the
-- intent table of the Universal AI Work Link. One row per write or draft that an AI proposes through a link.
--
-- WHAT
--   platform.ai_work_link_intent
--     kind    'action' (the link's effective level allows a direct write) or 'draft' (nothing changes until the person confirms).
--     status  recorded | awaiting_confirmation | confirmed | executing | done | failed | refused | expired.
--     A row carries the function, its params, the idempotency key, the confirm token's sha256 (drafts only, never the token), the
--     expiry, and the outcome (submission_id, result, failure) written by the executor of the later phase.
--   platform.ai_work_link_intent_idem_live
--     UNIQUE (link_id, idempotency_key) WHERE status IN ('recorded','executing','done','awaiting_confirmation','confirmed').
--     A key is held only while its intent is live or done. A failed, refused or expired intent frees its key, so a corrected retry
--     with the same parameters can run (spec section 9.3, audit A-10, register row BR-486).
--
-- FOREIGN KEY: link_id references platform.user_ai_links(id). No ON DELETE action: a link is revoked, never deleted.
--
-- GRANTS: RLS on and forced with no policy, and revoked from everyone including app_runtime and service_role (0618 explains the
--   default privileges). The table is reached only through the SECURITY DEFINER functions of migration 6. Nothing is granted to
--   anon, authenticated or PUBLIC.
--
-- TIMESTAMPS: timestamptz only (register row BR-487).
--
-- DATA LOSS: none. Additive: one table, its constraints and three indexes.
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the claim (ACTIVE-CLAIMS, 2026-09-25) is on main and the
--   always-aborted rehearsal passed. Idempotent: create if not exists.
--
-- ROLLBACK: drizzle/down/0622_build001_awl_intent.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS platform.ai_work_link_intent (
  id text NOT NULL,
  link_id text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  user_id text NOT NULL,
  function_id text NOT NULL,
  params jsonb NOT NULL,
  kind text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL,
  confirm_token_hash text,
  expires_at timestamptz NOT NULL,
  submission_id text,
  result jsonb,
  failure jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  confirmed_by text,
  executed_at timestamptz,
  CONSTRAINT ai_work_link_intent_pkey PRIMARY KEY (id),
  CONSTRAINT ai_work_link_intent_link_fk FOREIGN KEY (link_id) REFERENCES platform.user_ai_links (id),
  CONSTRAINT ai_work_link_intent_kind_check CHECK (kind IN ('action', 'draft')),
  CONSTRAINT ai_work_link_intent_status_check CHECK (status IN ('recorded', 'awaiting_confirmation', 'confirmed', 'executing', 'done', 'failed', 'refused', 'expired')),
  CONSTRAINT ai_work_link_intent_key_length CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  -- only a draft has a confirm token
  CONSTRAINT ai_work_link_intent_confirm_only_draft CHECK (kind = 'draft' OR confirm_token_hash IS NULL)
);

-- A-10: a key is held only while its intent is live or done; failed, refused and expired intents free it.
CREATE UNIQUE INDEX IF NOT EXISTS ai_work_link_intent_idem_live
  ON platform.ai_work_link_intent (link_id, idempotency_key)
  WHERE status IN ('recorded', 'executing', 'done', 'awaiting_confirmation', 'confirmed');

-- write caps (30 per hour, 200 per day) and the history list are counted from these rows
CREATE INDEX IF NOT EXISTS ai_work_link_intent_link_created_idx
  ON platform.ai_work_link_intent (link_id, created_at DESC);

-- the executor and the expiry sweep look for open intents
CREATE INDEX IF NOT EXISTS ai_work_link_intent_open_idx
  ON platform.ai_work_link_intent (status, expires_at)
  WHERE status IN ('recorded', 'awaiting_confirmation', 'confirmed');

ALTER TABLE platform.ai_work_link_intent ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_work_link_intent FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.ai_work_link_intent FROM PUBLIC, anon, authenticated, app_runtime, service_role;

COMMIT;
