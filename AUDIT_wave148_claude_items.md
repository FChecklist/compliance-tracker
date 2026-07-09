# AUDIT — Wave 148 (task queue + priority, multi-thread AI conversations)

Branch: `wave148/task-queue-multithread`
Auditor: Security & Code Reviewer (cross-audit — not the implementer)
Files reviewed (exactly 8, one read each): `task-service.ts`, `veri-todo-service.ts`, `ToDoTab.tsx`, `chat-service.ts`, `api/conversations/workflow-thread/route.ts`, `veri-chat-context.tsx`, `VeriComposer.tsx`, `GlobalChatDock.tsx`.

Schema change under review (inlined, not read from `schema.ts`):
```ts
priority: integer('priority').notNull().default(0),
```

---

## ITEM 1 — Task queue + priority

### 1a. `updateTask` priority bound-check

`task-service.ts`:
```ts
const VALID_PRIORITIES = [0, 1, 2, 3] // Low, Normal, High, Urgent
...
if (input.priority !== undefined) {
  if (!VALID_PRIORITIES.includes(input.priority)) return { ok: false as const, error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` }
  updates.priority = input.priority
}
```
and the caller-side translation to HTTP status:
```ts
if (!result.ok) throw new ServiceError(result.error, 400)
```

- `Array.prototype.includes` uses strict (`===`) equality, so a client-supplied string `"1"`, a float `1.5`, a negative `-1`, or `4`+ all fail the membership test and are rejected with **HTTP 400**. The `input.priority !== undefined` guard prevents the `undefined`-skips-update path from being misread as a validation failure. Correct.
- The error message echoes the allowed set back to the caller — no reflection of raw input, no injection surface.
- No path accepts an unbounded integer; the column is `notNull().default(0)` so even a row that somehow bypassed the service (direct DB) is bounded at the DB level only to non-null, but every write path goes through this check.

**Verdict: PASS.**

### 1b. Ordering — higher-priority-first, then oldest-created-first

All three task-service queries use the identical orderBy:
```ts
orderBy: [desc(tasks.priority), asc(tasks.createdAt)]
```
- `listTasks` (line ~14), `listMyTodos` (line ~165), `listAssignedByMe` (line ~180).
- `desc(priority)` → higher priority first. `asc(createdAt)` → oldest-first tiebreaker within the same priority. This is FIFO within a priority band, which is the correct queue semantics. Not newest-first. Correct.

`veri-todo-service.ts` (the unified Home queue) sorts in JS after the union:
```ts
items.sort((a, b) => {
  const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0)
  if (priorityDiff !== 0) return priorityDiff
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
})
```
- `(b.priority ?? 0) - (a.priority ?? 0)` → descending priority (higher first). `a.createdAt - b.createdAt` → ascending createdAt (oldest first). Matches the DB orderBy semantics exactly. The comment explicitly notes this was a deliberate change from the prior newest-first sort. Correct.

`ToDoTab.tsx`'s optimistic `changePriority` re-sort mirrors the same comparator:
```ts
const diff = (b.priority ?? 0) - (a.priority ?? 0);
if (diff !== 0) return diff;
return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
```
Consistent with the server. Correct.

**Verdict: PASS.**

### 1c. Non-task items (instructions / pms_issues) treated as priority 0

`veri-todo-service.ts`:
- `instruction` items: `priority: null` (line ~78).
- `pms_issue` items: `priority: null` (line ~86).
- Sort: `(b.priority ?? 0) - (a.priority ?? 0)` — `null ?? 0 === 0`, so non-task items sort as priority 0. No crash (no property access on a missing column — the value is explicitly set to `null` in the mapped object, never read off a row that lacks the column). Correct.

`ToDoTab.tsx`:
- The priority `<Select>` is gated behind `{item.source === "task" && (...)}`, so instruction/pms_issue rows never render the control and `changePriority` (which PATCHes `/api/tasks/:id`) is never invoked for them. The `?? 0` fallback in the client sort handles them identically to the server. Correct — no attempt to PATCH a non-task id through the tasks endpoint.

**Verdict: PASS.**

### Item 1 overall: PASS

---

## ITEM 2 — Multi-thread conversations

### 2a. `createWorkflowThread()` independence from `ensureAiThread()`

`chat-service.ts`:
- `ensureAiThread()` (line ~16) is the existing singleton: finds-or-creates exactly one AI thread per user, seeds a welcome message. **Untouched by this wave** — no edit to its body, no new call site added inside it.
- `createWorkflowThread()` (line ~62) is a **separate, additive** function. It unconditionally generates a new `createId()`, inserts a new `conversations` row (`isAiThread: true`, optional `workflowId`/`title`), inserts one `conversationParticipants` row for the caller, and returns the id. It does **not** call `ensureAiThread()`, does **not** query `conversationParticipants` for an existing thread, and does **not** seed a welcome message. There is no code path by which creating a workflow thread touches, reuses, or reorders the singleton.
- `listConversations()` still calls `ensureAiThread()` first (to pin the primary thread) and now also surfaces `isPrimary` / `workflowId` on each row — but that is a read-side enrichment; it does not alter the singleton's create behavior. A user who never opens the thread switcher experiences zero behavior change.

**Verdict: PASS.**

### 2b. `VeriComposer.tsx` discuss-mode fallback to singleton

`VeriComposer.tsx`, inside `send()`:
```ts
} else if (composerMode === "discuss") {
  const targetThreadId = activeAiThreadId ?? aiThreadId;
  if (!targetThreadId) { toast.error("VERI AI isn't ready yet — try again in a moment"); return; }
  const res = await fetch(`/api/conversations/${targetThreadId}/messages`, { ... })
```
- `activeAiThreadId` is the new switchable state (init `null`, set after `/api/conversations` resolves in `veri-chat-context.tsx`). `aiThreadId` is the singleton default (also init `null`, set in the same fetch callback to the `isPrimary` thread).
- Before the context fetch completes, **both** are `null` → the `!targetThreadId` guard fires a toast and returns **without** issuing a fetch to a null/`"null"` id. No `POST /api/conversations/null/messages` is ever sent. Correct.
- After the fetch resolves, `activeAiThreadId` is set to the primary id (same as `aiThreadId`), so the default experience is unchanged; switching via `AiThreadSwitcher` only changes `activeAiThreadId`. The fallback chain `activeAiThreadId ?? aiThreadId` is correct and ordered.
- `AiThreadSwitcher` is rendered only in discuss mode with no open thread (`composerMode === "discuss" && !isThreadOpen`), and returns `null` when `aiThreads.length === 0`, so it never renders a broken/empty switcher during the pre-fetch window.

**Verdict: PASS.**

### 2c. Tenant isolation in `POST /api/conversations/workflow-thread`

`api/conversations/workflow-thread/route.ts`:
```ts
const { response, dbUser, orgId } = await requireAuth()
if (response) return response
if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
...
const conversationId = await createWorkflowThread(
  { orgId, userId: dbUser.id },
  { workflowId: body.workflowId, title: body.title }
)
```
- `requireAuth()` is present and gates the route (OWASP A01 — Broken Access Control). Unauthenticated requests get the auth redirect/response. Correct.
- `orgId` and `userId` are taken **only** from the authenticated session (`dbUser.id`, `orgId`), never from `body`. The request body contributes only `workflowId` and `title`, both of which are opaque label/grouping strings stored as column values on the new row — they are **not** used to resolve any cross-tenant resource and are not interpolated into any query (no SQL injection surface; Drizzle parameterizes).
- Inside `createWorkflowThread`, both inserts use `ctx.orgId` / `ctx.userId` and run under `withTenantContext({ orgId, userId })`, so RLS scopes the writes to the caller's own org. A caller cannot inject another org's id because no org id is accepted from the client.
- `conversationParticipants` is inserted with `userId: ctx.userId` only — the caller is the sole initial participant. No way to pre-add a participant in another org.

Minor note (not a finding): `body.workflowId` is not validated against a `workflows` table / ownership check. From the inlined schema context and the code, `workflowId` is a free-form grouping label on the `conversations` row (the column was added in Wave 144 and is described as previously unwritten). It is never used to **fetch** a row or grant access — it is pure metadata on the caller's own conversation. A user passing another org's workflow id would merely mislabel their own thread; it grants no cross-tenant read/write. Not an IDOR. No action required, noted for completeness only.

**Verdict: PASS.**

### `GlobalChatDock.tsx` independence check (confirmatory)

`GlobalChatDock.tsx` maintains its own local `aiThreadId` state, populated independently from `GET /api/conversations` (picks the first `isAiThread` row). It does **not** import or consume `useVeriChat`, `activeAiThreadId`, or any Wave 148 context state. Its send path targets its own `aiThreadId` exclusively. Confirmed: completely unrelated to this wave's changes; no behavior change, no shared mutable state.

---

### Item 2 overall: PASS

---

## Overall verdict: APPROVE

No OWASP-class issues found. `requireAuth()` is present on the new route; RBAC is satisfied by session-derived `orgId`/`userId` with no client-supplied tenant identifiers. The priority bound-check is correct and rejects out-of-range values with a 400. All queue orderings are higher-priority-first then oldest-first (FIFO), consistently across the DB queries, the JS union sort, and the client optimistic sort. Non-task items are safely coerced to priority 0 and never routed through the tasks PATCH endpoint. `createWorkflowThread` is genuinely additive and does not perturb the singleton. The composer's null-guard prevents any send before threads resolve. The only observation (workflowId not validated) is metadata-only and carries no cross-tenant access risk.
