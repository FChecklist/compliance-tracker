-- Migration 005: Onboarding fields + timezone for organisations
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS onboarding_step INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_skipped_ai BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS financial_year_start VARCHAR(10) NOT NULL DEFAULT 'April';

COMMENT ON COLUMN organisations.onboarding_step IS '0=not started, 1=profile, 2=departments, 3=users, 4=compliance_categories, 5=ai_library';
COMMENT ON COLUMN organisations.timezone IS 'IANA timezone string e.g. Asia/Kolkata';
COMMENT ON COLUMN organisations.financial_year_start IS 'Month name e.g. April';