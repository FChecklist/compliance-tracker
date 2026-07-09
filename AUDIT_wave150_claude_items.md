# AUDIT — Wave 150: central "Need LLM?" routing gate

**Branch:** `wave150/llm-routing-gate`
**Files reviewed:** `src/lib/llm-routing-gate.ts`, `src/lib/llm-routing-gate.test.ts`, `src/lib/intent-engine.ts` (context only, audited Wave 149), `src/lib/services/chat-service.ts` (scoped to `tryDeterministicRoute` wiring in `generateAiReply`).
**Reviewer:** Security & Code Reviewer (VERIDIAN AI Workforce)
**Scope:** AUDIT-ONLY. No application code modified.

---

## 1. Is DB access genuinely deferred to a dynamic import inside the `check_status` handler, not at module top-level?

**Verdict: PASS.**

`llm-routing-gate.ts` top-level imports exactly one thing:

```ts
import { classifyIntent, type Intent } from "./intent-engine"
```

Every database-touching symbol is resolved with `await import(...)` *inside* the `check_status` handler body, not at module scope:

```ts
check_status: async (ctx) => {
  const { withTenantContext } = await import("@/lib/db/tenant-scoped")
  const { tasks } = await import("@/lib/db")
  const { eq, and, desc } = await import("drizzle-orm")
  ...
}
```

**Trace — "does importing `llm-routing-gate.ts` alone, without ever calling the `check_status` handler, ever touch a database connection?":** No. The module's only static dependency is `intent-engine.ts`. The three DB modules (`@/lib/db/tenant-scoped`, `@/lib/db`, `drizzle-orm`) are dynamic imports nested inside a function that is only invoked when (a) `classifyIntent` returns `check_status` AND (b) `HANDLERS.check_status` is looked up and called. For the other 3 classified intents plus `unknown`, `HANDLERS[classification.intent]` is `undefined` and `tryDeterministicRoute` returns `{ handled: false }` before any handler body runs — so the dynamic `import()` calls are never even *initiated*, let alone resolved. Importing the module is therefore provably DB-free by construction.

The one residual dependency I cannot fully verify from this wave alone is whether `intent-engine.ts` (statically imported at top-level) itself eagerly imports the DB. That file was audited separately in Wave 149 and is out of scope here; however, see item 2 — the test file's own ability to execute without `DATABASE_URL` is independent corroboration that the *entire* static import graph rooted at `llm-routing-gate` (which includes `intent-engine`) is DB-free at load time.

---

## 2. Do the 5 unit tests genuinely prove "unmatched intents never touch the database"?

**Verdict: PASS (with a note on what the proof actually is).**

The five tests each assert only the return value:

```ts
expect(result).toEqual({ handled: false })
```

Taken in isolation, these assertions do **not** directly prove "no DB call happened" — a test could pass `toEqual({ handled: false })` even if the code had secretly opened and closed a connection. There is no spy on `import()`, no mock of `withTenantContext`, and no `DATABASE_URL` assertion. So the *assertions inside each test* are not, by themselves, the no-DB proof.

**But the stronger evidence is structural + environmental, and it holds:**

1. **Structural (code reading):** For every unmatched intent, `HANDLERS[classification.intent]` is `undefined`, so `tryDeterministicRoute` returns `{ handled: false }` *before* any handler runs. The dynamic `import()` calls live exclusively inside handler bodies that never execute on these paths. No DB module is ever resolved on an unmatched path — this is provable by reading `tryDeterministicRoute` and the `HANDLERS` map, independent of any test.

2. **Environmental (the test file's own success):** The test file does `import { tryDeterministicRoute } from "./llm-routing-gate"`, which statically pulls in `intent-engine`. If *any* module in that static import graph eagerly imported `@/lib/db` (which initializes a Drizzle/Postgres pool at module scope), the test suite would fail to load without a live `DATABASE_URL`. The tests run green with no database configured — which is itself the real-world evidence that the lazy-import claim is true across the whole import chain, not just inside `llm-routing-gate.ts`. This is exactly the reasoning the task asks for: the test file's success *without* `DATABASE_URL` is the proof, not the `toEqual` lines.

**Note (not a blocker):** A more rigorous future test would `vi.spyOn`/mock the dynamic `import("@/lib/db")` and assert it was never called on unmatched paths, making the no-DB guarantee explicit rather than implicit-in-the-environment. The current tests are correct but rely on structural reasoning + the absence of `DATABASE_URL` to make the point. Acceptable for v1; worth tightening when the handler set grows beyond the single `check_status` case.

---

## 3. Is the routing gate wired into `chat-service.ts` BEFORE `resolveModelConfig` / prompt-template resolution, or after?

**Verdict: PASS — correctly placed BEFORE.**

In `generateAiReply` (chat-service.ts), the ordering is:

1. `enforcePolicy(...)` — hard pre-call policy gate (Wave 46). A denied request returns a refusal message and never proceeds.
2. **`tryDeterministicRoute({ orgId, userId }, userMessage)`** — Wave 150 routing gate. If `routed.handled`, the deterministic reply is inserted and returned immediately.
3. `resolveModelConfig(orgId, "user_assistant_oa")` — only reached on fall-through.
4. `resolvePromptTemplate("chat.ai_thread_system")` — only reached on fall-through.
5. `buildConversationHistory(...)` — only reached on fall-through.
6. `callLLM(...)` — only reached on fall-through.

The Wave 150 comment block in `generateAiReply` explicitly states this: *"checked before resolveModelConfig/prompt-template resolution/history building even runs — a matched deterministic route skips all of that plus the actual LLM call entirely."* The code matches the comment exactly. A matched `check_status` therefore incurs zero model-config lookups, zero prompt-template resolution, zero history builds, and zero LLM provider calls. Correct and cost-optimal.

One observation worth recording (not a defect): the deterministic route runs *after* `enforcePolicy` but its reply is inserted **without** passing through `passesReplyGate` (the Phase 3 "no hallucinated claim of completed action" gate that the LLM reply path uses). This is defensible — a deterministic handler returns a hardcoded/DB-sourced string, not free-form LLM output, so the hallucinated-completion risk that `passesReplyGate` exists to catch does not apply. But it means the `check_status` reply text is trusted as-is; any future handler that *composes* user-controlled data into its reply should be re-evaluated for that gate. The current `check_status` reply interpolates `latest.title` (user/org-controlled) into the string — see item 4.

---

## 4. Could a matched deterministic handler return a WRONG or misleading answer in an easy-to-trigger case?

**Verdict: CONCERN (low severity, no security impact) — zero-tasks fallback is fine; the multi-task / cross-org case is accurate; one minor wording nit.**

Tracing `check_status`:

**Zero-tasks case:**
```ts
if (!latest) return "You don't have any tasks yet -- give me something to do and I'll track it here."
```
This is accurate and not misleading. A user with no tasks gets a clear "you don't have any tasks yet" message rather than a fabricated status. Correct.

**User with tasks in multiple orgs:** The query runs inside `withTenantContext(ctx)` where `ctx = { orgId, userId }` passed from `generateAiReply`'s `{ orgId, userId }`. The tenant context scopes RLS to the caller's org, so tasks belonging to the same user in a *different* org are not visible and cannot be returned. The reply ("Your most recent task…") is therefore scoped to the current org — accurate, not misleading. (See item 5 for the isolation detail.)

**Most-recent-task selection:** `orderBy: desc(tasks.createdAt)` + `findFirst` returns the single newest task for that user in that org. The reply reports that one task's status. This is a reasonable interpretation of "check status" and is not misleading — it does not claim to summarize *all* tasks, only "your most recent task."

**Minor wording nit (not a defect, no action required):** The reply says `is ${statusLabel[...]}` using a hardcoded label map (`pending`, `in_progress`→"in progress", etc.). If a task ever carries a status outside that map, it falls back to the raw `latest.status` value, which is still accurate (just unpresented). No wrong answer is possible here.

**No injection / misleading-answer risk from `latest.title`:** `latest.title` is interpolated into the reply string and then persisted via `db.insert(messages).values({ ..., content: routed.reply })` in `generateAiReply`. It is stored as plain message content and rendered by the existing chat UI. There is no `eval`, no template-string-as-SQL, no HTML injection sink in this path — the title is data, not code. (If the chat UI ever rendered message content as raw HTML, that would be a pre-existing XSS concern in the UI layer, not introduced by Wave 150; the gate merely passes a string through the same `messages.content` column every other reply uses.) No new risk introduced.

---

## 5. Any tenant-isolation issue in how `check_status` queries tasks?

**Verdict: PASS — scoped by both orgId (via `withTenantContext` RLS) AND userId (explicit WHERE). No cross-user leak within an org.**

The handler query:

```ts
const latest = await withTenantContext(ctx, (db) =>
  db.query.tasks.findFirst({
    where: and(eq(tasks.userId, ctx.userId)),
    orderBy: desc(tasks.createdAt),
  })
)
```

Two independent isolation controls are in play:

1. **Org scoping — `withTenantContext(ctx)`** where `ctx = { orgId, userId }`. This is the same tenant-context wrapper used throughout `chat-service.ts` (e.g. `ensureAiThread`, `getMessages`, `sendMessage`). It sets the RLS context so the `tasks` table's row-level security restricts visible rows to the caller's `orgId`. A task in a different org is invisible regardless of any WHERE clause.

2. **User scoping — `eq(tasks.userId, ctx.userId)`** in the explicit WHERE. This restricts to the calling user's own tasks *within* the already-org-scoped context. Another user's task in the *same* org is excluded by this filter (and would also be excluded by any `tasks` RLS policy keyed on `userId`, defense in depth).

**Could it leak another user's task in the same org?** No. The explicit `eq(tasks.userId, ctx.userId)` guarantees the result is the calling user's own task. Even if RLS were misconfigured to be org-only (not user-scoped), the application-level WHERE still enforces user isolation. This matches the codebase's stated "defense in depth, not the sole guarantee" pattern (see the RLS comments in `chat-service.ts`'s `listMyInstructionMismatches`).

**`ctx` provenance:** `ctx` is constructed in `generateAiReply` from the authenticated `orgId`/`userId` that `sendMessage` derived from `ChatContext` — there is no user-supplied `orgId`/`userId` injection point on this path. The `userMessage` text is only passed to `classifyIntent` (for intent selection) and never flows into the query's `where`/`orderBy`. No injection vector.

---

## Summary table

| # | Check | Verdict |
|---|-------|---------|
| 1 | DB access deferred to dynamic import inside handler, not module top-level | **PASS** |
| 2 | 5 tests prove unmatched intents never touch DB | **PASS** (proof is structural + test-runs-without-DATABASE_URL, not the `toEqual` lines alone) |
| 3 | Gate wired BEFORE `resolveModelConfig`/prompt-template resolution | **PASS** |
| 4 | Matched handler could return wrong/misleading answer in easy cases | **CONCERN** (low; zero-tasks fallback correct, multi-org/cross-org accurate; minor label-map nit only) |
| 5 | Tenant isolation in `check_status` query (orgId + userId) | **PASS** |

---

## Notes for follow-up (non-blocking)

- **Tighten the test suite when handlers grow:** add a spy/mock asserting the dynamic `import("@/lib/db")` is never resolved on unmatched-intent paths, so the no-DB guarantee is an explicit assertion rather than an environmental side effect. Valuable once a second handler is registered and the "unmatched = no DB" invariant becomes less obvious by eye.
- **`passesReplyGate` does not run on deterministic replies:** correct for v1 (deterministic handlers don't hallucinate), but any future handler that *composes* user/org-controlled strings into its reply should be re-checked against the same "no hallucinated claim of completed action" concern the LLM path guards against.
- **`latest.title` interpolation:** safe today (stored as plain `messages.content`, no code-eval or HTML sink on this path), but worth a one-line note that the gate trusts handler output as-is.

---

## Overall verdict: **APPROVE WITH NOTES**

Wave 150 is a clean, purely-additive routing gate. The lazy-import claim is structurally true and independently corroborated by the test suite running without `DATABASE_URL`. The gate is correctly placed before all LLM-side work in `generateAiReply`. The single `check_status` handler is tenant-isolated on both org (RLS via `withTenantContext`) and user (explicit `eq(tasks.userId, …)`), with no injection surface and an accurate zero-tasks fallback. The only items raised are low-severity notes for when the handler set expands, not defects in what was shipped. No OWASP-class issue, no broken auth/RBAC gap, no IDOR, no injection. Approve for merge.
