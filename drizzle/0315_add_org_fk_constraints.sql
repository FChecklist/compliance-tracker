-- VERIDIAN Review Framework gap-closure, AI Engineering Quality / Code
-- Structure & Modularity ([Medium] "Low Coupling / High Cohesion" --
-- "Data-layer coupling is implicit, not enforced"). Incremental start on
-- real DB-level FK enforcement for org/user scoping, the highest-traffic
-- relationship in this schema (see schema.ts's departments/users/
-- complianceItems orgId comments for the matching column-level change).
--
-- Hand-written, NOT `drizzle-kit generate` output: this repo's local
-- drizzle/meta/_journal.json is missing entries for migrations
-- 0312-0314 (present as .sql files on disk but never recorded in the
-- journal, likely a separate concurrent-session artifact -- same
-- "stale local ref" class of issue check-migration-collision.mjs's own
-- header documents for merge-base resolution, but for the meta snapshot
-- instead of git). Running `drizzle-kit generate` against that drifted
-- journal produced a bogus migration that tried to re-CREATE TABLE
-- several already-existing tables; discarded rather than committed. This
-- file's own drift (unrelated to the 3 real column changes below) is
-- flagged here for whoever next needs to run `drizzle-kit generate` in
-- this repo -- it will likely reproduce the same false diff until the
-- journal is reconciled with the migrations already on disk.
--
-- NOT VALID + a separate VALIDATE CONSTRAINT step (rather than a plain
-- ADD CONSTRAINT, which validates every existing row synchronously and
-- fails the whole migration on the first orphaned org_id): safe to run
-- against a live table with existing data of unknown integrity. The
-- ADD CONSTRAINT ... NOT VALID step only takes a brief metadata lock and
-- starts enforcing the constraint for all NEW/UPDATED rows immediately;
-- VALIDATE CONSTRAINT is a separate, resumable, non-blocking-to-writers
-- pass that checks existing rows and can be safely re-run if it fails
-- partway (e.g. on a genuinely orphaned row that needs a data fix first).
-- Do not run VALIDATE CONSTRAINT in the same deploy as ADD CONSTRAINT
-- without first confirming (e.g. a one-off SELECT anti-join query) that
-- no orphaned org_id values exist in compliance_items/departments/users.

ALTER TABLE "compliance"."compliance_items"
  ADD CONSTRAINT "compliance_items_org_id_organisations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "compliance"."organisations"("id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint

ALTER TABLE "compliance"."departments"
  ADD CONSTRAINT "departments_org_id_organisations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "compliance"."organisations"("id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint

ALTER TABLE "compliance"."users"
  ADD CONSTRAINT "users_org_id_organisations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "compliance"."organisations"("id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint

-- Deliberately NOT run here as part of the same statement batch -- see
-- header. Run these individually once orphan-free is confirmed for each
-- table (they can land in a later, separate migration/maintenance step):
--   ALTER TABLE "compliance"."compliance_items" VALIDATE CONSTRAINT "compliance_items_org_id_organisations_id_fk";
--   ALTER TABLE "compliance"."departments" VALIDATE CONSTRAINT "departments_org_id_organisations_id_fk";
--   ALTER TABLE "compliance"."users" VALIDATE CONSTRAINT "users_org_id_organisations_id_fk";
