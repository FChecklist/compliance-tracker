-- Wave 106 (Master AI OS): Registry, Rules & Guardrails.
-- Promotes product_branches from a bare catalog (5 columns, 3 rows) into a
-- real product catalog capable of representing ~20 branded "VERI X AI OS"
-- verticals, most of which don't exist yet. Zero vertical business schema
-- in this migration -- see MASTER_AI_OS_ARCHITECTURE.md for the rules this
-- registry now enforces.

-- ============================================================
-- 1. Catalog columns on product_branches
-- ============================================================
ALTER TABLE compliance.product_branches ADD COLUMN IF NOT EXISTS tagline text;
ALTER TABLE compliance.product_branches ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE compliance.product_branches ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned';
ALTER TABLE compliance.product_branches ADD COLUMN IF NOT EXISTS launch_order integer NOT NULL DEFAULT 999;
ALTER TABLE compliance.product_branches ADD COLUMN IF NOT EXISTS parent_domain text;
ALTER TABLE compliance.product_branches ADD COLUMN IF NOT EXISTS build_tier text;

-- ============================================================
-- 2. Backfill catalog metadata on the 3 already-live branches
-- ============================================================
UPDATE compliance.product_branches SET
  tagline = 'Governance, risk, audit, and secretarial compliance -- always on',
  icon = 'ShieldCheck', status = 'live', launch_order = 1, parent_domain = 'office', build_tier = 'repackage'
WHERE branch_key = 'grc';

UPDATE compliance.product_branches SET
  tagline = 'Finance, inventory, and the full buy/sell cycle',
  icon = 'Building2', status = 'live', launch_order = 2, parent_domain = 'office', build_tier = 'repackage'
WHERE branch_key = 'erp';

UPDATE compliance.product_branches SET
  tagline = 'Issues, sprints, and delivery tracking',
  icon = 'Rocket', status = 'live', launch_order = 3, parent_domain = 'office', build_tier = 'repackage'
WHERE branch_key = 'pms';

-- ============================================================
-- 3. VERI OFFICE -- the current bundle, made a first-class catalog row
-- ============================================================
INSERT INTO compliance.product_branches
  (branch_key, display_name, domain, description, tagline, icon, status, launch_order, parent_domain, build_tier) VALUES
  ('office', 'VERI OFFICE AI OS', 'office',
   'The complete business-operations bundle: GRC, Documents, Tickets, VERI MoM, VERI Chat -- always on for every org today.',
   'Run your whole company, one AI at a time', 'Building2', 'live', 0, 'office', 'repackage')
ON CONFLICT (branch_key) DO NOTHING;

-- Mandatory backfill: every existing org must be explicitly marked as
-- having 'office' enabled, since org_product_branch_enablements' own
-- convention treats an absent row as disabled (see
-- product-branch-service.ts's isBranchEnabledForOrg). GRC/core modules
-- have never been gated before this wave, so there is no prior "safe
-- default" the way there is for pms -- this insert IS the safe default,
-- and it must run before any future code path ever checks 'office'.
INSERT INTO compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled, enabled_at)
SELECT o.id, pb.id, true, now()
FROM compliance.organisations o
CROSS JOIN compliance.product_branches pb
WHERE pb.branch_key = 'office'
  AND NOT EXISTS (
    SELECT 1 FROM compliance.org_product_branch_enablements e
    WHERE e.org_id = o.id AND e.product_branch_id = pb.id
  );

-- ============================================================
-- 4. VERI PROCUREMENT -- genuinely already built inside ERP (RFQ,
--    Purchase Orders, Vendor Master, GRN three-way-match), registered as
--    its own catalog entry so it can be marketed/sold as a distinct
--    product even though its modules are the same erp moduleRegistry rows
--    (module-reuse-not-duplication rule -- see MASTER_AI_OS_ARCHITECTURE.md).
-- ============================================================
INSERT INTO compliance.product_branches
  (branch_key, display_name, domain, description, tagline, icon, status, launch_order, parent_domain, build_tier) VALUES
  ('procurement', 'VERI PROCUREMENT AI OS', 'procurement',
   'RFQ (reverse auction, weighted scoring), Purchase Orders, Vendor Master (KYC/banking/sanction screening), GRN three-way-match.',
   'Source, negotiate, and receive -- one procurement engine', 'PackageSearch', 'live', 4, 'erp_family', 'repackage')
ON CONFLICT (branch_key) DO NOTHING;

-- ============================================================
-- 5. Future verticals -- seeded now as 'planned' so the catalog is a real,
--    queryable roadmap table from day one, even with zero UI built yet.
--    No moduleRegistry/productBranchModules rows for any of these --
--    that is genuine per-vertical build work for a future wave.
-- ============================================================
INSERT INTO compliance.product_branches
  (branch_key, display_name, domain, description, tagline, icon, status, launch_order, parent_domain, build_tier) VALUES
  ('ecommerce', 'VERI EASY AI OS', 'ecommerce',
   'Manage every marketplace and storefront a seller operates on, from one place.',
   'One AI, every marketplace', 'ShoppingBag', 'planned', 10, 'commerce', 'ground_up'),
  ('distribution', 'VERI DISTRIBUTION AI OS', 'distribution',
   'End-to-end distribution management on top of VERI ERP''s warehouse/multi-entity/multi-currency core.',
   'Move stock, not spreadsheets', 'Boxes', 'planned', 11, 'erp_family', 'moderate_build'),
  ('export_import', 'VERI EXPORT IMPORT AI OS', 'export_import',
   'Shipping documents, customs, and FEMA-aware export-import management.',
   'Customs, compliant, covered', 'Ship', 'planned', 12, 'erp_family', 'moderate_build'),
  ('pharma_distribution', 'VERI PHARMA DISTRIBUTION AI OS', 'pharma_distribution',
   'Drug-license, batch-expiry, and cold-chain-aware pharmaceutical distribution.',
   'Compliant pharma, batch to bedside', 'Pill', 'planned', 13, 'erp_family', 'moderate_build'),
  ('franchise', 'VERI FRANCHISE AI OS', 'franchise',
   'Franchise agreements, royalty tracking, and multi-territory rollout management.',
   'Every outlet, one playbook', 'Store', 'planned', 14, 'erp_family', 'moderate_build'),
  ('law_firm', 'VERI LAW FIRM AI OS', 'law_firm',
   'Matter management, arbitration, legal spend, and multi-client-entity practice management.',
   'Every matter, every client, one desk', 'Scale', 'planned', 15, 'professional_services', 'moderate_build'),
  ('cs_firm', 'VERI CS FIRM AI OS', 'cs_firm',
   'Statutory registers, cap table, charges, secretarial audit, and MCA e-filing for a CS practice.',
   'Company secretarial, fully automated', 'FileSignature', 'planned', 16, 'professional_services', 'repackage'),
  ('hr', 'VERI HR AI OS', 'hr',
   'Standalone end-to-end HR: recruitment, leave, payroll, performance -- without needing the full VERI OFFICE bundle.',
   'Your people, end to end', 'Users', 'planned', 17, 'people_and_growth', 'repackage'),
  ('sales', 'VERI SALES AI OS', 'sales',
   'Standalone end-to-end sales/CRM: leads, opportunities, pipeline -- without needing the full VERI OFFICE bundle.',
   'Pipeline to close, one system', 'TrendingUp', 'planned', 18, 'people_and_growth', 'repackage'),
  ('manufacturing', 'VERI MANUFACTURING AI OS', 'manufacturing',
   'Bill of materials, routing, work orders, and shop-floor tracking.',
   'From BOM to shipped', 'Factory', 'planned', 20, 'operations', 'ground_up'),
  ('construction', 'VERI CONSTRUCTION AI OS', 'construction',
   'Site/subcontractor tracking, RA bills, retention money, and project costing for construction.',
   'Every site, one ledger', 'HardHat', 'planned', 21, 'operations', 'ground_up'),
  ('logistics', 'VERI LOGISTICS AI OS', 'logistics',
   'Fleet, route, and freight management.',
   'Every shipment, tracked', 'Truck', 'planned', 22, 'operations', 'ground_up'),
  ('facilities_management', 'VERI FM AI OS', 'facilities_management',
   'Facilities management and security guard services: assets, tickets, guard-shift rostering. Not yet built -- zero existing schema.',
   'Every building, every shift, covered', 'ShieldCheck', 'planned', 23, 'operations', 'ground_up'),
  ('healthcare', 'VERI HEALTHCARE AI OS', 'healthcare',
   'Patient records, appointments, and medical billing for a mid-size hospital or nursing home. Requires dedicated regulatory research before build.',
   'Run your hospital, care for your patients', 'HeartPulse', 'planned', 30, 'industry_verticals', 'ground_up'),
  ('school', 'VERI SCHOOL AI OS', 'school',
   'Student records, admissions, fee management, and timetabling for a school or group of schools.',
   'Every student, every class, one system', 'GraduationCap', 'planned', 31, 'industry_verticals', 'ground_up'),
  ('hotel', 'VERI HOTEL AI OS', 'hotel',
   'Room inventory, bookings, and channel-manager integration for a hotel, resort, or group.',
   'Every room, every guest, one system', 'BedDouble', 'planned', 32, 'industry_verticals', 'ground_up'),
  ('restaurant', 'VERI RESTAURANT AI OS', 'restaurant',
   'POS, menu, table management, and kitchen-display for a restaurant.',
   'Every table, every ticket, one system', 'UtensilsCrossed', 'planned', 33, 'industry_verticals', 'ground_up')
ON CONFLICT (branch_key) DO NOTHING;
