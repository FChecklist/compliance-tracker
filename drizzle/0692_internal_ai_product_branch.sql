-- Audit 37 point 11 ("our AI is used only if we allow"): per-organisation entitlement for the internal AI.
-- DATA ONLY, additive, idempotent: one catalog row in platform.product_branches. No new table or column. An organisation is allowed
-- our AI only when compliance.org_product_branch_enablements has an is_enabled = true row for this branch (default: none, i.e. closed).
-- Shaped on 0547_r68_phase8_img_product_branch.sql. Not applied to any live database by the change that adds it.
INSERT INTO platform.product_branches
  (branch_key, display_name, domain, description, is_active, tagline, icon, status, launch_order, parent_domain, build_tier, host_domain)
VALUES (
  'internal_ai',
  'VERI Internal AI',
  'internal_ai',
  'Permission for an organisation to be served by the platform''s own AI (metered and re-billed). Off by default; the deployment switch PROJEXA_INTERNAL_AI_ENABLED remains the master off.',
  true,
  'Our AI, only where you allow it.',
  'Sparkles',
  'live',
  999,
  NULL,
  'ground_up',
  NULL
)
ON CONFLICT (branch_key) DO NOTHING;
