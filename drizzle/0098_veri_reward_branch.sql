-- Wave 113: VERI Treasure (branchKey='veri_reward') -- registers the
-- gamification + refer-and-earn module (points ledger, achievements,
-- streaks, referrals -- schema already added in 0092_veri_reward.sql) as a
-- real product_branches catalog row, and marks it free/on-by-default for
-- every existing org, mirroring 0084's own 'office' backfill exactly
-- (org_product_branch_enablements treats an absent row as disabled, so
-- this insert IS the safe default for a free-everywhere branch).
--
-- Boss decision 2026-07-08: free in every product AND sellable/marketable
-- as its own standalone module -- same "one productBranches row, always
-- enabled" shape as 'office', not an opt-in branch like 'pms'.
INSERT INTO compliance.product_branches
  (branch_key, display_name, domain, description, tagline, icon, status, launch_order, parent_domain, build_tier) VALUES
  ('veri_reward', 'VERI TREASURE', 'veri_reward',
   'Gamification and refer-and-earn for every VERIDIAN product: points, achievements, streaks, and referral rewards -- one shared points ledger across team engagement, HR performance, and growth.',
   'Every win, worth something', 'Gem', 'live', 1, 'people_and_growth', 'ground_up')
ON CONFLICT (branch_key) DO NOTHING;

-- Mandatory backfill for every existing org, same reasoning as 'office':
-- this branch has never been gated before this wave, so there is no prior
-- "safe default" other than this insert itself.
INSERT INTO compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled, enabled_at)
SELECT o.id, pb.id, true, now()
FROM compliance.organisations o
CROSS JOIN compliance.product_branches pb
WHERE pb.branch_key = 'veri_reward'
  AND NOT EXISTS (
    SELECT 1 FROM compliance.org_product_branch_enablements e
    WHERE e.org_id = o.id AND e.product_branch_id = pb.id
  );

-- New orgs going forward are auto-enabled at signup time in
-- autoProvisionUser() (src/lib/supabase/auth-guard.ts) -- this migration
-- only needs to cover orgs that already existed before this wave.
