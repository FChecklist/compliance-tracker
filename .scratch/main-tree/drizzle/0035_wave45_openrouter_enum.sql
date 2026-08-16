-- Wave 45: VAIOS Layer 1-4 OpenRouter wiring. See PLATFORM_STRATEGY.md §26.
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction it's added
-- in (Postgres restriction) -- kept as its own migration file, separate from
-- 0036 which actually uses the new 'openrouter' value.
ALTER TYPE compliance.ai_provider ADD VALUE IF NOT EXISTS 'openrouter';
