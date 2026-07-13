> **ARCHIVED / STALE — do not treat as current.** See docs/master/INDEX.md or ai-os/MASTER-TRACKER.yaml for current status.

# Audit — Wave 152 Prediction Engine (Claude's task-prediction slice)

Branch: `wave152/prediction-engine`
Files reviewed:
- `src/lib/services/task-prediction-service.ts` (new)
- `src/lib/services/construction-prediction-service.ts` (reference pattern)
- `src/app/api/tasks/[id]/prediction/route.ts` (new API route)

This is an audit-only pass. No application code was modified.

---

## 1. Does `predictTaskCompletion()` genuinely mirror `predictActivityCompletion()`'s deterministic pattern?

**Verdict: PASS (with one honest divergence that is justified, not a defect).**

Both functions share the same structural philosophy:
- Deterministic compute only — no LLM/regression call. `predictActivityCompletion` derives `dailyVelocity = quantityDoneSoFar / daysSpanned` and projects `daysRemaining = remaining / dailyVelocity`. `predictTaskCompletion` derives `averageDurationDays` from historical completed tasks and projects `predictedDate = createdAt + averageDurationDays`. Same shape: *measure a rate from history → extrapolate linearly*.
- Both early-return with a `reason` string (and `null` predicted date) on every non-computable path, and only set `confidence` on the fully-computed success path. Identical discipline.
- Both round/format the predicted date via `.toISOString().slice(0, 10)`.
- Both throw `ServiceError("... not found", 404)` for a missing entity.
- Both run inside `withTenantContext`.

The honest divergence: the construction predictor is *velocity-toward-a-target* (it needs a `plannedQuantity` to project *when* completion lands), while the task predictor is *average-duration-from-history* (there is no planned-quantity analogue for a generic task). This is a real domain difference, not a philosophical break — the task file's header comment explicitly calls out that it generalizes the *philosophy* (deterministic, history-based, confidence-tiered), not the exact formula. The claim "generalizes the same philosophy" is **real, not merely asserted**: the deterministic-no-ML stance, the early-return-with-reason pattern, the confidence-tiering, and the tenant-scoped compute all carry over faithfully.

One minor stylistic note (not a finding): the construction service scopes its `findFirst` with an explicit `eq(...orgId, ctx.orgId)` even though `withTenantContext` already enforces org scoping; the task service omits the redundant clause. Both are correct — the task service is arguably cleaner. No action needed.

---

## 2. Tenant / user isolation — is the average computed ONLY from the caller's own completed tasks?

**Verdict: PASS.**

The history query in `predictTaskCompletion`:

```ts
const completed = await db.query.tasks.findMany({
  where: and(eq(tasks.userId, ctx.userId), eq(tasks.status, "completed")),
})
```

`ctx.userId` is the only user filter, and `ctx` is constructed in the route from `dbUser.id` (the session user — see §5). `withTenantContext(ctx, ...)` additionally pins the query to `ctx.orgId` at the DB layer, so the average is constrained to *this user's* completed tasks *within this org*. There is no path by which another user's completed tasks in the same org leak into the average. The header comment also documents the deliberate choice (per-user, not org-wide) and gives the reasoning. This is correct and arguably *stricter* isolation than the construction predictor, which averages across the whole activity's entries (appropriate there, since progress entries are a shared activity log).

No cross-user data leak. No IDOR: the target `taskId` is resolved under tenant context, so a caller cannot read another org's task — a 404 is returned if the task isn't in their tenant.

---

## 3. Edge cases

### 3a. Task already completed
**PASS.** Explicit early return before any history query or division:
```ts
if (task.status === "completed") {
  return { taskId, createdAt, sampleSize: 0, averageDurationDays: null,
    predictedCompletionDate: task.updatedAt.toISOString().slice(0, 10),
    reason: "Task is already completed" }
}
```
No division, no NaN. Returns the actual completion date (via `updatedAt` proxy) as the "predicted" date, which is sensible. `confidence` is intentionally left undefined here, matching the construction service's convention of only setting confidence on a real projection.

### 3b. User has zero completed tasks yet
**PASS.** After the history query:
```ts
if (completed.length === 0) {
  return { ..., sampleSize: 0, averageDurationDays: null,
    predictedCompletionDate: null,
    reason: "No completed tasks yet to compute an average duration from" }
}
```
No division by `completed.length` is reached. Returns nulls with a reason. Correct.

### 3c. Zero-duration task (`createdAt === updatedAt`)
**PASS.** The duration map clamps to non-negative:
```ts
const durationsDays = completed.map((t) =>
  Math.max(0, (t.updatedAt.getTime() - t.createdAt.getTime()) / 86400000))
```
A task completed the instant it was created contributes `0` to the sum, not a negative and not NaN (both timestamps are real `Date` objects from the DB; subtraction yields a finite number, and `Math.max(0, …)` floors it). The average is `sum / length` with `length >= 1` (guaranteed by the §3b guard), so no division-by-zero. A history consisting *entirely* of zero-duration tasks yields `averageDurationDays = 0`, and `predictedDate = new Date(createdAt + 0)` = the creation date — a degenerate but well-defined, non-NaN, non-throwing result. Defensible.

One observation (not a defect): a single zero-duration completed task would produce `averageDurationDays: 0` and a predicted date equal to `createdAt`, with `confidence: "low"` (sampleSize 1 < 5). That is a reasonable, non-crashing outcome; flagging it as a "low confidence" prediction is exactly the right call.

---

## 4. Confidence tiering — `low <5`, `medium 5–14`, `high 15+`

**Verdict: PASS (defensible, not arbitrary).**

```ts
function computeConfidence(sampleSize: number) {
  if (sampleSize >= 15) return "high"
  if (sampleSize >= 5) return "medium"
  return "low"
}
```

The construction service's `computeConfidence(entryCount, daysSpanned)` uses `high: >=8 entries & >=21 days`, `medium: >=4 & >=7`. The task service deliberately drops the `daysSpanned` dimension and raises the entry-count thresholds, with an inline comment explaining *why*: a completion-time average's reliability is driven by sample count, not by how long the history spans (a 5-task history over 2 days is just as informative as one over 50 days for an *average duration*). That reasoning is sound — span matters for *velocity trends* (the construction case, where you need enough calendar to see a real rate), but not for a *mean of durations*.

The specific thresholds (5 / 15) are conventional small-sample-statistics cutoffs: n<5 is universally treated as "do not trust a mean," and n≥15 is a common rule-of-thumb where a sample mean's standard error becomes small enough to treat the estimate as reliable. These are standard, defensible choices — not magic numbers pulled from nowhere. The header comment ties them to the domain ("needs enough historical tasks to be meaningful"), which is the right justification. APPROVE.

---

## 5. API route auth / tenant scoping

**Verdict: PASS.**

`src/app/api/tasks/[id]/prediction/route.ts`:

```ts
export async function GET(request, { params }) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  try {
    const { id } = await params
    const prediction = await predictTaskCompletion({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(prediction)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Task prediction error:", error)
    return NextResponse.json({ error: "Failed to predict task completion" }, { status: 500 })
  }
}
```

- `requireAuth()` is called unconditionally at the top — no unauthenticated path exists. ✅
- `orgId` and `userId` (`dbUser.id`) come **only** from the session via `requireAuth()`; neither is read from `request` params, query string, or body. The only request-derived value is `id` (the task id from the URL), which is used solely as a lookup key under tenant context — it cannot override scoping. ✅
- The `if (!orgId || !dbUser)` guard rejects sessions missing org/user before any service call. ✅
- `ServiceError` (404 for missing task) is surfaced with its real status; everything else is a generic 500 with the detail logged server-side, not leaked to the client. ✅ No error-message information disclosure.
- No injection surface: `id` is passed to a Drizzle `eq(tasks.id, taskId)` parameterized query, not string-interpolated. ✅
- The route is a pure GET with no body parsing, so no mass-assignment / body-injected `orgId`/`userId` risk. ✅

This mirrors the construction prediction route's shape exactly, as the header comment claims.

---

## Summary table

| Check | Verdict |
|---|---|
| Mirrors deterministic velocity/average philosophy (not just asserted) | PASS |
| Tenant/user isolation — average from caller's own completed tasks only | PASS |
| Edge: already-completed task | PASS |
| Edge: zero completed tasks | PASS |
| Edge: zero-duration task (no NaN / negative) | PASS |
| Confidence thresholds defensible, not arbitrary | PASS |
| Route auth + session-only orgId/userId, no param injection | PASS |

No OWASP-class issues found. No broken auth, no IDOR (target task resolved under tenant context → 404 on cross-tenant), no injection (parameterized Drizzle queries), no XSS (JSON API, no HTML rendering), no cross-user data leak.

Minor non-blocking notes (no code change requested):
- The `updatedAt`-as-completedAt proxy is documented in the header and is accurate for the current codebase, but it is a load-bearing assumption. If a future feature touches `tasks` after `status='completed'` (e.g. a "reopened" audit log writing to `updatedAt`), this predictor's history could silently skew. Worth a one-line regression test guarding that assumption, but not a blocker for this slice.
- `Math.round(averageDurationDays * 10) / 10` rounds to one decimal for the *returned* value but the projection uses the unrounded average — correct (round only for display), just noting it's intentional.

---

**Overall verdict: APPROVE.**

The "generalizes the same philosophy" claim is substantiated by the code, not just the comment. Isolation is correct and stricter than the reference. All three edge cases are handled without NaN/divide-by-zero/throw. Confidence thresholds are defensible. The route is authed and session-scoped with no param-derived identity. No changes requested.
