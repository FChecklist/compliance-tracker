-- R80 Part 2 step 1b -- persist the software-vs-AI split per submission.
--
-- WHY: the 95/5 target could be neither substantiated nor refuted because
-- nothing measured it. Step 1a (ct 5b2ef432) made the live typed path COMPUTE
-- the numbers -- dry-run.ts previously discarded modelCalls/cacheHits outright.
-- This makes them durable so the ratio can be read back rather than inferred.
--
-- ADDITIVE ONLY (Addendum B GG-03), reviewed by the R81 session before running:
--   * seven new columns, every one NULLABLE
--   * no drop, no rename, no type narrowing, no NOT NULL on a populated table
--   * all 50 existing rows keep NULL and are NOT backfilled -- inventing values
--     would fabricate history. Same posture as 0525's own header for
--     `classification`.
--
-- level1_refusal_code IS A CLOSED CODE, NOT AN ERROR MESSAGE, and that is
-- deliberate. Raw err.message text routinely carries connection strings,
-- tokens and request payloads, and under the owner's one-database ruling this
-- column is production the instant it is written -- a code cannot leak a
-- credential, a message can, and the leak would only be discovered by grepping
-- the column later. A code is also the only form that answers the question the
-- column exists for: "how often did L1 refuse, and why" needs GROUP BY, which a
-- sentence cannot serve. Detail belongs in logs, not in a shared-DB column.
--
-- Both CHECKs are NOT VALID on purpose: they constrain future writes without
-- scanning or rejecting the existing rows, which is the additive-safe form.
-- Both are wrapped in DO/EXCEPTION because Postgres has NO
-- `ADD CONSTRAINT IF NOT EXISTS` -- a bare ADD CONSTRAINT raises 42710
-- duplicate_object on any second application, which would destroy the
-- idempotency the ADD COLUMN IF NOT EXISTS lines above give. This file must be
-- safe to re-run: the table exists live AND CI replays every migration from
-- empty.

ALTER TABLE compliance.submissions
  ADD COLUMN IF NOT EXISTS level                 smallint,
  ADD COLUMN IF NOT EXISTS source                text,
  ADD COLUMN IF NOT EXISTS l0_hit_rate           numeric(5,4),
  ADD COLUMN IF NOT EXISTS model_calls           integer,
  ADD COLUMN IF NOT EXISTS cache_hits            integer,
  ADD COLUMN IF NOT EXISTS level1_outcome        text,
  ADD COLUMN IF NOT EXISTS level1_refusal_code   text;

DO $$
BEGIN
  ALTER TABLE compliance.submissions
    ADD CONSTRAINT submissions_level1_outcome_check
    CHECK (level1_outcome IS NULL OR level1_outcome IN
           ('resolved','refused','not_needed','error'))
    NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE compliance.submissions
    ADD CONSTRAINT submissions_level1_refusal_code_check
    CHECK (level1_refusal_code IS NULL OR level1_refusal_code IN
           ('provider_not_allowed','provider_unset','user_not_permitted',
            'provider_unreachable','budget_exceeded','unknown'))
    NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN compliance.submissions.level1_refusal_code IS
  'Closed vocabulary. NEVER store a raw error message here -- see this migration''s header.';
