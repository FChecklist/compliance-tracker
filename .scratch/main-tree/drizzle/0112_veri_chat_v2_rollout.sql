-- Wave 131: roll out 'veri_chat_v2' (VERI Chat persistent composer) from a
-- single demo-only org to every org, platform-wide -- Boss decision
-- 2026-07-09 ("implement it across the VERIDIAN AI OS in all the
-- products"). Mirrors 0098_veri_reward_branch.sql's own rollout shape
-- exactly (mark 'live', backfill every existing org, auto-enable future
-- orgs at signup -- see src/lib/supabase/auth-guard.ts's autoProvisionUser()).
--
-- Free/on-by-default like 'veri_reward'/'office', not opt-in like 'pms':
-- this is the shell UI (composer + panel), not a product vertical a org
-- chooses to buy -- it should look the same everywhere VERIDIAN AI OS runs.
UPDATE compliance.product_branches
SET status = 'live'
WHERE branch_key = 'veri_chat_v2';

-- Backfill every existing org that doesn't already have a row (the demo org
-- already does, from 0095 -- ON CONFLICT-safe via NOT EXISTS same as 0098).
INSERT INTO compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled, enabled_at)
SELECT o.id, pb.id, true, now()
FROM compliance.organisations o
CROSS JOIN compliance.product_branches pb
WHERE pb.branch_key = 'veri_chat_v2'
  AND NOT EXISTS (
    SELECT 1 FROM compliance.org_product_branch_enablements e
    WHERE e.org_id = o.id AND e.product_branch_id = pb.id
  );
