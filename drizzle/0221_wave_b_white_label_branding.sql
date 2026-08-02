-- Wave B (VERIDIAN Review Framework remediation, "BYOB white-label branding"
-- workstream, 2026-07-17): organisations.logo has existed since the very
-- first schema (drizzle/0000) and was never read or written anywhere in
-- src/ -- confirmed via a fresh grep of the codebase immediately before this
-- migration was written. No per-tenant branding capability existed at all.
--
-- IMPORTANT PROVENANCE NOTE: this exact DDL was already applied live to the
-- pcrjmlpuqsbocqfwoxod project by an earlier session that claimed this same
-- ACTIVE-CLAIMS.yaml entry and then silently died before writing this file,
-- committing, or opening a PR (see ai-os/boss/ACTIVE-CLAIMS.yaml's entry for
-- "BYOB white-label branding", claimed 2026-07-16). That session's own
-- Supabase migration history (supabase_migrations.schema_migrations,
-- version 20260716123116, name priority_wave_b_white_label_branding) was
-- inspected directly and independently verified before reuse, not trusted
-- blindly: all 5 new columns exist on every org and are still NULL on every
-- row (zero data written), the org-branding storage bucket exists and is
-- empty (0 objects), it carries no storage.objects RLS policies (consistent
-- with this repo's existing compliance-documents/voice-memos buckets, which
-- also rely on service-role-only writes rather than policies), and the
-- partial unique index on custom_domain is well-formed. Reusing this design
-- rather than inventing a colliding, differently-named alternative. This
-- file exists so drizzle/ and schema.ts finally match what the live DB
-- already has, and so any OTHER environment (a fresh Supabase project, a
-- reviewer's local branch DB) can reach the same state via this repo's
-- normal migration path instead of only ever existing as live-applied,
-- uncommitted DDL.
--
-- Column choices:
--   brand_primary_color / brand_accent_color: plain text (hex strings,
--     e.g. "#1C2B3A"), validated at the application layer
--     (org-branding-service.ts), not a Postgres CHECK constraint -- matches
--     this table's own existing precedent (gstin/panNumber/cinNumber are
--     all unvalidated text at the DB layer, checked in services/routes).
--   favicon_url: separate from `logo` -- a favicon is a distinct small
--     square asset (ICO/PNG), not a resized copy of the main logo.
--   custom_domain: stores the org's REQUESTED custom domain only. Deliberate
--     scope boundary (see BrandingSection.tsx / org-branding-service.ts):
--     actual DNS verification, TLS/SSL certificate provisioning, and
--     request-time routing (i.e. actually serving the app on that domain)
--     are NOT implemented here -- that's a genuinely separate, much larger
--     infrastructure workstream (ACME/Let's Encrypt or a proxy such as
--     Vercel's domains API, ownership verification via TXT/CNAME record,
--     per-request Host-header-based tenant resolution). Storing the field
--     without half-building the verification/routing machinery around it
--     would otherwise silently imply the domain is live the moment an admin
--     saves it, which is false and unsafe. The partial unique index still
--     prevents two orgs from ever racing to claim the same domain string,
--     so this is safe groundwork for that future workstream, not a dead end.
--   email_sender_name: display name for outbound email (e.g. notification
--     digests) -- not wired to an email-sending pipeline in this migration;
--     included because it was already part of the live column set and is a
--     natural sibling of the other branding fields, but no email service in
--     this codebase reads it yet (same "field exists, not every consumer
--     wired in the same wave" precedent as several other columns on this
--     table, e.g. subscriptionPlanId, primaryProductBranchId).
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS brand_primary_color text;
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS brand_accent_color text;
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS favicon_url text;
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS custom_domain text;
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS email_sender_name text;

CREATE UNIQUE INDEX IF NOT EXISTS organisations_custom_domain_key
  ON compliance.organisations (custom_domain)
  WHERE custom_domain IS NOT NULL;

-- Public bucket (deliberately NOT following compliance-documents' private +
-- signed-URL pattern): a brand logo/favicon is non-confidential -- it's
-- rendered in the sidebar on every authenticated page load and would need a
-- signed URL refreshed constantly at that TTL (compliance-documents' is 300s)
-- for no real confidentiality benefit. A stable public URL is the correct
-- and standard pattern for tenant logos (comparable to how most SaaS
-- products serve org branding assets). Writes still only ever go through the
-- service-role client from the new /api/settings/branding/logo route (same
-- as documents route.ts) -- there is no anon/authenticated INSERT policy on
-- storage.objects for this bucket, matching the existing buckets' posture of
-- "no client ever writes directly, only the server-side admin client does."
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-branding',
  'org-branding',
  true,
  2097152,
  ARRAY['image/png','image/jpeg','image/webp','image/svg+xml','image/x-icon']
)
ON CONFLICT (id) DO NOTHING;
