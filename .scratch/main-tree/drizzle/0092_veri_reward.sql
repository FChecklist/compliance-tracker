-- VERI Reward (gamification + refer-and-earn). Per
-- docs/research/VERI_REWARD_EVALUATION.md and Boss decisions 2026-07-08:
-- on-by-default (bundled free for every org, like 'office'), points-only
-- for now (no cash-payout bridge into sales-engine-service.ts).

-- ============================================================
-- 1. Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.veri_reward_points_ledger (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  user_id text NOT NULL REFERENCES compliance.users(id),
  delta integer NOT NULL,
  source_type text NOT NULL,
  source_id text,
  reason text,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.veri_reward_achievement_definitions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text,
  achievement_key text NOT NULL,
  context text NOT NULL,
  display_name text NOT NULL,
  description text,
  icon text,
  target_value integer NOT NULL,
  points_reward integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.veri_reward_achievement_unlocks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  user_id text NOT NULL REFERENCES compliance.users(id),
  achievement_definition_id text NOT NULL REFERENCES compliance.veri_reward_achievement_definitions(id),
  progress_value integer NOT NULL DEFAULT 0,
  unlocked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(user_id, achievement_definition_id)
);

CREATE TABLE IF NOT EXISTS compliance.veri_reward_streaks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  user_id text NOT NULL REFERENCES compliance.users(id),
  streak_key text NOT NULL,
  current_count integer NOT NULL DEFAULT 0,
  longest_count integer NOT NULL DEFAULT 0,
  last_incremented_at timestamp,
  grace_used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id, streak_key)
);

CREATE TABLE IF NOT EXISTS compliance.veri_reward_referrals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  referrer_user_id text NOT NULL REFERENCES compliance.users(id),
  referral_token text NOT NULL UNIQUE,
  target_type text NOT NULL,
  status text NOT NULL DEFAULT 'clicked',
  referred_org_id text,
  referred_user_id text,
  click_count integer NOT NULL DEFAULT 0,
  reward_points integer,
  clicked_at timestamp,
  signup_completed_at timestamp,
  org_provisioned_at timestamp,
  paid_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veri_reward_points_ledger_org_user ON compliance.veri_reward_points_ledger(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_veri_reward_achievement_definitions_org ON compliance.veri_reward_achievement_definitions(org_id);
CREATE INDEX IF NOT EXISTS idx_veri_reward_achievement_unlocks_org_user ON compliance.veri_reward_achievement_unlocks(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_veri_reward_streaks_org_user ON compliance.veri_reward_streaks(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_veri_reward_referrals_org ON compliance.veri_reward_referrals(org_id);
CREATE INDEX IF NOT EXISTS idx_veri_reward_referrals_token ON compliance.veri_reward_referrals(referral_token);

-- ============================================================
-- 2. RLS -- standard org-scoped pair per table (achievement_definitions
--    is the one exception: platform-default rows have org_id NULL and
--    must stay readable by every org, so it gets its own policy below
--    instead of joining the loop).
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'veri_reward_points_ledger', 'veri_reward_achievement_unlocks',
    'veri_reward_streaks', 'veri_reward_referrals'
  ]
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY app_runtime_org_scoped ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO app_runtime', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO service_role', t);
  END LOOP;
END $$;

ALTER TABLE compliance.veri_reward_achievement_definitions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped_or_platform_default ON compliance.veri_reward_achievement_definitions FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id() OR org_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_veri_reward_achievement_definitions ON compliance.veri_reward_achievement_definitions FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.veri_reward_achievement_definitions TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.veri_reward_achievement_definitions TO service_role;

-- ============================================================
-- 3. Seed: product_branches -- new 'veri_reward' row
-- ============================================================
INSERT INTO compliance.product_branches
  (branch_key, display_name, domain, description, tagline, icon, status, launch_order, parent_domain, build_tier) VALUES
  ('veri_reward', 'VERI REWARD', 'engagement',
   'Gamification (points, achievements, streaks) and refer-and-earn -- usable by a customer''s own team, by VERIDIAN internally, and as a growth lever for every product.',
   'Small wins, instantly felt', 'Trophy', 'live', 100, 'engagement', 'ground_up')
ON CONFLICT (branch_key) DO NOTHING;

-- Mandatory backfill (Boss decision: on-by-default, bundled free for
-- every org, same posture as 'office' in Wave 106 -- an absent row means
-- disabled, so this insert IS the default, not an opt-in).
INSERT INTO compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled, enabled_at)
SELECT o.id, pb.id, true, now()
FROM compliance.organisations o
CROSS JOIN compliance.product_branches pb
WHERE pb.branch_key = 'veri_reward'
  AND NOT EXISTS (
    SELECT 1 FROM compliance.org_product_branch_enablements e
    WHERE e.org_id = o.id AND e.product_branch_id = pb.id
  );

-- ============================================================
-- 4. Seed: platform-default achievement definitions (org_id NULL --
--    visible to every org until overridden). Concrete, low-resistance
--    targets per docs/research/VERI_REWARD_EVALUATION.md §1, not vague
--    "add badges" placeholders.
-- ============================================================
INSERT INTO compliance.veri_reward_achievement_definitions
  (org_id, achievement_key, context, display_name, description, icon, target_value, points_reward) VALUES
  (NULL, 'first_compliance_item', 'product_engagement', 'First Step', 'Complete your first compliance item', 'CheckCircle2', 1, 25),
  (NULL, 'login_streak_3', 'product_engagement', '3-Day Streak', 'Log in 3 days in a row', 'Flame', 3, 20),
  (NULL, 'first_document_upload', 'product_engagement', 'Getting Organized', 'Upload your first document', 'Upload', 1, 15),
  (NULL, 'weekly_task_5', 'product_engagement', 'Weekly Momentum', 'Resolve 5 tasks this week', 'Zap', 5, 30),
  (NULL, 'onboarding_complete', 'product_engagement', 'All Set Up', 'Complete every onboarding step', 'Rocket', 1, 50)
ON CONFLICT DO NOTHING;
