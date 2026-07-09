-- Wave 144: additive conversation-state-machine columns, per the joint
-- VERIDIAN.docx implementation plan (Phase 1 item 2, both independent
-- studies flagged this). No state taxonomy exists yet -- current_state/
-- previous_state are free text on purpose, nothing writes to them yet.
-- status defaults to 'active' for all existing rows.

ALTER TABLE compliance.conversations ADD COLUMN IF NOT EXISTS current_state text;
ALTER TABLE compliance.conversations ADD COLUMN IF NOT EXISTS previous_state text;
ALTER TABLE compliance.conversations ADD COLUMN IF NOT EXISTS workflow_id text;
ALTER TABLE compliance.conversations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
