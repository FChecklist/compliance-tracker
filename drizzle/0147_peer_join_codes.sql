-- Area 15 (U-D27.B3.S1, "4 distinct invitation paths"): Path D --
-- peer-provided-code self-registration. Same redemption mechanism as
-- Path C (org_join_codes / org-join-code-service.ts, PR #182); the only
-- schema change is `created_by_role`, so admin-minted and peer-minted
-- codes are distinguishable in the data. See org-join-code-service.ts's
-- header comment for the full privilege-escalation reasoning: the
-- previous flat "admin or manager" gate on POST /api/join-codes is
-- replaced by a rank-ceiling check (any authenticated org member may
-- mint a code, but only for a role at or below their own ROLE_RANK),
-- and non-privileged (rank < manager) mints get a forced expiry
-- (14-day default, 30-day max) plus a 3-active-codes-per-creator cap --
-- neither of which applied to the existing admin/manager path, which is
-- unchanged.

ALTER TABLE compliance.org_join_codes
  ADD COLUMN IF NOT EXISTS created_by_role text NOT NULL DEFAULT 'admin';

-- Backs countActiveCodesForCreator's per-creator active-code lookup
-- (org_id + created_by_user_id), run on every peer mint attempt.
CREATE INDEX IF NOT EXISTS idx_org_join_codes_org_creator ON compliance.org_join_codes(org_id, created_by_user_id);
