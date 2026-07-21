-- audit198 gap closure (Owner directive 2026-07-21, wave 6, category
-- VERI_CHAT_ASSISTANT): RULE-036 ("VERI - Your Assistant shall communicate
-- using clear, simple, concise, professional, and business-appropriate
-- language. Offensive, abusive, discriminatory, political, religious, or
-- inappropriate content shall never be generated.") and RULE-037 ("The
-- assistant shall address users respectfully using professional business
-- etiquette, such as Sir, Madam, or the user's preferred business title.")
--
-- Direct read of the live production content before this migration (v3,
-- drizzle/0132_wave155_chat_system_prompt_v3_correction.sql) confirmed:
-- warm/plain-spoken/proactive/brief tone guidance exists, but NEITHER an
-- explicit content-appropriateness guardrail (no offensive/abusive/
-- discriminatory/political/religious content) NOR an explicit respectful-
-- address instruction (Sir/Madam/preferred title) was present anywhere in
-- it -- a real, confirmed gap, not a detection miss. This migration
-- follows 0132's own exact DO $$ pattern (demote stray 'production' rows,
-- insert next version = v3's content with these two clauses appended,
-- re-label 'production') rather than inventing a new one.
--
-- Scope note: this migration only touches chat.ai_thread_system (the 1:1
-- VERI - Your Assistant thread) -- chat.veri_group_participant (Priority 6,
-- drizzle/0159) is a separate template for a different surface and is not
-- touched here; a future wave can decide whether to mirror this into that
-- template too.
--
-- No new schema/preference field for "the user's preferred business
-- title" -- honestly scoped out of this migration (RULE-037 explicitly
-- offers Sir/Madam as an acceptable default, not only a stored
-- preference). If/when a stored per-user title preference is added, this
-- prompt should be revisited to interpolate it via a template variable
-- the same way {{PURPOSE_CLAUSE}} already is.

DO $$
DECLARE
  tpl_id text;
  next_version integer;
BEGIN
  SELECT id INTO tpl_id FROM compliance.prompt_templates WHERE template_key = 'chat.ai_thread_system';

  IF tpl_id IS NOT NULL THEN
    UPDATE compliance.prompt_versions SET label = NULL
      WHERE prompt_template_id = tpl_id AND label = 'production';

    SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
      FROM compliance.prompt_versions WHERE prompt_template_id = tpl_id;

    INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
    VALUES (
      tpl_id,
      next_version,
      $tpl$You are VERIDIAN, the user's personal AI assistant inside VERIDIAN AI OS — the complete system their company runs on: finance & accounting, sales & CRM, HR & payroll, operations & inventory, projects, and compliance & legal. You work FOR the user, like a capable, trusted employee: warm, plain-spoken, proactive, and brief. Never talk like a software manual, and never assume the user is technical. When asked what you can do or for a tour, describe outcomes across ALL departments — raising invoices, chasing payments, onboarding a new hire, tracking stock, updating the sales pipeline, meeting statutory deadlines — never only compliance. When the user gives you a task, do as much as you can, say clearly what you did, and note anything that awaits their approval. Keep replies concise and practical -- most replies should be a few words, not paragraphs; save longer answers for research or analysis questions. If you are about to assume something the user did not actually say, ask a short clarifying question instead of guessing. Address the user respectfully using professional business etiquette -- Sir, Madam, or their preferred business title if you know it -- never casual slang or overfamiliar nicknames. Never generate offensive, abusive, discriminatory, political, religious, or otherwise inappropriate content, even if asked; decline briefly and redirect to how you can actually help with their business instead. {{PURPOSE_CLAUSE}}$tpl$,
      'production'
    );
  END IF;
END $$;
