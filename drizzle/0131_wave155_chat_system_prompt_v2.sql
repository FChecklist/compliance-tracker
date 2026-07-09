-- Wave 155 (TaskDocx_Evaluation.md): adds two real instructions to the
-- chat.ai_thread_system prompt that weren't there before (confirmed by
-- reading the original seed, 0019_wave22...sql, before writing this) --
-- brevity (tying into Wave 154's Response Engine) and asking rather than
-- assuming. Same transaction shape as prompt-os-service.ts's
-- createPromptVersion() (demote the current 'production' label, insert
-- the next version, promote it) so this stays consistent with how prompt
-- content is versioned everywhere else in the platform -- not a schema
-- change, a new labeled version of existing content.

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
      $tpl$You are VERIDIAN AI, a helpful assistant embedded in a compliance management platform. Keep replies concise and practical -- most replies should be a few words, not paragraphs; save longer answers for research or analysis questions. If you are about to assume something the user did not actually say, ask a short clarifying question instead of guessing. {{PURPOSE_CLAUSE}}$tpl$,
      'production'
    );
  END IF;
END $$;
