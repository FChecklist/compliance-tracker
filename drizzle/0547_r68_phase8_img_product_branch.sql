-- R68 (Institutional Memory Graph) Phase 8, IMG-031 -- IMG AS A SEPARATELY
-- ENTITLEABLE PRODUCT.
--
-- Requirement 4, in the owner's own words: "institutional memory is a software
-- feature, its a module embedded in veridian ai os erp and all its processes
-- and products. it can be offered as a standalone product also."
--
-- Phases 1-7 built institutional memory as something every organisation simply
-- HAS. This migration is what makes it a thing an organisation can be entitled
-- to. It is pure DATA -- three inserts into three tables that already exist --
-- because the entitlement substrate already exists and is already live:
-- platform.product_branches (27 rows before this), platform.module_registry
-- (110 before this), platform.product_branch_modules (94 before this), and
-- compliance.org_product_branch_enablements. No new table, no new column, and
-- no second notion of "enabled" is introduced anywhere.
--
-- IMG-031's what_not_to_do is one line -- "Do not fork the codebase to make a
-- standalone build" -- and this is the alternative to forking: a branch row in
-- the same catalog every other vertical uses, gated by the same
-- isBranchEnabledForOrg() rules, so "standalone IMG" is an entitlement
-- configuration rather than a second source of truth.
--
-- IDEMPOTENT. Every insert is ON CONFLICT DO NOTHING against a real existing
-- unique constraint (product_branches_branch_key_key,
-- module_registry_module_key_key,
-- product_branch_modules_product_branch_id_module_key_key), so replaying this
-- migration from empty -- which E-103's from-empty replay actually does -- is
-- safe and produces exactly the same three rows.

-- ─── 1. The product branch ───────────────────────────────────────────────
--
-- Shaped from the real 27 rows already in this table, not invented:
--   status='live'        -- IMG is built and running (Phases 1-7 are merged),
--                           the same claim 'erp'/'pms'/'the_firm' make. Not
--                           'building' (that is construction/fm, still mid-
--                           build) and not 'planned'.
--   launch_order=999     -- the value this table already uses for a
--                           CROSS-CUTTING capability rather than a vertical in
--                           the launch sequence: 'veri_chat_v2' (platform_ui)
--                           and 'projexa' both sit at 999. IMG is embedded in
--                           every branch, so it has no place in an ordering of
--                           verticals.
--   parent_domain=NULL   -- same reason, and the same choice 'veri_chat_v2'
--                           made. IMG is not a member of the erp_family /
--                           professional_services / operations groupings; it
--                           runs underneath all of them.
--   build_tier='ground_up' -- honest: R68 built the bitemporal store, the
--                           scope resolver, the four-tier recall ladder, the
--                           embedding spaces and the write-path gate from
--                           scratch. Nothing here was a repackage.
--   host_domain=NULL     -- IMG has no dedicated pre-login brand host of its
--                           own; a standalone IMG org resolves through the
--                           platform default (org-branding-service.ts's
--                           DEFAULT_BRAND_NAME), exactly like every other
--                           branch except 'office' and 'projexa'.
--   icon='Brain'         -- a real lucide-react export, matching this column's
--                           documented convention (icons imported by name in
--                           AppSidebar.tsx, never an asset path).
INSERT INTO platform.product_branches
  (branch_key, display_name, domain, description, is_active, tagline, icon, status, launch_order, parent_domain, build_tier, host_domain)
VALUES (
  'institutional_memory',
  'VERI Institutional Memory',
  'institutional_memory',
  'The organisation''s durable, bitemporal memory: what was decided, by whom, when it became true, when it stopped being true, and what it superseded. Embedded in every VERIDIAN AI OS branch and its processes, and separately entitleable as a standalone product. Four-tier recall (exact / keyword / vector / graph-expanded) where only the exact tier may auto-execute; every write passes a server-side three-boolean authorisation gate; per-tenant only, with no cross-organisation pooling of content.',
  true,
  'Your organisation already decided this. Now it can remember.',
  'Brain',
  'live',
  999,
  NULL,
  'ground_up',
  NULL
)
ON CONFLICT (branch_key) DO NOTHING;

-- ─── 2. The modules IMG actually consists of ─────────────────────────────
--
-- module_registry's own convention is one row per REAL TABLE (see its
-- table_name column, NOT NULL, and every one of the 110 existing rows). So
-- these are the three tables IMG genuinely owns, and only those:
--
--   compliance.memory_records  -- the memory itself
--   compliance.memory_versions -- Phase 1's bitemporal lineage / supersession
--   compliance.memory_sources  -- Phase 6's provenance
--
-- DELIBERATELY NOT REGISTERED HERE, though the recall ladder reads them:
-- compliance.embeddings, compliance.document_chunk, platform.graph_node and
-- platform.graph_edge. IMG READS those; it does not own them. They are shared
-- platform substrate (R65 Part C's embeddings, R67 Part B's graph), and
-- claiming them as IMG modules would tell the catalog that disabling IMG
-- should disable the graph -- which is false, and is exactly the kind of drift
-- module_registry exists to prevent.
--
-- domain='institutional_memory' matches the branch's own domain, the same way
-- erp modules carry domain='erp' and fm modules carry
-- domain='facilities_management'. category='MEMORY' is a new value in this
-- column, which is normal for this table -- category is free text validated at
-- the service layer, never a Postgres enum (schema.ts's own note on
-- moduleRegistry.category), and every branch onboarded so far added its own.
-- is_core=true: an IMG deployment without any one of these three is not a
-- reduced IMG, it is a broken one -- memory_records alone cannot supersede,
-- and without memory_sources a Phase 6 write cannot record where a fact came
-- from.
INSERT INTO platform.module_registry (module_key, display_name, table_name, domain, category, description, is_core, is_active)
VALUES
  ('memory_records',  'Institutional Memory Records', 'memory_records',  'institutional_memory', 'MEMORY',
   'Bitemporal record of what the organisation knows: scope (GLOBAL/ORGANIZATION/DEPARTMENT/USER), lifecycle state, confidence, provenance, and valid-time interval. Append-only under the Phase 1 trigger.', true, true),
  ('memory_versions', 'Memory Version History',       'memory_versions', 'institutional_memory', 'MEMORY',
   'Supersession lineage and attribution for every change to a memory record, including the originating model id and prompt hash for AI-authored writes.', true, true),
  ('memory_sources',  'Memory Provenance Sources',    'memory_sources',  'institutional_memory', 'MEMORY',
   'What a memory came from -- conversation, task, document, sheet row or a manual statement -- so a recalled fact can always be traced back to the work that produced it.', true, true)
ON CONFLICT (module_key) DO NOTHING;

-- ─── 3. Wire the modules to the branch ───────────────────────────────────
--
-- Resolved by branch_key rather than a hardcoded id: product_branches.id is
-- (gen_random_uuid())::text, so it differs per environment, and IMG-031's own
-- input_contract warns that this migration must work against the real catalog
-- rather than against ids captured on one machine. Same reason the module_key
-- side is the natural key -- product_branch_modules.module_key is an FK on
-- module_registry.module_key, not on module_registry.id.
INSERT INTO platform.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, m.module_key, true
FROM platform.product_branches pb
CROSS JOIN (VALUES ('memory_records'), ('memory_versions'), ('memory_sources')) AS m(module_key)
WHERE pb.branch_key = 'institutional_memory'
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
