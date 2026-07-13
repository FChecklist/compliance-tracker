> **ARCHIVED / STALE — do not treat as current.** See docs/master/INDEX.md or ai-os/MASTER-TRACKER.yaml for current status.

# AUDIT — Wave 157 (Claude): Guardrail Engine v1

Branch: `wave157/guardrail-engine`
Files reviewed: `src/lib/guardrail-engine.ts`, `src/lib/guardrail-engine.test.ts`, `src/lib/loop-improvement-proposer.ts`
Scope: AUDIT-ONLY. No application code modified.

---

## 1. Is the "not rigid" claim genuinely true? (unregistered leaf/phase → `{ passed: true }`, zero side effects)

**PASS — confirmed by tracing, not by trusting the test.**

`evaluateGuardrails` (guardrail-engine.ts):

```ts
const rules = (REGISTRY.get(leafKey) ?? []).filter((r) => r.phase === phase)
for (const rule of rules) { ... }
return { passed: true }
```

For an unregistered `leafKey`, `REGISTRY.get(leafKey)` is `undefined`, the `?? []` yields an empty array, `.filter(...)` yields an empty array, the `for` loop body never executes, and the function returns the literal `{ passed: true }`. For a registered leaf but unregistered *phase*, the `.filter((r) => r.phase === phase)` step removes every rule, producing the same empty-array path.

Side-effect trace: the function reads only from the module-level `REGISTRY` Map, performs no mutation of it, performs no I/O, no logging, no DB write, and calls no `check` (the loop is empty). The returned object is a fresh literal each call. There is no path through the function that touches anything outside its own stack when the rule set is empty. The "silence means no constraint, not an implicit failure" guarantee is real.

The test (`guardrail-engine.test.ts`, "a leaf with zero registered rules always passes, for every phase") corroborates this, but the verdict rests on the trace, not the test.

---

## 2. Does `registerGuardrail()` isolate rules per leaf AND per phase?

**PASS.**

`registerGuardrail` stores rules in a `Map<string, GuardrailRule[]>` keyed solely by `leafKey`:

```ts
const existing = REGISTRY.get(leafKey) ?? []
REGISTRY.set(leafKey, [...existing, rule])
```

A rule registered for `leaf.a` lives only under the `"leaf.a"` key. `evaluateGuardrails("leaf.b", ...)` does `REGISTRY.get("leaf.b")` — a different Map key — and never sees `leaf.a`'s rules. Leaf isolation is structural (Map keying), not accidental.

Phase isolation happens in `evaluateGuardrails` via `.filter((r) => r.phase === phase)`. A rule with `phase: "input"` registered for `leaf.a` is present in `REGISTRY.get("leaf.a")`, but when `evaluateGuardrails("leaf.a", "process", ...)` runs, the filter discards it, so the loop sees zero rules and returns `{ passed: true }`. The test "registering a rule for one phase does not affect other phases on the same leaf" asserts exactly this; the trace confirms it.

One minor note (not a defect): multiple rules per leaf+phase are additive and run in registration order with first-failure-wins. That is documented in the `registerGuardrail` JSDoc ("Additive -- multiple rules per leaf/phase are allowed") and tested. No isolation issue, but a future caller should be aware ordering is registration-order-dependent.

---

## 3. Is `check()` genuinely required to be synchronous/deterministic by the type signature?

**CONCERN — synchronous is enforced by the type; deterministic is not.**

The exact signature (guardrail-engine.ts):

```ts
check: (context: Record<string, unknown>) => GuardrailCheckResult
```

`GuardrailCheckResult` is a plain union of object literals, **not** `Promise<GuardrailCheckResult>`. A caller writing `check: async (ctx) => ({ passed: true })` produces a function of type `(ctx) => Promise<{passed:true}>`, which is **not assignable** to `(ctx) => GuardrailCheckResult` — TypeScript will reject it at compile time (a `Promise` is not a `{ passed: true }`). So the async/LLM-returning-a-promise path is genuinely blocked by the type, not merely by convention. Good.

However, "deterministic" is a JSDoc comment (`/** Deterministic only -- no LLM call... */`), **not** something the type can enforce. A synchronous `check` could still:
- call `fetch()`/a sync HTTP shim and block the event loop,
- read `Date.now()` / `Math.random()` / external mutable state,
- mutate the `context` argument or global state as a side effect,
- be wrapped via `as any` / `as GuardrailRule` to defeat the signature entirely.

The type signature therefore enforces *synchronous return shape* (which is the meaningful, machine-checkable half of the intent) but cannot enforce *determinism* or *purity*. This is an inherent limitation of a type system, not a bug in this code — but the auditor flags it so the claim "deterministic by construction" isn't overstated. It's "synchronous by construction; deterministic by convention + review." The test "check functions are deterministic -- calling twice with the same input gives the same result" only proves the *sample* rule is deterministic, not that the type guarantees it.

Recommendation (note, not a blocker): if determinism matters enough to assert, add a lint/test-time guard or a `// @ts-expect-error` regression test asserting an async `check` fails to type-check, so the synchronous guarantee is locked in by a test rather than by inspection alone.

---

## 4. Does `recordGuardrailViolation()`'s call to `proposeLoopImprovement()` match the real parameter type?

**PASS — every field lines up.**

`LoopImprovementProposal` (loop-improvement-proposer.ts):

```ts
{
  loopId: string
  improvementType: string
  targetType: string
  targetId?: string | null
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
  improvementDelta?: number | null
}
```

The call in `recordGuardrailViolation` (guardrail-engine.ts):

```ts
await proposeLoopImprovement({
  loopId,                                  // string            -> loopId: string        ✓
  improvementType: "guardrail_violation",  // string literal    -> improvementType       ✓
  targetType: "capability_leaf",            // string            -> targetType: string     ✓
  targetId: leafKey,                        // string            -> targetId?: string|null ✓
  beforeState: { phase, reason: result.reason }, // Record<string,unknown> -> beforeState ✓
  afterState: null,                         // null              -> afterState?: ...|null  ✓
})
```

`improvementDelta` is omitted, which is allowed (optional). `targetId` is a `string` and the field accepts `string | null | undefined` — fine. `beforeState` is `{ phase: GuardrailPhase, reason: string }`, which is a valid `Record<string, unknown>`. `afterState: null` matches `... | null`. The `result` parameter is typed as `Extract<GuardrailCheckResult, { passed: false }>`, so `result.reason` is statically present (no `undefined` leak into `beforeState`). Shape match is exact.

Downstream in `proposeLoopImprovement`, `targetId ?? null`, `beforeState ?? null`, `afterState ?? null` are passed straight into `db.insert(loopImprovements).values(...)`, and `isDeployed: false` is hardcoded — so the human-gating posture claimed in the guardrail-engine header ("proposeLoopImprovement always sets isDeployed: false") is accurate. No silent autonomous-deploy path is opened by this caller.

---

## 5. Is deferring the "wire into `high-impact-action-detector.ts`" step defensible?

**Defensible — and I agree with the call, with one caveat.**

Real opinion: yes, this should be deferred, not done now. Reasoning:

1. `high-impact-action-detector.ts` is an **already-audited, working safety gate** (Wave 146). It currently does its job deterministically and is trusted. Refactoring it mid-wave to route through a new framework — purely to prove the framework has a consumer — would change the execution path of a live safety mechanism for **zero functional gain**. The risk/reward is upside-down: the only payoff is "the new file is used," and the cost is a possible regression in something that currently protects users.
2. The framework's whole design thesis is **opt-in, empty-by-default**. Shipping it with zero registrations is internally consistent with that thesis — it is not a missing feature, it is the feature. Forcing a registration in the same PR would actually undermine the "not rigid" guarantee the framework exists to provide.
3. This matches the established discipline in this codebase: Phase 3's graph store and event bus both shipped as real infrastructure before they had consumers, rather than contriving a consumer to justify the PR. Consistency with that precedent is a point in favor, not a gap.

Caveat (why this is "approve with notes" rather than a clean approve): the deferral is only defensible **if it is tracked**. A deferred refactor that lives only in a PR description is a refactor that doesn't happen. The auditor's push-back is not "do it now" but "create a tracked follow-up task (issue/ticket) for retrofitting `high-impact-action-detector.ts`'s categories through this framework's `process` phase, and reference it from the header comment." As written, the header comment names the deferral but does not point to a tracked item. That is the one concrete thing I'd ask Claude to add before merge — a ticket reference, not code.

---

## Summary table

| # | Question | Verdict |
|---|----------|---------|
| 1 | Unregistered leaf/phase → `{passed:true}`, zero side effects | PASS (traced) |
| 2 | Per-leaf AND per-phase isolation | PASS |
| 3 | `check()` sync/deterministic by type | CONCERN — sync enforced by type; deterministic is convention only |
| 4 | `recordGuardrailViolation` → `proposeLoopImprovement` shape match | PASS (exact) |
| 5 | Deferring `high-impact-action-detector.ts` wiring | Defensible; add a tracked follow-up ticket reference |

---

## Overall verdict: APPROVE WITH NOTES

The framework is small, internally consistent, correctly isolated, and its CLEE integration shape-matches the existing helper exactly. The only substantive finding is that "deterministic" is a documented intent, not a type-enforced one (the synchronous half *is* type-enforced; the pure/deterministic half is not, and cannot be by a type alone). The deferral of the `high-impact-action-detector.ts` retrofit is the right call, provided it becomes a tracked follow-up rather than a comment-only promise. No OWASP-class issue, no missing auth/RBAC surface (this module performs no request handling and introduces no route), no injection vector (no string interpolation into SQL — `proposeLoopImprovement` uses parameterized `db.insert`), no IDOR (no user-supplied object lookup). Mergeable once the follow-up ticket reference is added to the header comment.
