-- Wave 61: Unified Document Management (ERP benchmark Tier 3 #15)
-- Additive columns on the existing compliance.documents table -- this becomes
-- the real central repository instead of adding a parallel table. See the
-- code comment on schema.ts's documents table for why linkedEntityType/
-- linkedEntityId are free-text discriminators rather than per-module FKs.

ALTER TABLE "compliance"."documents"
  ADD COLUMN "category" text,
  ADD COLUMN "expiry_date" timestamp,
  ADD COLUMN "linked_entity_type" text,
  ADD COLUMN "linked_entity_id" text,
  ADD COLUMN "parent_document_id" text,
  ADD COLUMN "version_number" integer NOT NULL DEFAULT 1,
  ADD COLUMN "is_latest_version" boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "documents_linked_entity_idx" ON "compliance"."documents" ("linked_entity_type", "linked_entity_id");
CREATE INDEX IF NOT EXISTS "documents_parent_document_idx" ON "compliance"."documents" ("parent_document_id");
CREATE INDEX IF NOT EXISTS "documents_expiry_date_idx" ON "compliance"."documents" ("expiry_date");
CREATE INDEX IF NOT EXISTS "documents_org_latest_idx" ON "compliance"."documents" ("org_id", "is_latest_version");
