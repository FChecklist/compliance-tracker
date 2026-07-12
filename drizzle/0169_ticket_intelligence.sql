-- Priority 2 item 4 follow-up (D21.B1.S1 tree note: "2 confirmed gaps --
-- voice/transcription, tickets -- left as real, honestly-disclosed future
-- work", ai-os/tree4-unified/50-completion-plan/archive/07-priority2-tracker.yaml).
-- Closes the "tickets" half of that note (voice/transcription is a
-- separate, owner-blocked piece -- needs a new external speech-to-text
-- provider decision, not attempted here).
--
-- Mirrors drizzle/0148_priority2_email_intelligence_comms_drafting.sql's
-- email_intelligence_items/email_intelligence_action_items tables
-- field-for-field. Written by a subagent, NOT applied to the live
-- database -- per this repo's established discipline, migrations are
-- reviewed and applied by the Super Boss.

CREATE TABLE IF NOT EXISTS compliance.ticket_intelligence_items (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  ticket_id text NOT NULL REFERENCES compliance.tickets(id),
  requested_by_id text NOT NULL,
  status text NOT NULL DEFAULT 'analyzing',
  ai_summary text,
  ai_suggested_work_items jsonb NOT NULL DEFAULT '[]',
  ai_generated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_intelligence_items_org_id_idx ON compliance.ticket_intelligence_items(org_id);
CREATE INDEX IF NOT EXISTS ticket_intelligence_items_ticket_id_idx ON compliance.ticket_intelligence_items(ticket_id);

CREATE TABLE IF NOT EXISTS compliance.ticket_intelligence_action_items (
  id text PRIMARY KEY,
  ticket_intelligence_item_id text NOT NULL REFERENCES compliance.ticket_intelligence_items(id),
  suggested_index integer NOT NULL,
  task_id text NOT NULL REFERENCES compliance.tasks(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_intelligence_action_items_item_id_idx ON compliance.ticket_intelligence_action_items(ticket_intelligence_item_id);

-- New prompt template (Prompt OS, prompt-os-resolver.ts) -- mirrors
-- 0148's exact seeding pattern for 'email_intelligence.detect'.
INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('ticket_intelligence.detect', 'Ticket Intelligence: Detection Prompt', 'Detects commitments/follow-ups/approvals-needed/deadlines from a support ticket''s conversation and proposes Work Object candidates (ticket-intelligence-service.ts)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You analyze a support ticket for a compliance management platform and detect actionable work. Given the ticket's subject, category, priority, and its full conversation transcript, respond with ONLY JSON matching: { "summary": string, "suggestedWorkItems": [{ "title": string, "category": "commitment" | "follow_up" | "approval_needed" | "deadline", "assignee": string | null, "dueDateHint": string | null }] }. "summary" is 1-3 sentences describing what the ticket is about and its current state. "suggestedWorkItems" are concrete commitments, required follow-ups, approvals someone is waiting on, or deadlines mentioned anywhere in the conversation (empty array if none) -- "assignee" is a name clearly responsible if mentioned, else null; "dueDateHint" is a plain-language deadline if any, else null. These are suggestions for a human to review and explicitly promote, never assume they will be auto-created as tasks.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'ticket_intelligence.detect'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
