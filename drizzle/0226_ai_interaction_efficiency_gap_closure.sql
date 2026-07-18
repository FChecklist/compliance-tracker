-- REVIEW-FRAMEWORK-WAVE4: AI Architecture / AI Interaction Efficiency gap
-- closure (11 findings, one PR).
--
-- conversations.chain_selector_skipped: whether the caller explicitly
-- declined the Chain Selector step when creating a workflow thread
-- (createWorkflowThread() now requires an explicit choice -- resolve a
-- chain, or set this true -- instead of silently defaulting to no chain).
-- NOT NULL DEFAULT false: every pre-existing row and every
-- createConversation() human-to-human thread (which never sets this) reads
-- as "not applicable", not "skipped".
--
-- conversations.clarification_round_trips: real, queryable count of
-- clarification-shaped AI replies in this conversation (was previously
-- impossible to measure at all).
--
-- messages.confidence_label: 'high' | 'medium' | 'low', set only on a real
-- AI-generated reply -- an honest heuristic proxy from floor-tier-
-- escalation.ts's existing hedging-detection signal. Nullable, no default:
-- every pre-existing row and every non-AI message stays null.
--
-- Additive and backward-compatible throughout; IF NOT EXISTS keeps this safe
-- to re-run, matching this repo's established additive-column convention
-- (e.g. 0224's source column). No RLS/index/ownership change -- both tables
-- already carry the schema's standard org-scoped RLS.

ALTER TABLE compliance.conversations
  ADD COLUMN IF NOT EXISTS chain_selector_skipped boolean NOT NULL DEFAULT false;

ALTER TABLE compliance.conversations
  ADD COLUMN IF NOT EXISTS clarification_round_trips integer NOT NULL DEFAULT 0;

ALTER TABLE compliance.messages
  ADD COLUMN IF NOT EXISTS confidence_label text;
