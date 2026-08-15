-- AI Router registry-backed model resolution follow-up (2026-07-19).
-- Owner-confirmed (2026-07-19) real model: openai/gpt-oss-20b via Groq, same
-- family as the already-registered openai/gpt-oss-120b (drizzle/0231's own
-- seed) -- a genuinely new, cheaper floor-tier option. Registered here only
-- (real, known, registry-listed) -- deliberately NOT wired as the new
-- platform default (orchestra-model-resolver.ts's 'platform_default' role,
-- see drizzle/0246) or referenced by any call site; that is a separate
-- decision, out of this task's scope. Confirmed via grep before this
-- migration was written: zero references to "gpt-oss-20b" existed anywhere
-- in this codebase.
--
-- Pricing verified live via groq.com/pricing, 2026-07-19: $0.075 / 1M input
-- tokens, $0.30 / 1M output tokens ($0.000075 / $0.0003 per 1k).

INSERT INTO platform.ai_model_registry (provider, model, tier, cost_per_1k_input, cost_per_1k_output, notes)
VALUES (
  'groq',
  'openai/gpt-oss-20b',
  'mechanical', -- most-restrictive default tier per model-tier-eligibility.ts's own posture (untouched by this migration); not added to JUDGMENT_ELIGIBLE/INTEGRATIVE_ELIGIBLE
  0.000075,
  0.0003,
  'Newer, cheaper floor-tier option alongside openai/gpt-oss-120b (Owner-confirmed 2026-07-19). Registered only -- not wired as a platform default or referenced by any call site.'
)
ON CONFLICT (provider, model) DO NOTHING;
