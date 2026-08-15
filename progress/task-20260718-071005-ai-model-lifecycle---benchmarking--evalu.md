# PROGRESS -- task-20260718-071005-ai-model-lifecycle---benchmarking--evalu

VERIDIAN Review Framework gap-closure: AI Model Lifecycle & Benchmarking / Evaluation & Promotion Process.

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, registered this task's own claim
      (no overlapping in-flight work found), pushed it ahead of the real
      work commit per that file's own protocol.
- [x] Re-verified both findings against current main (per task instructions
      -- do not trust the original evaluation's gap description blindly):
  - **Finding 1 (High, roster.ts evaluation gate) -- ALREADY RESOLVED.**
    PR #417 (merged 2026-07-19) added `.github/workflows/ai-prompt-evals.yml`,
    which runs `promptfoo eval -c promptfooconfig.yaml` on every PR whose
    diff touches `src/lib/ai-team/roster.ts` (confirmed live: the
    workflow's `on.pull_request.paths` list includes
    `src/lib/ai-team/roster.ts`). This is the literal recommended approach
    ("Add a CI check requiring recent promptfoo results for roster.ts
    diffs"). Honest limitation already documented in that workflow's own
    header (same class as every other CI gate in this repo): it runs and
    can fail, but making it a *required* branch-protection status check is
    an Owner-only repo-admin setting. **No code change made for this
    finding** -- would be an unnecessary duplicate per this task's own
    instructions.
  - **Finding 2 (Critical, A/B or shadow-testing capability) -- CONFIRMED
    REAL GAP, then implemented.** Grepped `rollout|candidate|shadow` across
    roster.ts/team-service.ts/model-tier-eligibility.ts/dispatch-repo.ts:
    zero matches before this change.
- [x] Discovered mid-investigation (not visible from the original finding
      text, since it postdates it) a real, live admin-editable model
      config layer already exists: `src/lib/ai-team/roster-overrides.ts` +
      the `platform.ai_team_role_overrides` DB table (built 2026-07-18 for
      a *different* gap, "Multi-AI Provider Support" -- BYO/admin model
      override, not A/B testing). Every real dispatch surface
      (`/api/ai/team/dispatch`, `team-service.ts`'s `runRole()`) already
      resolves ITS effective model through that layer, not through
      roster.ts's static array directly. Decided to extend THAT layer with
      rollout capability rather than adding a parallel `candidateModel`/
      `rolloutPercentage` pair onto roster.ts's static array (an earlier,
      reverted draft of this change did exactly that) -- a real A/B/
      shadow-test needs the same "toggle live, no deploy" property the
      override table already has; a static-array field would need a full
      PR + CI + merge cycle to flip a percentage, which isn't meaningfully
      different from just editing `model` directly today.
- [x] Implemented Finding 2 (DB-backed, additive to the existing override layer):
  - `drizzle/0313_ai_team_role_overrides_rollout.sql`: adds nullable
    `candidate_model` (text) + `rollout_percentage` (integer, 0-100 CHECK
    constraint) columns to `platform.ai_team_role_overrides`. Idempotent
    (`ADD COLUMN IF NOT EXISTS`, DO-block CHECK matching
    drizzle/0262's own precedent). **Not applied live** -- left for the
    supervising session, same convention as every other schema-touching
    claim in ACTIVE-CLAIMS.yaml.
  - `src/lib/db/schema.ts`: `aiTeamRoleOverrides` gets the matching
    `candidateModel`/`rolloutPercentage` fields.
  - `src/lib/ai-team/roster-overrides.ts`:
    - `resolveDispatchModel(roleKey, complexityTier?, randomValue?)` --
      new. Requires `complexityTier` to ever select a candidate (omitted
      -> always primary, matching `resolveEffectiveModel()`'s existing
      behavior exactly) -- fail-safe by construction, not convention: a
      call site that doesn't know the task's tier can never accidentally
      route to an unproven candidate. Also refuses a candidate that isn't
      itself eligible for that tier per `model-tier-eligibility.ts`, and a
      candidate that isn't a known/registered model. `randomValue`
      defaults to `Math.random()` but is a real parameter so a caller can
      pin one draw across both a tier pre-flight check and the real call.
    - `setRoleRollout()` / `clearRoleRollout()` -- admin mutation
      functions, same validation posture as the existing
      `setRoleOverride()`/`clearRoleOverride()` (unknown role, human/
      code-only role, out-of-range percentage, unrecognized candidate
      model id all rejected before any DB write). Preserves any existing
      plain `model` override on the same row.
    - `resolveEffectiveModel()` left byte-for-byte behaviorally unchanged
      -- every pre-existing caller (dispatch-repo.ts, etc.) is unaffected.
    - `listRosterWithOverrides()` / `RosterRowWithOverride` extended with
      `candidateModel`/`rolloutPercentage` so the existing admin GET
      route surfaces them automatically.
  - `src/lib/ai-team/team-service.ts`: `runRole()`/`runRoleAndRecord()`
    take a new optional 5th param `rollout?: { complexityTier, randomValue? }`.
    Omitted (every pre-existing caller) -> zero behavior change. When
    supplied and no `tenantConfig` (a tenant's BYO model still always
    wins), resolves via `resolveDispatchModel()` instead of
    `resolveEffectiveModel()`. Returns a new `modelVariant:
    "primary"|"candidate"` field; `execution.role.model` already carried
    the actually-called model before this change (pre-existing pattern),
    so cost-policy checks, the real `callLLM()` call, the Token Usage
    Ledger write, and `dispatch_outcomes.modelUsed` all automatically
    reflect the resolved variant with no separate plumbing needed.
  - `src/app/api/ai/team/dispatch/route.ts`: the tier pre-flight check now
    calls `resolveDispatchModel()` (not `resolveEffectiveModel()`) so an
    active rollout's candidate is what actually gets tier-gated. Draws
    ONE `rolloutSeed = Math.random()` and reuses it for both that check
    and the real `runRole()` call, so the model that gets tier-checked is
    guaranteed to be the model that actually runs (a second independent
    draw could otherwise pick the other variant). `executedBy` in the
    response now includes `modelVariant`. `PATCH` extended with a
    separate, additive `rollout: {candidateModel, rolloutPercentage} | null`
    body field (`null` clears, an object sets, omitted leaves any existing
    rollout untouched) alongside the pre-existing `model` field.
  - The retry-loop `runRole()` call (auto-retry on a hedged L1-L3 response)
    intentionally NOT given a `rollout` -- it already doesn't carry
    `tenantConfig` either (pre-existing, unrelated behavior), so this
    keeps parity rather than introducing a new inconsistency.
  - Tests: `src/lib/ai-team/roster-overrides.test.ts` -- 20 new tests
    (bucketing edges 0%/100%/partial, complexityTier-omitted fail-safe,
    tier-ineligible-candidate fallback, unregistered-candidate fallback,
    fail-open on DB error, setRoleRollout/clearRoleRollout validation +
    write-shape assertions). `src/app/api/ai/team/dispatch/route.test.ts`
    -- updated its `roster-overrides` mock to stub `resolveDispatchModel`
    (the route no longer imports `resolveEffectiveModel`).
  - Not touching `permission-service.ts` (out of scope, per task
    instructions).
- [x] Verification: `bunx tsc --noEmit` clean (0 errors, ran with
      `NODE_OPTIONS=--max-old-space-size=4096` -- the default heap OOMs on
      this repo's size regardless of this change). `bun run lint` clean (0
      errors, 3 pre-existing unrelated warnings). Full `bun test`: 2566
      pass / 0 fail across 224 files (up from the pre-existing baseline +
      the 20 new tests). `check-guardrail-presence.mjs` (88/88),
      `check-asset-registry-coverage.mjs` (443 tables, unchanged --
      new columns on an already-registered table, not a new table),
      `check-migration-collision.mjs --base origin/main` (0313 clean) all
      pass.

## Remaining
- [ ] None -- ready to commit, push, open PR.
