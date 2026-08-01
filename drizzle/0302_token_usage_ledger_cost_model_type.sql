-- AI-usage billing engine: extends the real token_usage_ledger (Finance)
-- rather than a parallel table -- see src/lib/billing/ai-usage-billing.ts
-- for the calculation this column feeds (formula Step 3) and
-- src/lib/billing/pricing-config.ts for the configurable, clearly-marked
-- PLACEHOLDER pricing values used alongside it.
--
-- Classifies which side of the Owner's real cost split a logged call
-- belongs to: 'fixed_estimated' for calls made through a flat-rate/
-- subscription AI source with no per-call meter (this row's
-- prompt_tokens+completion_tokens are already a human/tool guesstimate),
-- vs 'metered_actual' for calls through a real pay-per-token API
-- (Groq/OpenRouter/Cerebras/direct -- exact counts). Without this column
-- the billing engine cannot tell which of Step 3's two branches (padded
-- estimate vs exact actual, no padding) applies to a given logged call.
--
-- Nullable, no default beyond NULL: existing rows logged before this
-- column existed have no classification and are deliberately excluded
-- from billing-engine aggregation rather than guessed at -- same "absence
-- means not attempted" contract as this table's cache_savings_usd column
-- (0237_token_usage_ledger_cache_savings.sql).
ALTER TABLE compliance.token_usage_ledger
  ADD COLUMN IF NOT EXISTS cost_model_type text;

DO $$ BEGIN
  ALTER TABLE compliance.token_usage_ledger
    ADD CONSTRAINT token_usage_ledger_cost_model_type_check
    CHECK (cost_model_type IS NULL OR cost_model_type IN ('fixed_estimated', 'metered_actual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
