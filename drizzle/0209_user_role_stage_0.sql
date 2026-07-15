-- Priority 18b (Owner directive 2026-07-15, Option B): stage-0 self-serve
-- VERI Chat registration. ALTER TYPE ... ADD VALUE cannot run in the same
-- transaction it's used in (Postgres restriction, same precedent as Wave
-- 1's/Wave 45's 0011/0035 and the Sales Engine channel audit's 0195) --
-- kept as its own migration, no other schema change here. The rest of this
-- priority's schema (users.account_stage, stage0_sources,
-- stage0_signup_count) is in the immediately-following migration.
ALTER TYPE compliance.user_role ADD VALUE IF NOT EXISTS 'stage_0';
