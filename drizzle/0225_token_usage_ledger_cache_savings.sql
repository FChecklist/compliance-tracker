-- VERIDIAN Review Framework remediation (AI Cost Governance & FinOps,
-- 2026-07-18): "Cache-driven savings are not reflected in the cost ledger".
--
-- Prompt & Cache Management Framework Phase 1 (2026-07-14) added
-- prompt_cache_metrics + recordPromptCacheMetric() at chat-service.ts's
-- generateAiReply() call site, but that call site never wrote anything
-- into token_usage_ledger at all -- Finance's real cost ledger (the table
-- cost-guard.ts and getTokenUsageSummary() actually read) had zero rows
-- for VERI Chat's product_orchestra spend, cache-driven savings or
-- otherwise. This column plus src/lib/prompt-cache/metrics.ts now logging
-- into token_usage_ledger alongside prompt_cache_metrics closes that gap.
--
-- Nullable, no default beyond NULL: "not attempted" (the vast majority of
-- historical/non-Anthropic rows) stays NULL, not 0, matching this
-- column's own comment in schema.ts and prompt_cache_metrics'
-- cache_read_tokens precedent.
ALTER TABLE compliance.token_usage_ledger
  ADD COLUMN IF NOT EXISTS cache_savings_usd numeric;
