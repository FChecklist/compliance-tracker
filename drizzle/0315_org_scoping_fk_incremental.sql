-- VERIDIAN Review Framework gap-closure ([Medium] Low Coupling/High
-- Cohesion, AI Engineering Quality / Code Structure & Modularity,
-- 2026-08-15): "Data-layer coupling is implicit, not enforced." Real gap --
-- 323 orgId columns across schema.ts, zero DB-level FK constraints to
-- organisations.id. This adds real FK constraints for the 3 highest-
-- traffic org-scoped tables, incrementally, per the finding's own
-- recommended approach ("Add FK constraints incrementally... starting
-- with org/user scoping") rather than all 323 at once.
--
-- Hand-written, NOT `bun run db:generate` output: this repo's local
-- drizzle/meta snapshot is stale relative to schema.ts (a pre-existing
-- side effect of many concurrent sessions each generating migrations off
-- their own branch's snapshot baseline before merging -- see
-- ai-os/boss/ACTIVE-CLAIMS.yaml's migration-collision precedent).
-- `drizzle-kit generate` in this workspace produced a migration that tried
-- to re-create ~15 tables that already exist under other migration
-- numbers (0279-0314) -- that output was discarded rather than committed;
-- this file contains only the 3 genuinely new ALTER TABLE statements,
-- hand-verified against the actual current schema.ts. Flagging the stale-
-- snapshot issue itself as a separate real observation, not silently
-- worked around: a future session/owner should reconcile drizzle/meta's
-- snapshot state against schema.ts directly (out of scope for this task).
--
-- NOT VALID: adds the constraint so it's enforced on every new/updated
-- row immediately, WITHOUT scanning/validating existing rows at migration
-- time (avoids a long table lock and avoids this migration failing on
-- unverified orphan data this session has no live DB access to check).
-- Run `ALTER TABLE ... VALIDATE CONSTRAINT ...` as a separate, later step
-- once orphan-free data is confirmed -- see the 3 commented commands at
-- the bottom of this file.
--
-- NOT run against the live database from this session (`db:push`/`migrate`
-- is a hard-to-reverse, outward-facing production action outside this
-- task's authorization) -- this file is the reviewable PR artifact; the
-- owner/deploy step applies it per the normal process.

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

ALTER TABLE "compliance"."compliance_items"
  ADD CONSTRAINT "compliance_items_org_id_organisations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "compliance"."organisations"("id")
  ON DELETE no action ON UPDATE no action NOT VALID;

-- Follow-up (run manually once orphan-free data is confirmed -- NOT part
-- of this migration, deliberately, since each VALIDATE does a full table
-- scan and should be run/timed independently by whoever owns the live DB):
--   ALTER TABLE "compliance"."departments" VALIDATE CONSTRAINT "departments_org_id_organisations_id_fk";
--   ALTER TABLE "compliance"."users" VALIDATE CONSTRAINT "users_org_id_organisations_id_fk";
--   ALTER TABLE "compliance"."compliance_items" VALIDATE CONSTRAINT "compliance_items_org_id_organisations_id_fk";
