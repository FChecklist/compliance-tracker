# VERI Reward — Evaluation & Architecture Recommendation

**Author:** CEO / Technical Director (AI Workforce) · **For:** Founder & CEO
**Status:** Evaluation only — no code changed. Grounded in direct reads of `sales-engine-service.ts`, `drizzle/0087_wave109_sales_engine.sql`, `AchievementCard.tsx`, `product-branch-service.ts` + `module-registry-service.ts` + the Wave 106/20/25 migrations that built `productBranches`/`productBranchModules`/`orgProductBranchEnablements`, `worker-agent-service.ts` (usage-count precedent), `0091_onboarding_lifecycle.sql` (`users.onboardingStage`), and `MASTER_AI_OS_ARCHITECTURE.md`'s branch-key/module-reuse/RLS rules. Same reasoning discipline as `WORKER_AGENT_AND_PROMPT_LIBRARY_EVALUATION.md`: one clear recommendation per section, gaps named honestly, no menu of equal options.

## Bottom line up front

**VERI Reward is genuinely one new module, not two.** It needs one new points/achievement ledger (genuinely new — nothing today tracks a running point balance or unlocks) plus one new lightweight end-user referral table (the existing Sales Engine tables are a *partial*, not *reusable*, fit — explained in §3). It plugs into `productBranches`/`productBranchModules` exactly the way `office`/`procurement` already do for the "sellable standalone or bundled free" requirement — that mechanism needs zero changes, only a new catalog row and a policy decision on default enablement. `AchievementCard.tsx` is real but currently a single hardcoded compliance-completion widget with no backing engine; it becomes the first UI consumer of the new engine, not evidence the engine already exists. This is a genuinely new build, correctly scoped, that should NOT be built as two separate modules ("Gamification" and "Referrals") because they share the identical event→points→reward mechanic end to end — separating them would duplicate the ledger.

---

## 1. Gamification mechanics — grounded in the stated psychology constraint

The Boss's constraint is specific and testable: **achievable-with-low-resistance targets** + **instant gratification**. Vague "add badges" fails both; here is what passes:

**Concrete achievable-with-low-resistance targets** (each fires on an action the user was already about to take, not a new chore):
- *End-user adoption (driver c):* "Complete your first compliance item" (1 action, day-1 achievable), "3-day login streak" (not 30 — a 30-day streak has enormous drop-off before day 5; 3 is reachable within a single work week even with a missed day tolerated, see streak-grace design below), "Upload your first document," "Resolve 5 tasks this week" (a *rolling* weekly target reachable by an average user's normal pace, not a stretch goal).
- *Customer-internal team gamification (driver a):* "Close 10 tickets this month" scaled to the team's own historical average (see §2 — thresholds are derived per-org from `workerAgents`-style usage baselines, not one global number that's easy for a power team and impossible for a small team).
- *VERIDIAN's own internal use (driver b):* identical mechanic, VERIDIAN's own org is just another `orgId` row — "no special-cased internal-only code path" (see §4).
- *HR company-wide performance gamification (driver d):* achievements anchored to `performanceReviews`/`leaveRequests`/`employeeProfiles` events already in schema — "Submit your self-review within 3 days of cycle open," "Zero unplanned absences this quarter" — HR-defined thresholds via the achievement-definitions table (§2), not hardcoded.

**Concrete instant-gratification delivery** (the reward must be visible the moment the qualifying action's own request completes, not on a nightly batch job):
- The points-award call happens **synchronously inside the same request** that performs the qualifying action (e.g. `updateComplianceItemStatus()` marking an item `completed` also calls `awardPoints()` in the same function, same transaction where feasible) — never a cron job discovering it later. This mirrors the existing `evaluateAndRunRules()` fire-and-forget pattern in `notice-service.ts`, but for *points* specifically the award write should be synchronous, not fire-and-forget, because the UI's next render must already reflect the new balance — a fire-and-forget points award risks the toast firing before the DB write lands.
- The UI shows the delta immediately via an optimistic toast/confetti component fired from the same API response payload (`{ ...updatedItem, pointsAwarded: 25, newAchievements: [...] }`) — not a separate poll. This is the actual "instant" mechanism: the reward is returned in-band with the action's own response, not fetched by a second round-trip.
- Streaks use a **grace window, not a hard reset**: a 3-day streak missed on day 2 doesn't zero out immediately — it holds for one make-up day, because an all-or-nothing streak is a punishment mechanic, not a reward mechanic, and punishing a missed day is the single most common dark-pattern complaint about streak gamification (Duolingo-style forced anxiety). This is the concrete "healthy, non-dark-pattern" design choice the Boss asked for.

**Shared engine, different surfaces — explicitly stated:** all four drivers (a/b/c/d) read and write the *same* `veri_reward_points_ledger` + `veri_reward_achievement_definitions` + `veri_reward_achievement_unlocks` tables (§2), scoped by `orgId` exactly like every other multi-tenant table in this codebase. The only per-audience difference is (i) which achievement *definitions* are seeded/visible for which context (an HR-defined achievement is `context='hr_performance'`, an end-user adoption one is `context='product_engagement'`) and (ii) which UI component renders the leaderboard/progress (a `/hr/performance` widget vs. `AchievementCard` on `/home` vs. a `/sales-hq`-style internal ops view for VERIDIAN's own org). This is the same "one tab, content varies by rank/scope" precedent `home-service.ts`'s `getAnalyticsRollup()` already establishes for VERIDIAN (§1's own comment: "the TAB ITSELF is never renamed... only what's inside it") — VERI Reward generalizes that precedent rather than inventing a new one.

---

## 2. Data model — what's new vs. reused

**Reused as-is, zero schema change:**
- `productBranches` / `productBranchModules` / `orgProductBranchEnablements` — the entire "sellable standalone or bundled free" mechanism (§5).
- `users.onboardingStage` — a genuine milestone source: `awardPoints()` should fire once per user the first time each onboarding stage (`profile`/`compliance`/`upload`/`invite`/`ai-config`) is reached, giving VERI Reward real, already-tracked lifecycle events on day one with zero new instrumentation.
- The existing per-module completion events already written throughout the codebase (`complianceItems.status`, `tasks.status`, `pms_issues.status`, `performanceReviews.status`, etc.) — VERI Reward's engine subscribes to these as *inputs*, it does not duplicate them.

**Referenced, not reused (see honest distinction):** `workerAgents.usageCount`/`accuracyScore` (columns confirmed via `worker-agent-service.ts`'s comment describing the usage-tracking precedent, and `AI_OS_CERTIFICATION.md`'s §2.1 confirming the general shape) are a *precedent for the pattern* — "a running count column incremented on every qualifying event" — not a table VERI Reward writes into. Worker-agent usage counts are an internal AI-quality signal; conflating them with human point totals would corrupt both. Point noted honestly rather than silently reused.

**Genuinely new tables** (5, all org-scoped, following the `app_runtime_org_scoped` + `service_role_bypass` RLS pair every new table in this codebase carries per `MASTER_AI_OS_ARCHITECTURE.md` rule 4):

```sql
-- Append-only ledger: every point-affecting event is one row, never
-- mutated. Current balance is SUM(delta) WHERE org/user match, not a
-- separately-maintained counter -- same append-only-ledger discipline
-- sales_commission_accruals already uses for money, applied to points.
veri_reward_points_ledger (
  id, org_id, user_id, delta integer,          -- positive award, negative redemption/void
  source_type text,                             -- 'achievement_unlock' | 'streak' | 'referral' | 'manual_adjustment' | 'redemption'
  source_id text,                               -- points to the achievement_unlock/referral row etc.
  reason text,                                  -- human-readable, shown in the user's activity feed
  created_by_id text references users(id),      -- null for system-awarded, set for admin manual adjustment
  created_at timestamp
)

-- Definitions are org-configurable (HR sets their own thresholds) but
-- ship with platform-default rows, same scope-resolution shape
-- module_rule_configs already uses (platform default, org override).
veri_reward_achievement_definitions (
  id, org_id nullable,                          -- NULL = platform default, visible to every org until overridden
  achievement_key text,                         -- 'first_compliance_item' | 'login_streak_3' | 'weekly_task_5' ...
  context text,                                 -- 'product_engagement' | 'hr_performance' | 'team_gamification' | 'internal_ops'
  display_name, description, icon,
  target_value integer,                         -- e.g. 5 (tasks), 3 (streak days)
  points_reward integer,
  is_active boolean,
  created_at, updated_at
)

-- One row per user per achievement, unique(user_id, achievement_definition_id)
-- -- prevents double-award, and IS the "instant" unlock event the API
-- response payload reads back synchronously.
veri_reward_achievement_unlocks (
  id, org_id, user_id, achievement_definition_id,
  progress_value integer,                       -- current count toward target_value, so AchievementCard's progress bar has a real backing number instead of a hardcoded stats fetch
  unlocked_at timestamp nullable,                -- null while in progress, set the instant target_value is reached
  created_at, updated_at
)

-- Grace-window streak state -- deliberately its own table, not folded
-- into achievement_unlocks, because a streak's "current count" resets on
-- a genuine miss (past the grace window) in a way a one-time achievement
-- unlock never does.
veri_reward_streaks (
  id, org_id, user_id, streak_key text,          -- 'daily_login' | 'weekly_task_completion' etc.
  current_count integer, longest_count integer,
  last_incremented_at timestamp, grace_used_at timestamp nullable,
  created_at, updated_at,
  UNIQUE(org_id, user_id, streak_key)
)

-- Redemption catalog is deliberately out of scope for this wave (see §6
-- phasing) but the ledger's source_type='redemption' already anticipates
-- it -- no schema rework needed later, just a new admin-defined catalog
-- table when that phase starts.
```

No FK from any of these to `sales_referrals`/`sales_partners` — the referral mechanic (§3) writes into `veri_reward_points_ledger` via `source_type='referral'` exactly like every other point source, which is the actual proof that gamification and referrals are one engine, not an assertion (see §4).

---

## 3. Refer-and-earn — reuse the Sales Engine's *mechanics*, not its *tables*

**Recommendation: build one new lightweight table (`veri_reward_referrals`), reusing the Sales Engine's link/click/signup/paid *state-machine shape* verbatim, but do not write end-user referral rows into `sales_partners`/`sales_referral_links`/`sales_referrals`/`sales_commission_accruals` themselves.**

Why the existing tables are a *partial* fit, stated precisely rather than hand-waved: `sales-engine-service.ts`'s own header comment is explicit that this system is deliberately platform-owned with **no org_id and no RLS policy at all** ("there is no org (or even org-shaped) tenant context for an external sales partner to be scoped into... deliberately never `withTenantContext`"). A `sales_partner` is an external human (reseller/consultant/referral_agent) with a long-lived (5-year) dashboard token, onboarded by a `veridian_admin` via `createSalesPartner()`, and is fundamentally **not tenant-scoped** by design. An end-user referring a colleague or another company, by contrast, **is** an already-authenticated, already-org-scoped `users` row — it has an `orgId`, RLS applies to it, and every other multi-tenant read/write in this codebase already assumes that shape. Force-fitting end users into `sales_partners` would mean either (a) minting a `sales_partners` row for every single referring end-user (defeating the entire "external partner, no tenant" rationale that table's RLS-bypass posture depends on), or (b) adding an `orgId` + RLS policy to a table five other pieces of code already depend on being RLS-free — both are real, unnecessary blast radius on a system that works correctly today for its actual purpose (B2B reseller commissions).

**What genuinely should be reused, verbatim, as a pattern:** the *state machine* — `clicked → signup_completed → org_provisioned → paid → lost` — and the *mechanics* — token-based link generation (`generateToken()`/`createId()`), click-count increment on redirect, "resolve most-recent-unclaimed-clicked-referral-on-signup" claiming logic (`recordReferralSignupAndOrgProvisioned()`), and the "paid milestone triggers accrual" hook (`markReferralPaidIfApplicable()`). These are genuinely good, already-proven mechanics — VERI Reward's referral table should copy this shape into a new, org-scoped, RLS-protected table:

```sql
veri_reward_referrals (
  id, org_id,                                    -- the REFERRER's org -- real tenant scope, unlike sales_referrals
  referrer_user_id text references users(id),
  referral_token text unique,
  target_type text,                              -- 'customer_to_customer' | 'veridian_growth' (see below)
  status text,                                    -- clicked | signup_completed | org_provisioned | paid | lost -- same 5-state shape
  referred_org_id text nullable,                  -- set once the referred org exists
  referred_user_id text nullable,
  click_count integer default 0,
  reward_points integer nullable,                 -- points credited to referrer's veri_reward_points_ledger via source_type='referral'
  clicked_at, signup_completed_at, org_provisioned_at, paid_at, created_at
)
```

**On `partner_type` vs. a new table — the honest call:** adding a 6th `sales_partner_type` enum value (e.g. `'end_user_referrer'`) was considered and rejected. Every downstream function in `sales-engine-service.ts` (`accrueCommissionForReferral`, `getPartnerDashboard`, `getPlatformSalesOverview`) assumes a partner has a `dashboardToken`, a `companyName`, and a *commission plan* — an end-user referral reward is *points*, not a currency commission accrual, and forcing it through `salesCommissionPlans`/`salesCommissionAccruals` (which are `numeric(12,2)` currency amounts with `flat`/`percentage` types) would misrepresent a 50-point reward as a monetary liability line VERIDIAN's own finance reporting (`getPlatformSalesOverview`'s `liabilityByProduct`) would then have to explicitly exclude everywhere. A new, smaller table with its own reward-points column is the honest, low-risk choice — not "reuse everything," not "reuse nothing," but reuse the proven *shape* while keeping the *type* of reward (points vs. money) and the *tenant model* (org-scoped vs. platform-owned) correctly separated.

**VERIDIAN's own growth referrals** (the Boss's "referring other customers... and for VERIDIAN's own growth" clause) use the *same* `veri_reward_referrals` table with `target_type='veridian_growth'` and `orgId` pointed at VERIDIAN's own internal org row — not a third mechanism. If a referral should earn a *cash* reward rather than points (e.g. "refer a paying customer, get ₹5,000"), that specific referral's `paid` transition should call into the *existing* `sales-engine-service.ts` accrual path exactly as an external partner would (a `veridian_growth`-type referral, once it reaches `org_provisioned`, can register itself as a `sales_referrals` row via a thin adapter call — reusing the money-accrual machinery for the one case that's genuinely money, not points). This is the one place a bridge between the two systems is correct: **points for product engagement, real accrual machinery for VERIDIAN's own cash payouts, never mixed in the same row.**

---

## 4. Gamification and referral/reward — "one module," precisely defined

Not an assertion — here is the concrete architectural test: **do they share the same write path for the same currency?** Yes: every gamification event (completing a task, hitting a streak, HR milestone) and every referral event (a referred signup converting to paid) resolve to exactly one thing — an insert into `veri_reward_points_ledger` with a `source_type` discriminator. There is no second currency, no second balance, no second "your rewards" page. A user's `AchievementCard`-style dashboard and a user's "refer and earn" dashboard are two *views* over one `SELECT SUM(delta) FROM veri_reward_points_ledger WHERE user_id = ?` query, filtered by `source_type` when the UI wants to show "earned from tasks" vs. "earned from referrals" as separate line items within the same total.

This is architecturally identical to how `sales-engine-service.ts` itself already treats `salesCommissionAccruals` as the one ledger multiple referral-status transitions write into — VERI Reward applies the same "one ledger, many event producers" shape one level down, for points instead of currency. **If a future team ever proposes a second points table for "referral points" separate from "achievement points," that is the single clearest sign VERI Reward has been mis-split into two modules — flag it immediately, don't build it.**

---

## 5. "Sellable standalone or bundled free" — reuse `productBranches`, don't build licensing

**Recommendation: register `veri_reward` as a new `productBranches` row exactly like `office`/`procurement`/`hr` already are, and make "bundled free into every product" a seed-time decision (mandatory enablement backfill), not a new mechanism.**

Concretely, following `0084_wave106_master_ai_os_registry.sql`'s own precedent:

```sql
INSERT INTO compliance.product_branches
  (branch_key, display_name, domain, description, tagline, icon, status, launch_order, parent_domain, build_tier) VALUES
  ('veri_reward', 'VERI REWARD', 'engagement',
   'Gamification (points, achievements, streaks) and refer-and-earn, usable by a customer''s own team, by VERIDIAN internally, and as a growth lever for every product.',
   'Small wins, instantly felt', 'Trophy', 'planned', <next_launch_order>, 'engagement', 'ground_up')
ON CONFLICT (branch_key) DO NOTHING;
```

The `branchKey` `veri_reward` follows the lowercase-snake-case-internal-name rule (`MASTER_AI_OS_ARCHITECTURE.md` §2) — `VERI Reward` is the `displayName`/marketing name only.

**"Sellable standalone" = a normal `orgProductBranchEnablements` row, `isEnabled=false` by default, toggled on by an admin/sales action exactly like PMS's opt-in flow (Wave 25's own precedent: "Separate, opt-in, disabled by default for existing GRC orgs").** No new billing/entitlement table is needed for this case — `requireBranchEnabled(orgId, "veri_reward")` at the top of every VERI Reward service function is the same 403 gate every other branch-gated module already uses.

**"Bundled free everywhere" is NOT a separate mechanism — it is the exact same mandatory-enablement-backfill pattern `office` used in Wave 106**, restated for `veri_reward`: an `INSERT ... SELECT` giving every existing org (and every new org at signup) an explicit `isEnabled=true` row the moment the Boss decides VERI Reward ships free-by-default. This is a genuinely important design point to get right the first time: **do not build a `isFreeTier`/`isBundled` boolean anywhere.** `productBranchModules`'s many-to-many shape plus per-org `orgProductBranchEnablements` rows already fully express both "paid add-on, off by default" and "free bundle, on by default" as the *same* enablement table with different default values — inventing a second flag would create exactly the kind of parallel mechanism `MASTER_AI_OS_ARCHITECTURE.md` rule 3 (module-reuse-not-duplication) exists to prevent. The Boss's eventual pricing decision (standalone paid module vs. free-everywhere) is a **business decision expressed as a seed-migration choice**, not a code branch.

One open question this doc flags rather than silently deciding: whether VERI Reward ships **on by default for every org from day one** (like `office`) or **opt-in like PMS**. Given the Boss's own framing — "growth lever... make the product addictive" — on-by-default is the design that actually serves that goal (an opt-in engagement feature engages nobody, by definition, until someone remembers to turn it on). **Recommendation: ship on-by-default (the `office` pattern), but this specific default is a product/pricing call the Boss should explicitly confirm before the seed migration ships** — see sign-off section.

---

## 6. Phased build order and 30-day window assessment

| Phase | Scope | Depends on | Rough size |
|---|---|---|---|
| **1** | Schema: 5 new tables (§2) + `veri_reward` `productBranches` row + RLS pair on every table, following the verbatim template `MASTER_AI_OS_ARCHITECTURE.md` §4 already gives | none — pure additive migration | small–medium |
| **2** | Points/achievement engine: `awardPoints()`, `checkAndUnlockAchievements()`, `incrementStreak()` (with grace-window logic) in a new `veri-reward-service.ts`, wired synchronously into 2–3 real existing write paths as the first proof (e.g. `complianceItems` status→completed, `tasks` status→done, `users.onboardingStage` transitions) | Phase 1 | medium |
| **3** | Referral mechanics: `veri_reward_referrals` table's own service functions (link generation, click/signup/paid tracking) reusing the Sales Engine's *pattern* per §3, plus the one narrow bridge call into `sales-engine-service.ts` for the cash-payout case | Phase 1; can run in parallel with Phase 2 | medium |
| **4** | UI surfaces per audience: wire `AchievementCard.tsx` to real data (replace its hardcoded `/api/compliance/stats` fetch with the new ledger/unlocks API) for driver (c); a `/hr/performance`-adjacent widget for driver (d); a `/sales-hq`-style internal view for driver (b); a "refer and earn" page/share-link generator for the referral half | Phases 2+3 | medium |
| **5** | Redemption catalog (turning points into an actual reward — discount, swag, cash-out) — deliberately deferred, not designed in this doc; it introduces a real financial-liability question (can points be redeemed for money? at what rate? does that create a "deposit-like" instrument requiring different accounting/legal treatment?) that the schema in §2 anticipates (`source_type='redemption'`) but does not resolve | Phase 2+3 real usage data | large, and requires Boss + Finance sign-off before design, not just before ship |

**On the 30-day window:** Phases 1–2 are genuinely buildable inside the current window — one migration, one new service file, and 2–3 wiring points into code that already exists and already fires the right lifecycle events (`complianceItems`, `tasks`, `onboardingStage`). This is the same "small, additive, reuses existing infra" shape Phase 1–2 of the Worker Agent evaluation earned a "fits in this window" verdict for. Phase 3 (referral mechanics) is also genuinely small — it is copying a proven, already-built pattern into a new, correctly-scoped table, not inventing new mechanics — and should ship in the same window given it shares Phase 1's schema work.

**Phase 4 (UI per audience) is where the real time risk is, not the backend.** Four different UI surfaces for four different audiences, done well enough to actually feel "instant" and "addictive-in-a-good-way" rather than a progress bar bolted onto an existing page, is real design and frontend work — plausible to *start* in this window (wiring `AchievementCard` first, since it already exists) but **the HR company-wide leaderboard surface and the internal VERIDIAN-ops view should be sequenced as a fast-follow in the next cycle**, not force-fit into this one at the expense of doing the engine correctly. Rushing four bespoke UIs in the same window the engine itself is being built is the likeliest way this ships feeling exactly like the "vague badges" version the Boss explicitly said not to build.

**Phase 5 (redemption) is explicitly out of scope for this window and should not be estimated as if it were near — it is a different risk class (real money/liability, possibly legal/accounting implications) from the rest of this module and deserves its own dedicated evaluation once Phases 1–4 have real usage data to design a redemption catalog against.**

---

## What needs the Boss's sign-off

- **On-by-default vs. opt-in for VERI Reward** (§5) — this is a pricing/positioning decision with real revenue implications (a paid standalone module the Boss might otherwise want to sell can't be "free everywhere" and "paid add-on" at the same time for the same org); the seed migration's default `isEnabled` value should not be decided by whoever writes Phase 1's migration.
- **Whether referral rewards for "VERIDIAN's own growth" can pay out real cash** (§3's bridge into `sales-engine-service.ts`'s accrual machinery) — any path that lets an end-user action create a real monetary liability against VERIDIAN, even a small one, is the same class of decision the Worker Agent evaluation flagged for auto-dispatch: a genuine increase in blast radius that should be explicitly approved (which referral types are cash-eligible, what caps/limits apply, who approves payout) before Phase 3 ships, not discovered after.
- **Phase 5 (redemption) should not be scheduled at all without a dedicated Finance/Legal-aware evaluation** — turning points into money or money-equivalents (gift cards, discounts) is a different risk category from everything else in this module, and this document deliberately does not pretend to have designed it.
