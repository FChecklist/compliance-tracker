-- Onboarding lifecycle stage (Implementation AI onboarding flow).
-- Replaces OnboardingChecklist.tsx's localStorage-only tracking with a
-- real per-user column so onboarding progress survives across devices
-- and is queryable for cohort/lifecycle analysis.

ALTER TABLE compliance.users ADD COLUMN IF NOT EXISTS onboarding_stage text NOT NULL DEFAULT 'profile';
-- values: profile | first_task | documents | invite_team | ai_config | complete
