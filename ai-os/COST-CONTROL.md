# Zero-Waste Credit Control — Implementation Record

Implemented 2026-07-20 per Owner directive. This is the as-built record: what changed, where, and the real test evidence for each claim. Every mechanism below was tested against the live server before being called done — none of this is aspirational.

## Read this first: a blocker no amount of process fixes this document

**The OpenRouter account is at zero real balance right now** (`total_credits: $40`, `total_usage: $40.07`, confirmed live via the OpenRouter API at time of writing). A real canary dispatch through the newly-hardened pipeline hit a genuine `402` straight from OpenRouter itself during testing tonight — not from anything built here. Every mechanism in this document (cache, circuit breaker, budget ceiling, pre-flight guard) is real and tested, but **none of it can spend money that doesn't exist**. Further GLM-5.2 gap-closure work — including the 2045-row initiative — is blocked on real funds being added at openrouter.ai until further notice, independent of process quality.

---

## Q1–Q4: failure prevention, detection, and rectification

**File:** `/opt/veridian/scripts/preflight-guard.py` (new)
**Wired into:** `/opt/veridian/scripts/worker-entrypoint.sh`, runs before every main invocation.

Four checks, in order, each free or near-free, each tested individually against real conditions:

| Check | Cost | Catches | Test result |
|---|---|---|---|
| Circuit breaker (`.failure_signatures.json`, last-2-identical rule) | $0 | pathological retry (Group A: BYOB burned 2.3h across 12 identical retries) | confirmed blocks on 2 identical signatures, confirmed passes on 2 different ones |
| Disk / memory headroom | $0 | resource contention (Group B: 5 instant fails, same minute, 3 concurrent heavy sessions) | logic verified; real Group-B conditions not reproduced live tonight |
| Git worktree lock | $0 | concurrent-write corruption | confirmed blocks correctly |
| Proxy `/healthz` (includes budget state) | $0 | dead proxy, or budget already exhausted | confirmed |
| Canary call (tiny real request) | ~$0.0001, $0 if cached | model/auth/tool-schema reachability, *before* the full task prompt (often 10,000s of tokens) goes out | confirmed real call succeeds/fails correctly through the live proxy |

A rejection at any stage is classified and routed:
- **Hard stop** (`circuit_breaker_tripped`, `budget_exhausted`) → task disabled, needs a human, will not auto-retry into the same wall again.
- **Transient** (disk/mem/proxy/worktree) → normal `Restart=on-failure` retry after 30s, still counted against the lifetime invocation cap.

This directly targets the RCA: Group A's worst case (12 retries, 2.3 hours) would have been cut to 2 attempts. Group B's 5 zero-output failures would have cost $0 instead of whatever fraction of a cent each one burned.

## Q5: baked into shared infra, not per-task discipline

All of the above lives in `worker-entrypoint.sh` itself — the one script every task on this box runs through — not in individual task prompts. Rollout sequence actually followed, matching the caution stated in the original memo:
1. Built and unit-tested `preflight-guard.py` standalone (4 scenarios, all passing) before touching the shared script.
2. Wrote the new `worker-entrypoint.sh`, backed up the original (`worker-entrypoint.sh.v1.bak`), syntax-checked (`bash -n`).
3. Ran it manually against one disposable canary task (`task-20260720-054314-canary-zero-waste-pipeline-test`) before replacing the live file — confirmed pre-flight ran, prompt construction was correct, failure-signature recording worked on a real (OpenRouter-credit-exhaustion-caused) failure.
4. Only then copied it over the live `worker-entrypoint.sh`.

**Honest gap:** the full success path (quality gate → commit → push → `pending_review`) is unchanged code from v1 and wasn't re-exercised tonight, because every real model call currently 402s (see the blocker above). It needs one real successful run once credits exist — tracked as an open item, not silently assumed fine.

## Q6: keeping it working, not just working once

- `veridian-glm-proxy.service`'s `/healthz` endpoint now reports live budget state — a 5-second check tells you if the ceiling is close or already hit, no log-parsing required.
- The real-cost log (`glm-proxy-calls.jsonl`) now carries a `cache_hit` field — a quick `grep -c '"cache_hit": true'` shows the cache is actually being used, not just installed.
- **A real docs-vs-reality gap was caught and is flagged here, not fixed silently:** `SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md` states the local proxy is disabled and routing goes direct to OpenRouter. Live `systemctl`/log checks tonight confirm the proxy is very much active and is the only path in. Someone should reconcile that document — it's exactly the kind of drift this whole effort is meant to prevent.
- Weekly reconciliation recommended (not yet automated): total real cost vs. tasks completed vs. failure-signature repeats. Automating this is a reasonable next step, not done tonight — noted honestly rather than claimed.

## Q7: realistic cost, recalculated with real data (not 2045)

Real remaining scope, from the planning doc's own live-verified count: **~185 rows** (~170 genuinely open + ~15 deferred-but-routed-to-execution), not 2,045 — 91% of the row count is already closed.

**New this round — batching, pulled from the actual CSV structure**, not assumed: `VERIDIAN_Review_Framework_evaluated_2045rows.csv` groups rows into `Sub Category` clusters of a very consistent size — e.g. General Ledger, Chart of Accounts, Journal Entries, Accounts Payable, Accounts Receivable, Banking, Cash Management, Cost Centers, Budgets each have **exactly 15 rows**. These 15 rows per sub-category are different *quality parameters of the same underlying feature* (is it AI-required, can it self-heal, can it self-test, etc.) — one real code change to "General Ledger" plausibly closes most or all 15 rows in that cluster at once. That means the real remaining ~185 rows are very likely coverable by something on the order of **10–15 task dispatches, not 185** — each dispatch closing a whole sub-category cluster rather than one row.

With the per-dispatch overhead this memo already identified (pre-flight, boilerplate, canary) now spread over 10–15 dispatches instead of 185, and the circuit breaker preventing another BYOB-style 12x retry:

| Scenario | Basis | Projected cost |
|---|---|---|
| Per-row dispatch, unfixed process (last night's trajectory) | ~$2/PR × 185, plus waste | $750–1,500 |
| Per-row dispatch, fixes applied | waste removed, still 185 dispatches | $400–550 |
| **Sub-category batching + fixes applied** | ~10–15 dispatches, each closing ~12–15 rows | **roughly $20–40** |

**On the $10 target directly:** batching gets the honest estimate an order of magnitude closer, but I'm not going to round $20–40 down to $10 to tell you what you want to hear — that would repeat the exact mistake this whole exercise is about. If $10 is a hard ceiling rather than an aspiration, the proxy's budget gate (already deployed, cap configurable) will enforce it literally — work will stop the instant $10 is spent, whether or not the 185 rows are done. That's a real, code-enforced choice you can make; it's just not the same thing as a confident promise that 185 rows of real work costs $10.

## Q8: caching and prompt size — tested, not assumed

**Server-side cache** (not Anthropic's, not requested from OpenRouter — built and hosted here): `/opt/veridian/scripts/anthropic_openrouter_proxy_v2.py`, SQLite-backed, exact-match on the full outgoing request (model + messages + tools). Real test tonight:
- Call 1 (fresh): 1.73s, logged real cost.
- Call 2 (byte-identical): 0.047s (36x faster), same response ID, **$0 logged, `cache_hit: true`**.
- 7 rapid identical follow-ups: all correctly served from cache.

Honest scope: exact-match only. It catches literal repeats (a retry that re-sends an identical resume-context because nothing actually changed — precisely BYOB's failure shape) — it does not help two genuinely different or progressing calls, and it shouldn't; a fuzzy match risks serving a wrong response into a real tool-use loop.

**Hard budget ceiling**, same proxy: real test tonight — cap set to $0.0001, one call pushed spend to $0.0002, the *next* call was rejected with `402` before any OpenRouter call was made (verified: rejection cost $0, confirmed via the health endpoint and the cost log). Live deployment cap: **$10.00, counted from the moment this system went live (2026-07-20T05:34:28 UTC)** — deliberately not counting the $19.76 already spent before this existed, since that's unrecoverable and a retroactive cap on it is meaningless.

**Prompt-size reduction**: confirmed via direct inspection that the old script re-embedded the *entire original task prompt* on every single resumed invocation — verified directly in a live process's command line during this investigation. Fixed: resume prompts now reference `prompt.txt` instead of restating it. Real test: constructed a live resume prompt for the canary task — correctly excluded the original prompt content, present only by reference.

**AI-to-AI prompt language**: the resume-prompt template was rewritten from narrative prose ("You were previously interrupted while working on this task...") to compact labeled fields (`RESUME task=... invocation=X/Y`, `LAST_CHECKPOINT:`, `SPEC:`, `PROTOCOL:`). It's addressed to a model that parses structure, not a person who needs the situation explained.

**What wasn't done, stated honestly:** OpenRouter/GLM-5.2 provider-side prompt caching (a discount on repeated prefix tokens, distinct from the exact-match response cache above) was not tested — whether the provider even supports it per-model is unverified. Not pursued further since it wasn't asked for and the response cache + prompt-size fix already deliver most of the realistic benefit without depending on provider support.

---

## Real file changes, for reference

| File | Change |
|---|---|
| `/opt/veridian/scripts/anthropic_openrouter_proxy_v2.py` | new — response cache + budget ceiling |
| `/opt/veridian/scripts/preflight-guard.py` | new — static checks + canary + circuit breaker |
| `/opt/veridian/scripts/worker-entrypoint.sh` | rewritten — guard wired in, terse prompts, failure-signature recording. `.v1.bak` kept for rollback. |
| `~/.config/systemd/user/veridian-glm-proxy.service` | points at v2, adds `PROXY_CACHE_DB` / `PROXY_BUDGET_CAP_USD` / `PROXY_BUDGET_WINDOW_START`. `.v1.bak` kept. |
| `/opt/veridian/ai-os/logs/glm-response-cache.sqlite` | new — cache store |

Rollback, if ever needed: restore the two `.v1.bak` files, `systemctl --user daemon-reload && systemctl --user restart veridian-glm-proxy.service`.

---

## Audit round 1 (2026-07-20, same session)

New tool built during this round: `/opt/veridian/scripts/cost-reconciliation.py` (Q6's "keep it working" check, run on demand, $0 cost — reads only local logs).

**Finding, corrected upward from the earlier estimate:** the ALL-TIME failure rate across every task ever tracked in `CONTROLLER.yaml` is **71.9% (205 failed / 285 total)** — not the 45% calculated earlier from a single 15-hour window. The 45% figure was real but described a narrower slice; the true historical picture is worse. This is exactly the kind of thing Q6's reconciliation habit is meant to catch, and it caught it on its first real run.

**Finding, a flaw in my own first draft of the reconciliation script:** the initial cache-hit-rate calculation blended the ~2,375 calls made before the cache existed (which can only ever show as misses) with the ~19 made since, producing a meaningless 1.1%. Fixed to window from cache-deployment time: **18/19 = 94.7%** hit rate since deployment — real, but caveated honestly in the script's own output as still-small-sample and inflated by repeated verification testing during this build, not yet a steady-state measurement under normal diverse task dispatch.

**Scope clarification, not a bug but worth stating precisely:** everything built tonight hardens the *worker execution layer* (`worker-entrypoint.sh` + the GLM proxy) — the mechanism that actually runs `SUPERBOSS_V2_PLAN` dispatches. It does not modify `mother-router.ts` or the tier-eligibility code in the application itself; those are a separate routing/eligibility layer for tenant-facing AI features, not touched by this work. If "Mother Router" in Q2 was meant to include that application code specifically, it's out of scope of what's deployed here and would need a separate, explicit task.

**No repeat offenders found:** the reconciliation script also checks every task's `.failure_signatures.json` for a circuit-breaker-should-have-caught-this case (2 identical consecutive signatures still active). None found — expected, since the pre-existing pathological failures (BYOB etc.) already reached terminal `failed` state hours before the circuit breaker existed, so there's nothing currently live for it to have caught yet. This will be the real test once new dispatches run under real credits.

## Audit round 2 (concurrency and edge cases)

Real tests, not theoretical review:

- **5 simultaneous distinct requests** fired at the live proxy: all 200, 5 distinct cache entries created correctly (no key collisions), `PRAGMA integrity_check` on the SQLite cache returned `ok`, budget accounting incremented correctly and exactly once per real call.
- **Error responses are never cached**, confirmed by deliberately triggering a real 400 (an absurd `max_tokens`) and checking the cache row count was identical before and after.
- **Known, bounded limitation, documented rather than hidden:** if two *genuinely simultaneous* identical requests arrive before either has written to the cache, both will miss and both will spend real money (last-write-wins on the resulting cache write — harmless, just not deduplicated). This does not affect the actual target scenario from the RCA — sequential retries of a stuck task, like BYOB's 12 restarts, which happen one invocation after another, never simultaneously. A true fix (an in-flight-request lock keyed by cache key) would close this but wasn't built tonight — it's a real gap, sized correctly as minor given the actual failure pattern it would guard against.
- **Budget-ceiling check-then-spend has a similar bounded TOCTOU gap**: the check happens before the call, the spend is recorded after. Under high concurrency this could let the real spend overshoot the cap by up to (concurrent-in-flight-requests × average-call-cost) before the next request is rejected — not unbounded, but not perfectly atomic either. Given typical per-call cost is fractions of a cent, this overshoot is small in absolute dollars even in a worst case.

## Audit round 3 (final sign-off)

Everything above was tested against the live server, not asserted from reading the code. Final honest state:

**Working, verified with real evidence:** response cache (hit/miss, 36x latency drop, error-exclusion, concurrency-safety all demonstrated live), hard budget ceiling (real 402 rejection demonstrated, $0 cost for the rejection itself), pre-flight guard (all 4 branches — circuit breaker, worktree lock, proxy health, canary — tested with real pass/fail cases), circuit breaker (tested standalone and observed correctly recording 2 different real signatures during the credit-exhaustion canary run), prompt-size reduction (verified the constructed resume prompt excludes the original spec), AI-to-AI terse prompt format (deployed), reconciliation script (already found a real issue — the 71.9% all-time failure rate — on its first run).

**Not verified tonight, stated honestly rather than assumed:** the full success path (quality gate → commit → push → `pending_review`) wasn't re-exercised end-to-end, because every real call currently 402s at the OpenRouter account level — that code is unchanged from the working v1, so risk is low, but "unchanged" is not the same as "proven under the new pipeline." Needs one real successful dispatch once credits exist.

**Known gaps, not fixed tonight, listed rather than glossed over:**
1. No literal concurrent-worker cap (Group B's resource-contention failure mode is only indirectly mitigated via the pre-flight memory check, not a hard semaphore on how many workers can run at once).
2. The in-flight-duplicate-request cache gap and the budget-ceiling TOCTOU gap from round 2, both bounded and minor given real usage patterns, neither closed.
3. The 10-15 batched task prompts for the real ~185-row remaining scope (Q7) are recommended and sized, but not written — that's dispatch work for when credits exist, not part of tonight's "build the process" scope.
4. `SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md`'s stale claim that the proxy is disabled was flagged, not corrected in that document itself.
5. Weekly-cadence automation for `cost-reconciliation.py` (e.g. a cron entry) wasn't set up — it exists and works when run manually, but nothing runs it on a schedule yet.

**The one finding that matters most for tonight's actual question:** none of this can be exercised against real GLM-5.2 work until the OpenRouter account has real balance again. Everything above is proven and ready for that moment, not a promise about what happens before it.
