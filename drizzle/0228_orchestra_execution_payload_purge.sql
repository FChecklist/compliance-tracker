-- VERIDIAN Review Framework gap-closure (2026-07-18), "Audit Trail" finding
-- (VERIDIAN_AI_CONSTITUTION.md #19 / SEC-03): full prompt/response text is
-- already stored in orchestra_executions.input/output at most real call
-- sites (Wave 144/146) -- what was missing was any expiry on that stored
-- text. payload_purged_at is null while the full payload is still live;
-- orchestra-log-purge (new internal cron, src/lib/orchestra-execution-
-- logger.ts::purgeExpiredOrchestraPayloads) sets it and nulls out
-- input/output once a row crosses the retention window, while leaving
-- every other column (status/model/tokens/cost/duration) permanent -- the
-- audit trail survives purge, only the raw text expires.
ALTER TABLE compliance.orchestra_executions ADD COLUMN IF NOT EXISTS payload_purged_at timestamp;

CREATE INDEX IF NOT EXISTS orchestra_executions_purge_candidate_idx
  ON compliance.orchestra_executions (created_at) WHERE payload_purged_at IS NULL;
