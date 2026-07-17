-- Wave 4 batch 2, Part B (actor-column FK-vs-API-key-id fix):
-- drops FK constraints on crm_accounts and crm_contacts that were
-- accidentally re-introduced in migration 0219 (Wave B CRM Accounts &
-- Contacts), repeating the exact same bug class already fixed across
-- crm_leads (0206), crm_opportunities (0207), erp_sales_invoices (0205),
-- pms_issues (0204), and job_openings (0202).
--
-- Root cause (identical class): PROJEXA calls VERIDIAN API routes
-- server-to-server using API keys. Routes resolve the actor as
-- `ctx.dbUser?.id ?? ctx.apiKey!.id` -- when API-key auth, the actor
-- is the API key's own ID (e.g. "projexa_demo_key"), which is NOT a
-- row in compliance.users. Every INSERT that writes this into a
-- column with `REFERENCES compliance.users(id)` hits a FK violation.
--
-- crm_accounts and crm_contacts currently have NO /v1/projexa/ routes
-- (confirmed by grep), so this is a latent risk, not an active 500.
-- However, the fix is applied now (same narrow-scope FK-drop pattern)
-- to prevent the exact same renumbering-commit cycle that occurred
-- when these tables get PROJEXA routes in a future wave.
--
-- No schema.ts change needed -- FKs existed only as raw SQL constraints
-- in the 0219 migration, never declared with .references().

ALTER TABLE compliance.crm_accounts
  DROP CONSTRAINT IF EXISTS crm_accounts_created_by_id_fkey;

ALTER TABLE compliance.crm_accounts
  DROP CONSTRAINT IF EXISTS crm_accounts_owner_id_fkey;

ALTER TABLE compliance.crm_contacts
  DROP CONSTRAINT IF EXISTS crm_contacts_created_by_id_fkey;