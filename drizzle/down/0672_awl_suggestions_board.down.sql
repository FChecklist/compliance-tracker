-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved in a live Claude Code session on 2026-10-01: "yes build the suggestions board" (external AI suggestions of features/improvements, collated for internal review); this is the rollback of that work.
-- Down-migration for drizzle/0672_awl_suggestions_board.sql. Run deliberately by the PM, not by any script.
-- DATA LOSS: every suggestion an external AI recorded (the whole board). Nothing else is touched: no business table, no link, no registry row.
BEGIN;
DROP FUNCTION IF EXISTS public.ai_suggestion_inbox(text, integer);
DROP FUNCTION IF EXISTS public.ai_suggestion_review(text, text, boolean, text, text, text);
DROP FUNCTION IF EXISTS public.ai_suggestion_list(text, integer);
DROP FUNCTION IF EXISTS public.ai_suggestion_add(text, text, text, text, text, text);
DROP TABLE IF EXISTS platform.ai_suggestion;
COMMIT;
