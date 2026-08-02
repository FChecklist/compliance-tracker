-- PLATFORM-01 Wave 1, Workstream 1 (platform-level tenant provisioning).
-- See C:\Users\Dell\.claude\plans\floating-launching-lagoon.md and
-- PLATFORM_STRATEGY.md section 6.12 (apiKeys had no concept of "which
-- external application/product issued this key" -- exactly the gap that
-- let one shared PROJEXA API key serve every PROJEXA customer with zero
-- real per-customer data isolation).
--
-- New platform_applications table: one row per sibling product (PROJEXA,
-- The Firm, FM & CS, Office AI OS, Forge, future ones) allowed to
-- provision customer orgs server-to-server. This is a PLATFORM-level
-- service credential, categorically different from a customer's own
-- vk_... apiKeys row -- it's what a sibling product's own BACKEND uses to
-- provision orgs on behalf of ITS customers, never exposed to any end
-- user. Global catalog table, same RLS posture as product_branches
-- (service_role full access, app_runtime read-only -- there is no orgId
-- to scope this by, it predates any customer org's existence).
CREATE TABLE IF NOT EXISTS compliance.platform_applications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  application_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.platform_applications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_platform_applications ON compliance.platform_applications FOR SELECT TO app_runtime USING (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_platform_applications ON compliance.platform_applications FOR ALL TO service_role USING (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- apiKeys.issuedForApplicationId: nullable FK -> platform_applications.
-- null = human-generated via the existing self-serve POST
-- /api/settings/api-keys (every pre-existing key's exact current state,
-- zero migration risk). Set only by the new POST
-- /api/v1/platform/provision-org flow, tagging which sibling product's
-- backend minted the key on behalf of one of its own customers.
ALTER TABLE compliance.api_keys ADD COLUMN IF NOT EXISTS issued_for_application_id text REFERENCES compliance.platform_applications(id);

-- organisations.primaryProductBranchId: nullable FK -> product_branches.
-- Records which product a customer org primarily belongs to. Nullable so
-- every pre-existing org (created via autoProvisionUser()'s human-signup
-- path, which predates this concept and is not tagged to any one product
-- branch) is unaffected.
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS primary_product_branch_id text REFERENCES compliance.product_branches(id);

-- Seed the 'projexa' product_branches row -- confirmed live via a fresh
-- SELECT before writing this migration that no 'projexa'-keyed row
-- existed (PROJEXA today runs on VERIDIAN's construction/erp/sales/hr
-- branches combined but had no single catalog identity of its own to tag
-- provisioned orgs with).
INSERT INTO compliance.product_branches (branch_key, display_name, domain, description, status, build_tier)
VALUES ('projexa', 'PROJEXA', 'construction', 'Construction Intelligence OS -- sibling product built on VERIDIAN via API (no rebuild); provisions its own customer orgs via POST /api/v1/platform/provision-org', 'live', 'moderate_build')
ON CONFLICT (branch_key) DO NOTHING;

-- Seed exactly one platform_applications row for 'projexa'. Raw key
-- generated once outside this migration (never committed anywhere in
-- source control) using the same vk_-style random-32-char generation as
-- generateApiKey() in src/lib/api-keys.ts, prefixed pk_ (platform key) to
-- stay visually distinct from a customer's own vk_... key, hashed with
-- the exact same hashSHA256() algorithm (SHA-256 hex digest) so
-- validatePlatformApplicationKey() can hash an incoming Bearer token and
-- compare against this row the same way validateApiKey() already does
-- for api_keys.key_hash. The raw key is reported once to the Owner (to
-- set as a Vercel env var on the PROJEXA side) and is not retrievable
-- again after that -- identical contract to the existing human-facing
-- POST /api/settings/api-keys endpoint.
INSERT INTO compliance.platform_applications (application_key, display_name, key_hash, key_prefix, is_active)
VALUES ('projexa', 'PROJEXA', '523939bb8f8e63e3ac0da8d7f636105b91016def8d7ef6b63f86f8d895415221', 'pk_qBQB7...', true)
ON CONFLICT (application_key) DO NOTHING;
