-- Onboarding lifecycle stage (Implementation AI onboarding flow).
-- Replaces OnboardingChecklist.tsx's localStorage-only tracking with a
-- real per-user column so onboarding progress survives across devices
-- and is queryable for cohort/lifecycle analysis.

ALTER TABLE compliance.users ADD COLUMN IF NOT EXISTS onboarding_stage text NOT NULL DEFAULT 'profile';
-- values: the step ids from OnboardingChecklist.tsx's STEPS array --
-- profile | compliance | upload | invite | ai-config -- persisted via
-- PATCH /api/me/onboarding-stage whenever a step is completed.
