-- Priority 2 item 4: D21.B4.S1 (Intelligent Work Detection, inbound email)
-- + D10 GAP-06 (Communication Governance draft-then-approve flow).
-- tree4-unified/10-merged-governance-layer.yaml U-D21.B4.S1 + U-D10.B2/B3.
-- Written by a subagent, NOT applied to the live database -- per this
-- repo's established discipline (compliance-tracker_dependency_cleanup /
-- prior waves), migrations are reviewed and applied by the Super Boss.

-- D21.B4.S1: mirrors veri_meetings' AI-columns + veri_meeting_action_items
-- join-table pattern exactly. No persistent "email" entity exists in this
-- codebase yet, so this table holds both the submitted email content and
-- the AI's suggestions on one row.
CREATE TABLE IF NOT EXISTS compliance.email_intelligence_items (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  submitted_by_id text NOT NULL,
  subject text NOT NULL,
  sender_email text,
  body text NOT NULL,
  received_at timestamp,
  status text NOT NULL DEFAULT 'analyzing',
  ai_summary text,
  ai_suggested_work_items jsonb NOT NULL DEFAULT '[]',
  ai_generated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_intelligence_items_org_id_idx ON compliance.email_intelligence_items(org_id);

CREATE TABLE IF NOT EXISTS compliance.email_intelligence_action_items (
  id text PRIMARY KEY,
  email_intelligence_item_id text NOT NULL REFERENCES compliance.email_intelligence_items(id),
  suggested_index integer NOT NULL,
  task_id text NOT NULL REFERENCES compliance.tasks(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_intelligence_action_items_item_id_idx ON compliance.email_intelligence_action_items(email_intelligence_item_id);

-- D10 GAP-06: draft-then-approve communications. Never sent without an
-- explicit approval unless a persistent always_approve approval_preferences
-- row exists for this exact communication_type scope.
CREATE TABLE IF NOT EXISTS compliance.drafted_communications (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  user_id text NOT NULL,
  communication_type text NOT NULL,
  trigger_type text NOT NULL,
  trigger_ref_type text,
  trigger_ref_id text,
  recipient_emails jsonb NOT NULL DEFAULT '[]',
  subject text NOT NULL,
  body text NOT NULL,
  attachments_recommendation jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending_approval',
  auto_approved_via_preference boolean NOT NULL DEFAULT false,
  approved_by_id text,
  approved_at timestamp,
  rejected_by_id text,
  rejected_at timestamp,
  rejection_reason text,
  sent_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drafted_communications_org_id_idx ON compliance.drafted_communications(org_id);
CREATE INDEX IF NOT EXISTS drafted_communications_status_idx ON compliance.drafted_communications(status);

-- New prompt templates (Prompt OS, prompt-os-resolver.ts) -- mirrors
-- 0064_wave74_meeting_intelligence.sql's exact seeding pattern.
INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('email_intelligence.detect', 'Email Intelligence: Detection Prompt', 'Detects commitments/follow-ups/approvals-needed/deadlines from an inbound email and proposes Work Object candidates (email-intelligence-service.ts)'),
  ('communication_drafting.draft', 'Communication Drafting: Draft Prompt', 'Drafts an outbound communication (subject/body/attachment recommendation) for a given communication type and trigger, held for approval before send (communication-drafting-service.ts)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You analyze an inbound email for a compliance management platform and detect actionable work. Given the email's subject, sender, and body, respond with ONLY JSON matching: { "summary": string, "suggestedWorkItems": [{ "title": string, "category": "commitment" | "follow_up" | "approval_needed" | "deadline", "assignee": string | null, "dueDateHint": string | null }] }. "summary" is 1-3 sentences describing what the email is about. "suggestedWorkItems" are concrete commitments, required follow-ups, approvals the sender is waiting on, or deadlines mentioned in the email (empty array if none) -- "assignee" is a name clearly responsible if mentioned, else null; "dueDateHint" is a plain-language deadline if any, else null. These are suggestions for a human to review and explicitly promote, never assume they will be auto-created as tasks.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'email_intelligence.detect'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You draft an outbound business communication for a compliance management platform. Given the communication type, the trigger context, and the recipient(s), respond with ONLY JSON matching: { "subject": string, "body": string, "attachmentsRecommendation": string[] }. "subject" is a short, professional email subject line. "body" is the full email body text (plain text, no markdown/HTML -- the caller wraps it in the platform's own email template), professional in tone, addressing the stated context directly, never inventing facts not present in the provided context. "attachmentsRecommendation" is a list of plain-language descriptions of documents that would typically accompany this communication type (empty array if none are typically needed) -- these are recommendations only, never actual generated files. This draft is held for human approval before it is ever sent -- do not claim it has already been sent anywhere in the body text.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'communication_drafting.draft'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
