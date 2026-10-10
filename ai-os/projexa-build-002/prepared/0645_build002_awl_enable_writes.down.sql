-- Down file (and KILL SWITCH) for ai-os/projexa-build-002/prepared/0645_build002_awl_enable_writes.sql (PROJEXA-BUILD-002 WP-09b, register row AW-511).
-- Convention: docs/ROLLBACK_RUNBOOK.md section 3. It switches every write of the Universal AI Work Link OFF at once: direct actions answer 403
-- WRITES_NOT_ENABLED, confirms answer 503 and wait, function reads answer 503; drafts keep recording (a draft changes nothing); an intent that is executing
-- finishes or reads failed EXECUTION_UNCERTAIN after 10 minutes. It takes effect on the next request; there is no cache.
--
-- WHAT IT DOES NOT UNDO: records already written. They are attributed and findable:
--     select id, raw_input, created_at from compliance.submissions where via = 'ai_link' order by created_at desc;
--   Each carries its intent id in raw_input; nothing is deleted by this file.
--
-- WHEN IT REFUSES: never. Safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';

UPDATE platform.ai_work_link_settings SET writes_enabled = false, updated_at = now() WHERE id;

COMMIT;
