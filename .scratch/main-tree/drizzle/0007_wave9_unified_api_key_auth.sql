-- Wave 9: unified external credential.
--
-- audit_logs.user_id becomes nullable and gains a sibling api_key_id column,
-- because an API-key-driven write (via the new requireAuthOrApiKey() /
-- validateApiKey() auth path) has no acting human user -- logActivity()
-- now writes exactly one of user_id/api_key_id per row, never both, never
-- neither. actor_name/actor_role remain NOT NULL and are always populated
-- (either the real user's denormalized snapshot, or "API Key: <name>" /
-- 'api_key' for the key-driven case), so every existing reader that only
-- needs actor_name/actor_role is unaffected.

ALTER TABLE compliance.audit_logs ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE compliance.audit_logs
  ADD COLUMN IF NOT EXISTS api_key_id text REFERENCES compliance.api_keys(id);
