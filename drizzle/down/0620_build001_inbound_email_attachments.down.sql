-- Down-migration for drizzle/0620_build001_inbound_email_attachments.sql (PROJEXA-BUILD-001 U-31). Convention:
-- docs/ROLLBACK_RUNBOOK.md section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same
-- always-aborted rehearsal as the forward file (section 4a).
--
-- WHAT IT RESTORES: the database as it was before 0620. The table compliance.inbound_email_attachments is dropped, and with
--   it its constraints, its index, its two policies and its grants. compliance.inbound_email_messages is not touched (0620
--   did not change it; the foreign key that pointed at it goes with the dropped table).
--
-- DATA LOSS, read before running: every stored attachment is lost, file bytes included. Copy them out first if they are
--   wanted (select id, org_id, inbound_message_id, file_name, content_type, size_bytes, resend_attachment_id, created_at,
--   content from compliance.inbound_email_attachments). The email messages themselves stay. Roll the webhook code back
--   first (runbook section 4, rule 3): with the table gone, the attachment step of POST /api/webhooks/resend-inbound fails,
--   records the failure in the message's processing_error and still keeps the message.
--
-- WHEN IT REFUSES: it does not.
--
-- Safe to run twice: DROP TABLE IF EXISTS.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS compliance.inbound_email_attachments;

COMMIT;
