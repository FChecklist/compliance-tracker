-- Down-migration for drizzle/0670_ai_bridge_claude_code.sql. Run deliberately by the PM, not by any script. DATA LOSS: only queued test prompts and answers.
BEGIN;
DROP FUNCTION IF EXISTS public.ai_bridge_purge();
DROP FUNCTION IF EXISTS public.ai_bridge_complete(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.ai_bridge_claim(text);
DROP FUNCTION IF EXISTS public.ai_bridge_get(uuid);
DROP FUNCTION IF EXISTS public.ai_bridge_enqueue(text, text, text, text, jsonb);
DROP TABLE IF EXISTS platform.ai_bridge_worker;
DROP TABLE IF EXISTS platform.ai_bridge_request;
COMMIT;
