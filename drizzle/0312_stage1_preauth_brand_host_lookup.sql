-- OCID-038 real gap closure, GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH
-- (2026-08-04, Owner decision UMR-20260804-090421-c647): PROJEXA is not a
-- separate platform -- it is the first brand built on the one VERIDIAN
-- platform (one runtime, one database, one UMR, one UTR). This migration
-- adds the one real, minimal lookup key Stage 1 (pre-authentication,
-- domain-based) resolution needs: a way to map a real incoming HTTP Host
-- header to the existing product_branches "brand configuration" row.
--
-- Deliberately NOT reusing product_branches.domain for this: that column is
-- a pre-existing, unrelated, free-text BUSINESS-TAXONOMY grouping (real
-- values today: "construction", "compliance", "project_management", "hr",
-- etc. -- confirmed live via direct query and via
-- VERIDIAN_DMP_DCF_CONSTITUTION.md's own comment that moduleRegistry.domain
-- /productBranches.domain are free text specifically because no second
-- domain exists yet to make a real FK hierarchy meaningful). Overloading
-- that column with real DNS hostnames would silently collide two unrelated
-- concepts under one name -- the opposite of the zero-duplication
-- discipline this migration is trying to honor. host_domain is a new,
-- separate, narrowly-scoped column on the SAME existing table (no new
-- table, no parallel registry), matching organisations.custom_domain's own
-- established shape/precedent (drizzle/0221_wave_b_white_label_branding.sql).
--
-- Real, live-confirmed data at migration-authoring time: platform.product_branches
-- has exactly one real row whose displayName is "PROJEXA" AND is actually
-- referenced by real orgs (10 real organisations.primary_product_branch_id
-- rows point at it) -- id 5fceebcd-0a7a-4448-ae2b-a72637124f13, branch_key
-- 'projexa'. A second, unrelated row (branch_key 'pms', also displayName
-- "PROJEXA") exists but is referenced by zero real orgs -- not touched here,
-- to avoid guessing at a second real gap (a possible naming collision
-- between the 'pms' and 'projexa' branch rows) that is out of this
-- migration's own narrow scope.
ALTER TABLE platform.product_branches ADD COLUMN IF NOT EXISTS host_domain text;

CREATE UNIQUE INDEX IF NOT EXISTS product_branches_host_domain_key
  ON platform.product_branches (host_domain)
  WHERE host_domain IS NOT NULL;

UPDATE platform.product_branches
SET host_domain = 'projexa-ai.com'
WHERE id = '5fceebcd-0a7a-4448-ae2b-a72637124f13';
