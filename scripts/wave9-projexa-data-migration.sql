-- Wave 9: PROJEXA org/user/membership data migration into compliance-tracker's compliance schema.
-- Data-only (no DDL), idempotent (safe to re-run: orgs skip on existing slug,
-- users skip on existing email -- compliance.users.email is globally UNIQUE).
-- Source: PROJEXA's own Supabase project (evpckeuxgvahguwsaeul, public.organizations
-- / memberships / profiles / veridian_credentials), read-only, snapshot taken 2026-07-21.
-- Target: compliance-tracker's Supabase project (pcrjmlpuqsbocqfwoxod), compliance/
-- platform schemas.
--
-- Applied 2026-07-21 via Supabase MCP execute_sql/apply_migration. Verified first
-- with this exact script wrapped in BEGIN ... <script> ... SELECT <counts> ... ROLLBACK
-- (Supabase branching, the originally-intended verify mechanism, requires the Pro
-- plan and returned PaymentRequiredException on this org) -- confirmed empirically,
-- with a disposable probe row, that ROLLBACK truly discards writes across separate
-- MCP tool calls before trusting the pattern. Re-run with COMMIT only after the
-- dry-run's row counts matched expectations exactly (see
-- ai-os/boss/completed-work/wave9-projexa-data-migration.md for full verification
-- detail and real counts).
--
-- CORRECTIONS to this wave's original brief, discovered while reading the live
-- codebase before writing this script (full detail in the .md above):
--   1. organisations/users/product_branches live in the `compliance`/`platform`
--      schemas, not `public` as originally assumed.
--   2. The correct platform.product_branches row for PROJEXA-provisioned orgs is
--      branch_key='projexa' (5fceebcd-0a7a-4448-ae2b-a72637124f13), NOT 'pms' --
--      confirmed by reading POST /api/v1/platform/provision-org (this repo's real,
--      live org-provisioning endpoint) and cross-checking the 3 PROJEXA orgs already
--      linked via veridian_credentials, all tagged with that branch id.
--   3. 3 of PROJEXA's 9 orgs were already linked via veridian_credentials
--      (Platform Test Org Alpha/4qtph, Demo Organization, Meridian Construction
--      Group) -- reused below, not recreated.
--   4. Of those 3, Meridian Construction Group's 11 memberships were already
--      present in compliance.users from a prior, unrelated E2E seeding effort
--      (PHASE1_SEED_REPORT.md) -- that org is entirely excluded from this script.
--   5. compliance.users.password_hash is NOT NULL with no recoverable real password
--      for these Supabase-Auth-based PROJEXA accounts -- migrated users get
--      'MIGRATED_NO_LOGIN_' || md5(random material), a value that can never match
--      any real credential, blocking password login until an explicit reset.
--
-- Net result: 6 new compliance.organisations rows (with a "General" department and
-- the standard free-branch + PROJEXA-required-branch enablements each, mirroring
-- provisionOrganisation()/POST .../provision-org's own bootstrap) + 77 new
-- compliance.users rows (88 total PROJEXA memberships minus the 11 already seeded).

CREATE TEMP TABLE wave9_org_map (
  projexa_org_id text PRIMARY KEY,
  compliance_org_id text,
  dept_id text,
  name text NOT NULL,
  slug text NOT NULL,
  country text NOT NULL,
  is_new boolean NOT NULL
);

INSERT INTO wave9_org_map (projexa_org_id, compliance_org_id, name, slug, country, is_new) VALUES
('26489072-0b74-4acf-9d69-ae4e044416fd', NULL, 'Acme Test Construction', 'acme-test-construction', 'IN', true),
('03c8858a-5989-45cc-a64f-54b16cdb0ea0', NULL, 'Wave4 QA Test Co', 'wave4-qa-test-co', 'IN', true),
('15bf14d9-6098-4777-bbbe-5487157bfe42', NULL, 'Skyline Builders', 'skyline-builders', 'IN', true),
('f6b0df80-968f-4874-8884-2674cf5354d7', NULL, 'Meridian Skyline Group', 'meridian-skyline-group', 'IN', true),
('48310173-0b3b-44d5-98df-18b3bbcb5005', NULL, 'Platform Test Org Alpha', 'platform-test-org-alpha-2', 'IN', true),
('03483997-4a9d-4e07-b833-e5935101ed9a', NULL, 'Al Maha Skyline Contracting & Interiors LLC', 'al-maha-skyline-contracting-interiors-llc', 'AE', true),
('6804b5a2-7098-4ece-8c6b-15dfe6358024', 'xepoooh8p1iqm6eqjetbhuuc', 'Platform Test Org Alpha', 'platform-test-org-alpha-1', 'IN', false),
('bc689d97-2dd8-47ab-b5f7-5eb3d696ad34', 've45lczmkodbiq1m20fy48r5', 'Demo Organization', 'demo-organization-0syla', 'IN', false);

-- 1) Create the 6 new organisations (skip if slug already taken -- idempotency guard)
INSERT INTO compliance.organisations (name, slug, country, plan, primary_product_branch_id, monthly_cost_cap_usd, cost_cap_enforcement_enabled)
SELECT m.name, m.slug, m.country, 'free', '5fceebcd-0a7a-4448-ae2b-a72637124f13', '20', true
FROM wave9_org_map m
WHERE m.is_new
  AND NOT EXISTS (SELECT 1 FROM compliance.organisations o WHERE o.slug = m.slug);

UPDATE wave9_org_map m
SET compliance_org_id = o.id
FROM compliance.organisations o
WHERE o.slug = m.slug AND m.is_new AND m.compliance_org_id IS NULL;

-- 2) Default "General" department for each new org
INSERT INTO compliance.departments (name, org_id)
SELECT 'General', m.compliance_org_id
FROM wave9_org_map m
WHERE m.is_new
  AND NOT EXISTS (SELECT 1 FROM compliance.departments d WHERE d.org_id = m.compliance_org_id);

UPDATE wave9_org_map m
SET dept_id = d.id
FROM compliance.departments d
WHERE d.org_id = m.compliance_org_id AND m.is_new AND d.name = 'General';

-- 3) Enable free-by-default branches (veri_reward, veri_chat_v2) + PROJEXA-required branches
--    (construction, erp, sales, hr) for the new orgs -- mirrors POST /api/v1/platform/provision-org
INSERT INTO compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled, enabled_at)
SELECT m.compliance_org_id, b.branch_id, true, now()
FROM wave9_org_map m
CROSS JOIN (VALUES
  ('45ea985f-d09c-4eae-a01f-edb31f1148b9'),
  ('741f1210-dcb1-4424-9916-646f196b317b'),
  ('a2d98a73-02e3-4dd8-a001-9428b472ee49'),
  ('2993b212-bd9a-4d0a-b25c-603ba1e236b0'),
  ('99bd00fa-7682-43d5-9f49-3b263447c074'),
  ('4a954d49-d357-4d33-a195-e73d71fa9c96')
) AS b(branch_id)
WHERE m.is_new
  AND NOT EXISTS (
    SELECT 1 FROM compliance.org_product_branch_enablements e
    WHERE e.org_id = m.compliance_org_id AND e.product_branch_id = b.branch_id
  );

-- 4) Migrate the 77 memberships/profiles not already present (excludes Meridian Construction
--    Group's 11 rows, already migrated by a prior E2E seed effort -- see PHASE1_SEED_REPORT.md)
INSERT INTO compliance.users (org_id, department_id, email, name, role, password_hash, is_active)
SELECT
  m.compliance_org_id,
  m.dept_id,
  u.email,
  COALESCE(u.display_name, initcap(replace(split_part(u.email, '@', 1), '.', ' '))),
  (CASE u.role WHEN 'owner' THEN 'admin' WHEN 'admin' THEN 'admin' ELSE 'member' END)::compliance.user_role,
  'MIGRATED_NO_LOGIN_' || md5(random()::text || clock_timestamp()::text || u.email),
  true
FROM (VALUES
('26489072-0b74-4acf-9d69-ae4e044416fd','projexa.verify.test1@gmail.com',NULL,'owner'),
('03483997-4a9d-4e07-b833-e5935101ed9a','deepak.rao@almahaskyline.demo','Deepak Rao','admin'),
('03483997-4a9d-4e07-b833-e5935101ed9a','fatima.alzaabi@almahaskyline.demo','Fatima Al Zaabi','admin'),
('03483997-4a9d-4e07-b833-e5935101ed9a','grace.santos@almahaskyline.demo','Grace Santos','admin'),
('03483997-4a9d-4e07-b833-e5935101ed9a','hassan.alnuaimi@almahaskyline.demo','Hassan Al Nuaimi','admin'),
('03483997-4a9d-4e07-b833-e5935101ed9a','karim.fathi@almahaskyline.demo','Karim Fathi','admin'),
('03483997-4a9d-4e07-b833-e5935101ed9a','layla.haddad@almahaskyline.demo','Layla Haddad','admin'),
('03483997-4a9d-4e07-b833-e5935101ed9a','mariam.alsuwaidi@almahaskyline.demo','Mariam Al Suwaidi','admin'),
('03483997-4a9d-4e07-b833-e5935101ed9a','michael.domingo@almahaskyline.demo','Michael Domingo','admin'),
('03483997-4a9d-4e07-b833-e5935101ed9a','rajesh.nair@almahaskyline.demo','Rajesh Nair','admin'),
('03483997-4a9d-4e07-b833-e5935101ed9a','suresh.kumar@almahaskyline.demo','Suresh Kumar','admin'),
('03483997-4a9d-4e07-b833-e5935101ed9a','youssef.elamin@almahaskyline.demo','Youssef El-Amin','admin'),
('03483997-4a9d-4e07-b833-e5935101ed9a','aaliyah.alzarooni@almahaskyline.demo','Aaliyah Al Zarooni','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','abdullah.alshamsi@almahaskyline.demo','Abdullah Al Shamsi','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','ahmed.youssef@almahaskyline.demo','Ahmed Youssef','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','aisha.almarri@almahaskyline.demo','Aisha Al Marri','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','anjali.krishnan@almahaskyline.demo','Anjali Krishnan','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','arun.pillai@almahaskyline.demo','Arun Pillai','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','ben.alonzo@almahaskyline.demo','Ben Alonzo','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','bharat.joshi@almahaskyline.demo','Bharat Joshi','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','camille.santos@almahaskyline.demo','Camille Santos','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','cherry.mercado@almahaskyline.demo','Cherry Mercado','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','dana.farouk@almahaskyline.demo','Dana Farouk','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','divya.menon@almahaskyline.demo','Divya Menon','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','faisal.rahman@almahaskyline.demo','Faisal Rahman','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','hana.aoun@almahaskyline.demo','Hana Aoun','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','jasmine.reyes@almahaskyline.demo','Jasmine Reyes','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','jerome.bautista@almahaskyline.demo','Jerome Bautista','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','joel.fernandez@almahaskyline.demo','Joel Fernandez','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','leila.nasser@almahaskyline.demo','Leila Nasser','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','maria.cruz@almahaskyline.demo','Maria Cruz','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','mohammed.albalushi@almahaskyline.demo','Mohammed Al Balushi','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','nadia.khoury@almahaskyline.demo','Nadia Khoury','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','nikhil.varma@almahaskyline.demo','Nikhil Varma','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','noora.alhosani@almahaskyline.demo','Noora Al Hosani','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','omar.haddad@almahaskyline.demo','Omar Haddad','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','peter.cruz@almahaskyline.demo','Peter Cruz','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','priya.menon@almahaskyline.demo','Priya Menon','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','ramon.villanueva@almahaskyline.demo','Ramon Villanueva','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','rashid.alketbi@almahaskyline.demo','Rashid Al Ketbi','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','ravi.shankar@almahaskyline.demo','Ravi Shankar','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','reem.alfalasi@almahaskyline.demo','Reem Al Falasi','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','salim.alkaabi@almahaskyline.demo','Salim Al Kaabi','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','samir.ghanem@almahaskyline.demo','Samir Ghanem','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','sanjay.iyer@almahaskyline.demo','Sanjay Iyer','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','sara.almarzooqi@almahaskyline.demo','Sara Al Marzooqi','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','tariq.aziz@almahaskyline.demo','Tariq Aziz','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','vikram.singh@almahaskyline.demo','Vikram Singh','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','yousef.saleh@almahaskyline.demo','Yousef Saleh','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','zayed.aldhaheri@almahaskyline.demo','Zayed Al Dhaheri','member'),
('03483997-4a9d-4e07-b833-e5935101ed9a','khalid.almheiri@almahaskyline.demo','Khalid Al Mheiri','owner'),
('bc689d97-2dd8-47ab-b5f7-5eb3d696ad34','demo1@projexa-ai.com',NULL,'member'),
('bc689d97-2dd8-47ab-b5f7-5eb3d696ad34','demo2@projexa-ai.com',NULL,'member'),
('bc689d97-2dd8-47ab-b5f7-5eb3d696ad34','democeo@projexa-ai.com',NULL,'owner'),
('f6b0df80-968f-4874-8884-2674cf5354d7','deepak.verma@meridianskyline.demo','Deepak Verma','admin'),
('f6b0df80-968f-4874-8884-2674cf5354d7','karan.malhotra@meridianskyline.demo','Karan Malhotra','admin'),
('f6b0df80-968f-4874-8884-2674cf5354d7','kavita.desai@meridianskyline.demo','Kavita Desai','admin'),
('f6b0df80-968f-4874-8884-2674cf5354d7','priya.iyer@meridianskyline.demo','Priya Iyer','admin'),
('f6b0df80-968f-4874-8884-2674cf5354d7','rajesh.kumar@meridianskyline.demo','Rajesh Kumar','admin'),
('f6b0df80-968f-4874-8884-2674cf5354d7','sunita.rao@meridianskyline.demo','Sunita Rao','admin'),
('f6b0df80-968f-4874-8884-2674cf5354d7','vikram.nair@meridianskyline.demo','Vikram Nair','admin'),
('f6b0df80-968f-4874-8884-2674cf5354d7','amit.shah@meridianskyline.demo','Amit Shah','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','arjun.kapoor@meridianskyline.demo','Arjun Kapoor','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','divya.menon@meridianskyline.demo','Divya Menon','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','farhan.ali@meridianskyline.demo','Farhan Ali','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','meera.joshi@meridianskyline.demo','Meera Joshi','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','neha.gupta@meridianskyline.demo','Neha Gupta','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','rahul.bose@meridianskyline.demo','Rahul Bose','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','ritu.singh@meridianskyline.demo','Ritu Singh','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','rohan.mehta@meridianskyline.demo','Rohan Mehta','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','sameer.qureshi@meridianskyline.demo','Sameer Qureshi','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','sanjay.patil@meridianskyline.demo','Sanjay Patil','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','sneha.reddy@meridianskyline.demo','Sneha Reddy','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','tanvi.agarwal@meridianskyline.demo','Tanvi Agarwal','member'),
('f6b0df80-968f-4874-8884-2674cf5354d7','ananya.sharma@meridianskyline.demo','Ananya Sharma','owner'),
('6804b5a2-7098-4ece-8c6b-15dfe6358024','platformtestalpha@gmail.com',NULL,'owner'),
('15bf14d9-6098-4777-bbbe-5487157bfe42','rajiv.malhotra.skylinebuilders@gmail.com',NULL,'owner')
) AS u(projexa_org_id, email, display_name, role)
JOIN wave9_org_map m ON m.projexa_org_id = u.projexa_org_id
WHERE NOT EXISTS (SELECT 1 FROM compliance.users cu WHERE cu.email = u.email);
