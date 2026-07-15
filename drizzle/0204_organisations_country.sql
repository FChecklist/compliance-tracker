-- PLATFORM-01 Wave 2, Workstream 6 (per-country compliance engine registry).
-- See C:\Users\Dell\.claude\plans\floating-launching-lagoon.md and
-- ai-os/boss/ACTIVE-CLAIMS.yaml's PLATFORM-01 Wave 2 entry.
--
-- Adds organisations.country (ISO 3166-1 alpha-2), nullable, defaulted 'IN'.
-- Every pre-existing org already implicitly ran India-only statute logic
-- (the only country src/lib/engines/ has ever implemented) -- this column
-- documents that existing reality rather than changing behavior. Backfilled
-- to 'IN' for existing rows so nothing silently reads NULL; new rows get
-- the same default via the column default. Not enforced NOT NULL -- keeping
-- it opt-in/overridable matches this table's own existing precedent
-- (licensedSeats, monthlyCostCapUsd, etc. are all nullable/opt-in additive
-- columns per their own comments in schema.ts).

ALTER TABLE compliance.organisations
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'IN';

UPDATE compliance.organisations
  SET country = 'IN'
  WHERE country IS NULL;
