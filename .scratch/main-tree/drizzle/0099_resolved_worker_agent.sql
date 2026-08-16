-- Deterministic (non-LLM) dispatch: when a task is created from a completed
-- VERI Chat chain selection (not free text), the worker agent is already
-- known -- no LLM needs to guess it from a flattened breadcrumb string.
-- resolved_worker_agent_id, when set, tells executeTask() to skip the whole
-- LLM planning block and dispatch directly against this specific agent.
ALTER TABLE compliance.tasks ADD COLUMN IF NOT EXISTS resolved_worker_agent_id text;
