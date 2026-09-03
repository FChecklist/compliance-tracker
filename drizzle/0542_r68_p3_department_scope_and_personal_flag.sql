-- R68 (Institutional Memory Graph) Phase 3 -- scope resolver.
--
-- Owner decision 2026-09-03 (full decision authority granted, monetary
-- spend excepted): v1 ships exactly FOUR of the five scope levels the R68
-- study's img_spec (IMG-012..IMG-015) laid out -- GLOBAL, ORGANIZATION,
-- DEPARTMENT, USER. PRODUCT is deliberately deferred (product_branches
-- integration is real additional scope, not yet proven necessary) --
-- NOT added to the CHECK below, on purpose: a CHECK value with no resolver
-- logic behind it is dead surface, not forward-compatibility (see this
-- migration's own header on why DEPARTMENT alone is added).
--
-- This REVISES the R68 study's own tentative recommendation, which had
-- assumed compliance.departments did not exist -- it does, 385 real rows,
-- verified live before this migration was written, which is what makes
-- DEPARTMENT materially cheaper than that recommendation assumed (see
-- img_spec point IMG-015's own note to that effect).
--
-- Two independent, additive changes, both expand-only per AR-11 (never
-- remove or narrow an existing CHECK value or an existing row's
-- visibility):
--
-- 1. DEPARTMENT joins the memory_records_scope_type_check CHECK (was 8
--    values, now 9). No new column is needed to carry "which department" --
--    scope_id is already the polymorphic pointer whose meaning depends on
--    scope_type (see schema.ts's own comment on memoryRecords.scopeId,
--    "same shape as platformAssets.sourceTable/sourceId"), exactly the
--    same convention PROJECT/TASK/CONVERSATION/DOCUMENT already use --
--    DEPARTMENT reuses it rather than adding a dedicated department_id
--    column, so this really is the cheap, additive change the owner's
--    decision describes. Postgres has no "add one value to an existing
--    CHECK" primitive, so the constraint is dropped and recreated with the
--    same name and the one additional value -- not a narrowing, every
--    previously-legal value is still legal.
--
-- 2. `is_personal` (new boolean column, NOT NULL DEFAULT false) plus a
--    SELECT-RLS rewrite. Real, live gap this closes: R65 Part C Phase 3's
--    searchMemories() (src/lib/services/memory-service.ts) already has a
--    `requestingUserId` option whose own comment says plainly "Phase 1's
--    RLS enforces 'own org or global' at the database level... but two
--    different users in the SAME org both pass that check equally, so RLS
--    alone cannot stop teammate A's chat from surfacing teammate B's
--    personal USER-scope preference" -- and that filter is APPLICATION
--    CODE, opt-in per caller, exactly the shape CRR-234 (binding ruling on
--    the sibling three-ledger model for compliance.source_object /
--    connector_accounts -- "Enforce ledger visibility in RLS, not in
--    application code") says not to build. A caller that forgets to pass
--    requestingUserId today gets teammate B's personal row back.
--
--    This does not reimplement CRR-233's full three-ledger model
--    (org_common/user_official/user_personal, with an explicit-grant path
--    for user_official) -- that model is CRR-233/234/235's own mandate for
--    compliance.source_object/connector_accounts, a different feature, and
--    is itself not yet built there (verified live: no `ledger` column
--    exists on compliance.source_object as of this migration). Building
--    that full grant machinery here, unrequested, for a table where
--    IMG-014's own gate is only "org-scoped recall must never return a
--    personal row" would be exactly the "dead surface" this migration's
--    own header just argued against for PRODUCT. Instead this folds the
--    same "user_personal never leaks" guarantee into the narrower shape
--    IMG-014 actually asks for: a single boolean on the existing USER
--    scope_type (the R68 Phase 3 directive's own words: "this may fold
--    into how USER-scope rows are marked private vs shared"), enforced in
--    RLS.
--
--    Semantics: is_personal=false (the default, and every pre-existing
--    row) keeps EXACTLY today's visibility -- no regression for any row
--    that already exists. is_personal=true additionally requires
--    user_id = compliance.current_user_id() to be visible at all,
--    regardless of org membership -- "no grant path", matching CRR-234's
--    own wording for the personal tier. The is_personal_requires_user_scope
--    CHECK below keeps this concept anchored to USER scope only (a
--    GLOBAL/ORGANIZATION/DEPARTMENT row can never be marked personal --
--    "personal to nobody in particular" is not a meaningful state).
--
-- Real resolver code (the one server-side GLOBAL -> ORGANIZATION ->
-- DEPARTMENT -> USER, most-specific-wins function IMG-013 asks for) lives
-- in src/lib/services/memory-service.ts (resolveMemoryScope /
-- resolveMostSpecific) -- confirmed via information_schema.routines
-- before this migration was written that zero memory/recall/scope DB
-- routines exist, so that resolver is plain server-side TypeScript, not a
-- Postgres function, per the directive's own "server-side only" wording
-- (an application server, not a client -- not "must be a DB routine").

-- ─── 1. DEPARTMENT scope ────────────────────────────────────────────────
ALTER TABLE "compliance"."memory_records" DROP CONSTRAINT "memory_records_scope_type_check";
--> statement-breakpoint
ALTER TABLE "compliance"."memory_records" ADD CONSTRAINT "memory_records_scope_type_check"
  CHECK ("scope_type" IN ('GLOBAL','INDUSTRY','ORGANIZATION','USER','PROJECT','TASK','CONVERSATION','DOCUMENT','DEPARTMENT'));
--> statement-breakpoint

-- ─── 2. user_personal flag + RLS ────────────────────────────────────────
ALTER TABLE "compliance"."memory_records" ADD COLUMN "is_personal" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "compliance"."memory_records" ADD CONSTRAINT "memory_records_personal_requires_user_scope_check"
  CHECK (NOT "is_personal" OR ("scope_type" = 'USER' AND "user_id" IS NOT NULL));
--> statement-breakpoint

-- Supports the new RLS predicate's `user_id = compliance.current_user_id()`
-- branch -- partial (only rows that can actually hit that branch), same
-- "index the predicate, not the whole column" convention as
-- idx_memory_records_superseded_by_id.
CREATE INDEX IF NOT EXISTS "idx_memory_records_user_id_personal" ON "compliance"."memory_records" ("user_id") WHERE "is_personal";
--> statement-breakpoint

-- Replaces the Phase 1 SELECT policy in place (same name -- every other
-- policy/grant on memory_records/memory_sources/memory_versions from
-- drizzle/0520 is untouched, this migration touches exactly the one
-- clause CRR-234's rule bears on). DROP POLICY IF EXISTS + CREATE POLICY
-- (rather than Phase 1's own CREATE-inside-a-duplicate_object-guard style)
-- is the correct idempotent form for a policy this migration intends to
-- actually CHANGE, not merely ensure-exists.
DROP POLICY IF EXISTS "app_runtime_org_scoped" ON "compliance"."memory_records";
--> statement-breakpoint
CREATE POLICY "app_runtime_org_scoped" ON "compliance"."memory_records" FOR SELECT TO app_runtime USING (
  (org_id = compliance.current_org_id() OR org_id IS NULL)
  AND (NOT is_personal OR user_id = compliance.current_user_id())
);
