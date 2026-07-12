-- Priority 11 (GAP-D13-ASSUMPTION-VALIDATION, MASTER-TRACKER.yaml
-- open_items.real_gaps_not_yet_built -- U-D13.B1.S2 in
-- ai-os/tree4-unified/10-merged-governance-layer.yaml: "before AI makes any
-- input/output/process assumption, it must validate with the user via
-- chat, scoped to the current selection.")
--
-- Wave 155 (migration 0132) already added a general "ask rather than
-- assume" clause to chat.ai_thread_system: "If you are about to assume
-- something the user did not actually say, ask a short clarifying question
-- instead of guessing." That's real and still live in production (verified
-- by reading 0131/0132 before writing this) -- but the 2026-07-12 full
-- status reconciliation pass re-flagged D13.B1.S2 as still open, and on a
-- careful re-read of the source requirement, that's correct: U-D13's whole
-- branch is specifically about the Mode Pill/Chain-Selection guardrail
-- layer (see U-D13.B1.S1, same file, immediately above S2), i.e. "state
-- the assumption and wait for confirmation" scoped to whatever
-- module/chain/task selection is active in the conversation, not just a
-- generic one-line reminder to ask instead of guess. That's a meaningfully
-- stronger, more concrete bar than what 0132 shipped, so this is a real
-- gap closure, not a duplicate of already-shipped work.
--
-- This migration is a targeted, additive refinement of the existing
-- clause -- not a rewrite of the template. It keeps 100% of v3's content
-- (the full VERIDIAN AI OS persona, brevity clause, and the original
-- ask-before-assuming sentence) and appends one new sentence that (a)
-- requires the assumption to be stated explicitly, not just alluded to via
-- a vague clarifying question, (b) requires waiting for the user's answer
-- before proceeding on it, and (c) explicitly scopes this to "the current
-- selection" language the source requirement uses -- any module, chain, or
-- workflow context active in the conversation, covering every input/
-- process/output assumption within it, not only the literal question just
-- asked.
--
-- Deliberately NOT touched: chat.veri_group_participant (0159). That
-- template is already read/summarize/recommend-only and explicitly
-- forbidden from claiming it took any action -- it never proceeds on an
-- assumption in the first place (nothing for it to "proceed" on), so this
-- specific gap doesn't apply there the way it does to the 1:1 AI thread
-- that actually dispatches tasks/work on the user's behalf.
--
-- No structural/UX support (e.g. a "pending confirmation" conversation
-- state) is added alongside this. Investigated first: chat-service.ts's
-- generateAiReply() explicitly documents (see its own "Phase 3" comment
-- above the reply-gate check) that this call path has NO tool-calling
-- capability -- a reply is only ever stored as an ordinary chat message,
-- never followed by an automatic side-effecting action. VERI Chat is
-- already turn-based: if VERI asks a clarifying question in its reply
-- instead of silently assuming, the user's next message IS the
-- confirmation step, handled by the existing conversation flow with zero
-- new plumbing. conversations.currentState/previousState (Wave 144,
-- schema.ts) already exist as free-text, additive, currently-unwired
-- columns that a future pass COULD use if a genuine pause/resume need
-- shows up on an autonomous-action surface (e.g. task_execution.
-- planning_system, which does dispatch real work) -- reusing those is the
-- right call over inventing a new mechanism, but building that out now
-- would be speculative: no live call path off this template needs it
-- today. Recorded here plainly rather than silently building something
-- unneeded.

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
      $tpl$You are VERIDIAN, the user's personal AI assistant inside VERIDIAN AI OS — the complete system their company runs on: finance & accounting, sales & CRM, HR & payroll, operations & inventory, projects, and compliance & legal. You work FOR the user, like a capable, trusted employee: warm, plain-spoken, proactive, and brief. Never talk like a software manual, and never assume the user is technical. When asked what you can do or for a tour, describe outcomes across ALL departments — raising invoices, chasing payments, onboarding a new hire, tracking stock, updating the sales pipeline, meeting statutory deadlines — never only compliance. When the user gives you a task, do as much as you can, say clearly what you did, and note anything that awaits their approval. Keep replies concise and practical -- most replies should be a few words, not paragraphs; save longer answers for research or analysis questions. If you are about to assume something the user did not actually say, ask a short clarifying question instead of guessing. When a specific module, chain, or workflow selection is active in this conversation, this rule covers every input, process, and output assumption within that selection, not just the immediate question -- state the specific assumption you would otherwise make, in plain language, and wait for the user to confirm it before proceeding, rather than silently acting on it. {{PURPOSE_CLAUSE}}$tpl$,
      'production'
    );
  END IF;
END $$;
