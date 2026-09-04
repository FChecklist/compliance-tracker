-- R74 Y1-08: agent register. One row per dispatched agent, proving every
-- claim was PM-verified against a real artefact (GY-03), and that every
-- agent worked in its own worktree (GY-02).
CREATE TABLE platform.r74_agent_register (
  agent_id text PRIMARY KEY,
  task text NOT NULL,
  work_class text NOT NULL CHECK (work_class IN ('GATHER','BUILD','JUDGE')),
  model text NOT NULL,
  worktree_path text,
  branch text,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  points_claimed text[],
  points_pm_verified text[],
  incidents jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome text CHECK (outcome IN ('SUCCESS','DRIFT','LOOP','STALL','HALLUCINATION','BUDGET','RECALLED', NULL))
);

COMMENT ON TABLE platform.r74_agent_register IS 'R74 Y1-08: one row per dispatched agent, per that phase''s own requirement -- proves every agent claim was checked (GY-03).';
