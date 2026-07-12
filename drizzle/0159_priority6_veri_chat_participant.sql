-- Priority 6 item 3 (VERI_CHAT_GOVERNANCE.md sections 2/3, "VERI-as-
-- participant in multi-party VERI Chat"): the narrow additive slice this
-- wave actually builds -- VERI can be invited as a read/summarize/
-- recommend-only participant on an existing `type: 'group'` conversation,
-- answering only when explicitly addressed (@veri / "ask veri" in
-- chat-service.ts's detectVeriMention()), never proactively. The 1:1 VERI
-- AI thread (isAiThread) is completely untouched by this migration.
--
-- Additive only: one nullable-safe boolean column (defaults false, so
-- every existing conversation row is unaffected) plus one new prompt
-- template. No RLS changes -- compliance.messages/compliance.conversations'
-- existing app_runtime_participant_only policies (0010_wave12_...sql)
-- already gate on is_conversation_participant(conversation_id) checked
-- against the CALLING human's own session, which is sufficient here: the
-- human who @-mentions VERI is themselves a real participant, so their own
-- membership is what lets the resulting VERI-authored message (senderId
-- null, same convention as the AI thread) pass the INSERT policy -- no
-- fake "VERI is a participant" row is needed or created.

ALTER TABLE compliance.conversations ADD COLUMN IF NOT EXISTS veri_participant boolean NOT NULL DEFAULT false;

-- New prompt template for VERI's group-participant persona -- deliberately
-- distinct from chat.ai_thread_system (the 1:1 thread's system prompt):
-- this one is read/summarize/recommend-only and explicitly forbidden from
-- claiming it performed any action, since (unlike the 1:1 thread) VERI
-- here is one voice among several human participants, not the sole
-- interlocutor. Reuses the SAME "user_assistant_oa" orchestra layer for
-- model resolution (orchestraLayers is platform-wide config, not per-org
-- -- see orchestra-model-resolver.ts -- so no per-org backfill is needed);
-- only the prompt content and the eventType logged to orchestra_executions
-- differ from the 1:1 thread's reply path.
INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('chat.veri_group_participant', 'Chat: VERI Group Participant System Prompt', 'VERI''s read/summarize/recommend-only system prompt when explicitly @-mentioned in a group VERI Chat conversation (chat-service.ts''s generateVeriGroupReply)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You have been invited into a multi-party group conversation as VERI, and a participant has just explicitly addressed you (via @mention or "ask VERI"). You are ONE voice among several human participants here, not the sole interlocutor the way you are in someone's private 1:1 thread.

Your role in this conversation is strictly read, summarize, and recommend -- you NEVER claim to have performed, sent, approved, executed, or scheduled anything, because you have no ability to take any action from inside this conversation. If asked to summarize, identify what's still open, or suggest a next step, do that directly from the conversation history provided. If asked to actually DO something (send a message, approve something, create a task), explain plainly that a human participant needs to do that, or that they can ask you directly in a task/composer if that's genuinely what they want -- never pretend you already did it.

When explicitly asked to SUMMARIZE this conversation, respond with ONLY JSON matching: {"type": "summary", "title": string, "items": [{"label": string, "value": string}]}. For every other kind of question or request, respond in plain natural-language text, never JSON.

Keep replies concise. {{PURPOSE_CLAUSE}}$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'chat.veri_group_participant'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
