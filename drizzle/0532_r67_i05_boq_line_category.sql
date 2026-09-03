-- R67 lane I, item I-05 (R-177) -- a real Category on a BOQ line, and the
-- org-level list that feeds it.
--
-- Numbered 0532, the next free number after this lane's own 0531 (and
-- 0527_r65_parte_billing_contracts.sql on origin/main). Never renumbered once
-- applied.
--
-- THE DEFECT: category attribution for a BOQ line goes
-- lineItem.activityId -> activity.categoryId -> category.name today (see
-- categoryBoqAmountsReport's own comment: "constructionBoqLineItems has no
-- direct category column of its own"). Most real lines have no activityId at
-- all -- an imported BOQ never has one -- so the Category-wise tab of the Work
-- Progress Report groups nearly everything under "Uncategorized", and the
-- dashboard category charts have almost nothing to plot.
--
-- Both objects ARE declared in src/lib/db/schema.ts (constructionBoqLineItems.
-- category, constructionBoqCategories), so the Migration Schema Drift gate sees
-- them once applied and `bun run db:generate` produces no further diff. The
-- file is hand-written only because it also carries indexes, RLS and the
-- category seed, none of which drizzle-kit emits.
--
-- POST-APPLY VERIFICATION SQL (for the PR description):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'compliance' AND table_name = 'construction_boq_line_items'
--      AND column_name = 'category';
--   -- expect exactly one row
--
--   SELECT count(*) FROM compliance.construction_boq_line_items WHERE category IS NOT NULL;
--   -- expect 0 before any import, and a real count after importing a BOQ
--   -- whose sheet has a Category header
--
--   SELECT org_id, count(*) FROM compliance.construction_boq_categories GROUP BY 1;
--   -- expect 7 per org that has any construction data (Civil, Gypsum,
--   -- Joinery, Paint, Electrical, Plumbing, Misc)

-- ---------------------------------------------------------------------------
-- (1) The column. Nullable: a line with no category is legal and is marked
-- with a "no category" chip in the UI rather than blocking Save.
ALTER TABLE compliance.construction_boq_line_items ADD COLUMN IF NOT EXISTS category text;

-- Supports the Category-wise roll-up and the server-side category filter --
-- both group by this value within one BOQ.
CREATE INDEX IF NOT EXISTS construction_boq_line_items_boq_category_idx
  ON compliance.construction_boq_line_items (boq_id, category);

-- ---------------------------------------------------------------------------
-- (2) The org's editable category list.
--
-- Org-scoped, not project-scoped: a contractor's trade breakdown is a company
-- convention reused on every project. This is deliberately NOT
-- construction_categories, which is the per-PROJECT Category -> Activity
-- progress hierarchy -- a genuinely different concept with a different
-- cardinality (see that table's own schema.ts comment).
--
-- is_active rather than a hard delete: deleting a category that is in use is
-- refused outright ("Used by 12 BOQ lines", enforced in
-- construction-boq-category-service.ts), and retiring an unused one must not
-- orphan the historical lines still carrying its name.
CREATE TABLE IF NOT EXISTS compliance.construction_boq_categories (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness per org: "Civil" and "civil" are the same
-- category to any human reading the report, and allowing both would split one
-- category's subtotal in two. lower() rather than citext -- no extension
-- needed, and it matches how the service compares names.
CREATE UNIQUE INDEX IF NOT EXISTS construction_boq_categories_org_name_unique
  ON compliance.construction_boq_categories (org_id, lower(name));

ALTER TABLE compliance.construction_boq_categories ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_boq_categories FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_construction_boq_categories ON compliance.construction_boq_categories FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- (3) Seed the seven starting categories for every org that has any
-- construction data (a BOQ, or a construction project). Scoped that way rather
-- than seeded onto EVERY organisation in the platform, because most tenants of
-- this ERP are not contractors and a Gypsum category in their settings would
-- be noise.
--
-- INSERT-ONLY AND IDEMPOTENT: guarded by NOT EXISTS on lower(name), so a
-- re-run adds nothing and an org that has already renamed "Misc" to
-- "Miscellaneous" does not get "Misc" back. Not one existing row is updated
-- or deleted.
INSERT INTO compliance.construction_boq_categories (id, org_id, name, sort_order)
SELECT gen_random_uuid()::text, o.org_id, seed.name, seed.sort_order
  FROM (SELECT DISTINCT org_id FROM compliance.construction_boqs) o
 CROSS JOIN (VALUES
         ('Civil', 1),
         ('Gypsum', 2),
         ('Joinery', 3),
         ('Paint', 4),
         ('Electrical', 5),
         ('Plumbing', 6),
         ('Misc', 7)
       ) AS seed(name, sort_order)
 WHERE NOT EXISTS (
         SELECT 1 FROM compliance.construction_boq_categories c
          WHERE c.org_id = o.org_id AND lower(c.name) = lower(seed.name)
       );
