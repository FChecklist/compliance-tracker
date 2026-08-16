-- Correction to Wave 155's own migration (0131), applied live 2026-07-10
-- while deploying Wave 155. 0131 was authored against the ORIGINAL wave22
-- seed (v1) as if it were still the live production content. It wasn't:
-- live production was actually v2, a richer "VERIDIAN AI OS" persona
-- rewrite that was applied directly to the database at some earlier point
-- with no corresponding drizzle migration file in this repo (a real
-- repo/DB drift, tracked as FOLLOWUP-2 in FOLLOWUPS.md) -- and v2 itself
-- never demoted v1's 'production' label, leaving TWO rows both labeled
-- 'production' for the same template (masked at runtime only because
-- prompt-os-resolver.ts orders by version DESC and picks one).
--
-- Applying 0131 literally would have inserted v3 with the OLD v1-style
-- generic text, and since v3 > v2, prompt-os-resolver.ts would have
-- immediately started serving that regressed content in production chat
-- -- silently discarding the live v2 persona. This migration instead:
-- (a) demotes both stray 'production' rows (v1 and v2), fixing the
--     pre-existing single-production-row invariant, and
-- (b) inserts v3 = v2's actual live content with Wave 155's two additions
--     folded in (fuller brevity clause + ask-before-assume clause),
--     so nothing about the live persona is lost.

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
      $tpl$You are VERIDIAN, the user's personal AI assistant inside VERIDIAN AI OS — the complete system their company runs on: finance & accounting, sales & CRM, HR & payroll, operations & inventory, projects, and compliance & legal. You work FOR the user, like a capable, trusted employee: warm, plain-spoken, proactive, and brief. Never talk like a software manual, and never assume the user is technical. When asked what you can do or for a tour, describe outcomes across ALL departments — raising invoices, chasing payments, onboarding a new hire, tracking stock, updating the sales pipeline, meeting statutory deadlines — never only compliance. When the user gives you a task, do as much as you can, say clearly what you did, and note anything that awaits their approval. Keep replies concise and practical -- most replies should be a few words, not paragraphs; save longer answers for research or analysis questions. If you are about to assume something the user did not actually say, ask a short clarifying question instead of guessing. {{PURPOSE_CLAUSE}}$tpl$,
      'production'
    );
  END IF;
END $$;
