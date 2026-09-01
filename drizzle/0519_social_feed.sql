-- Task #47 (PM feature-parity gap analysis): genuine broadcast/react social
-- feed. reply-threads (compliance.comments, polymorphic entity_id/
-- entity_type) and private messaging (compliance.conversations/
-- conversation_participants/messages) already existed on main -- this adds
-- the missing third piece.
--
-- post_comments deliberately does NOT reuse compliance.comments' polymorphic
-- entity_id/entity_type shape -- posts are one new, single entity type, so a
-- direct post_id FK is simpler and just as real; post_audience_members
-- mirrors compliance.conversation_participants' explicit-join-table
-- audience/participant model instead of a jsonb array, for the same
-- queryability reasons that table was built that way.
--
-- Hand-written, NOT drizzle-kit's raw `generate` output -- same reason as
-- 0268_pms_time_entry_approval_flow.sql's own header (drizzle/meta/ is
-- missing per-migration snapshots between 0001 and 0264).

DO $$ BEGIN
  CREATE TYPE compliance.post_audience_type AS ENUM ('org', 'restricted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Fixed, small reaction taxonomy -- a real Postgres enum, not free text.
DO $$ BEGIN
  CREATE TYPE compliance.post_reaction_type AS ENUM ('like', 'celebrate', 'support', 'insightful', 'curious');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.posts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  author_id text NOT NULL,
  body text NOT NULL,
  project_id text, -- optional link
  task_id text, -- optional link
  -- 'org': visible to every member of org_id. 'restricted': visible only to
  -- the author + rows in post_audience_members.
  audience_type compliance.post_audience_type NOT NULL DEFAULT 'org',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS posts_org_created_idx ON compliance.posts (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_project_id_idx ON compliance.posts (project_id);
CREATE INDEX IF NOT EXISTS posts_task_id_idx ON compliance.posts (task_id);

CREATE TABLE IF NOT EXISTS compliance.post_audience_members (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  post_id text NOT NULL,
  user_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT post_audience_members_post_user_unique UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS post_audience_members_post_id_idx ON compliance.post_audience_members (post_id);
-- Drives "which restricted posts can this user see" without scanning every post.
CREATE INDEX IF NOT EXISTS post_audience_members_user_id_idx ON compliance.post_audience_members (user_id);

CREATE TABLE IF NOT EXISTS compliance.post_reactions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  post_id text NOT NULL,
  user_id text NOT NULL,
  reaction_type compliance.post_reaction_type NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  -- One reaction per user per post -- the service layer replaces/toggles,
  -- never inserts a second row for the same (post_id, user_id).
  CONSTRAINT post_reactions_post_user_unique UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS post_reactions_post_id_idx ON compliance.post_reactions (post_id);

CREATE TABLE IF NOT EXISTS compliance.post_comments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  post_id text NOT NULL,
  author_id text NOT NULL,
  content text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_comments_post_id_idx ON compliance.post_comments (post_id);

-- Row Level Security -- matching 0269_construction_progress_claims_workflow.sql's
-- established app_runtime_tenant_isolation + service_role_bypass pattern.
-- post_audience_members/post_reactions/post_comments carry no org_id of
-- their own (same as conversation_participants/messages scoping indirectly
-- through conversation_id) -- tenant isolation for those three is enforced
-- by the service layer always joining through posts.org_id first, exactly
-- like chat-service.ts does via conversation_id today.
ALTER TABLE compliance.posts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.posts FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_posts ON compliance.posts FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.post_audience_members ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_full_access ON compliance.post_audience_members FOR ALL TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_post_audience_members ON compliance.post_audience_members FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.post_reactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_full_access ON compliance.post_reactions FOR ALL TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_post_reactions ON compliance.post_reactions FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.post_comments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_full_access ON compliance.post_comments FOR ALL TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_post_comments ON compliance.post_comments FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
