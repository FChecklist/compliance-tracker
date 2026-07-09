# Phase 3 Cross-Audit — Claude-implemented items

**Auditor:** z.ai (Security & Code Reviewer, VERIDIAN AI Workforce)
**Scope:** Phase 3 of the Joint Implementation Plan, implemented by Claude per
`Phase3_Design_by_Claude.md`. Per Operating Rule 7 (mandatory cross-audit), I
audit this because I did not implement it. Four items: graph store, event bus,
software-first reply gate, and a CodeQL-flagged ReDoS fix in my own
`prompt-normalizer.ts` (Phase 2) that Claude patched.

Files reviewed (each exactly once): `Phase3_Design_by_Claude.md`,
`drizzle/0129_phase3_entity_relationships.sql`,
`src/lib/services/entity-graph-service.ts`, `src/lib/event-bus.ts`,
`src/lib/ai-reply-gate.ts`, `src/lib/services/chat-service.ts`,
`src/lib/prompt-normalizer.ts`. The `entityRelationships` schema excerpt was
provided inline (schema.ts not read directly).

---

## ITEM 1 — Graph store (migration + service) — **PASS**

### Schema ↔ migration column match
Every column in the migration SQL matches the schema excerpt exactly on name,
type, and nullability:

| column | schema | migration | match |
|---|---|---|---|
| id | `text` PK, `$defaultFn(createId())` | `text PRIMARY KEY DEFAULT gen_random_uuid()::text` | type/PK ✓ |
| org_id | `text` notNull | `text NOT NULL` | ✓ |
| source_type / source_id | `text` notNull | `text NOT NULL` | ✓ |
| target_type / target_id | `text` notNull | `text NOT NULL` | ✓ |
| relationship_type | `text` notNull | `text NOT NULL` | ✓ |
| metadata | `jsonb` (nullable) | `jsonb` (nullable) | ✓ |
| created_at / updated_at | `timestamp` notNull `defaultNow()` | `timestamp NOT NULL DEFAULT now()` | ✓ |

One cosmetic note (not a defect): the ORM `$defaultFn` produces a `cuid2`
(`createId()`), while the SQL-level `DEFAULT gen_random_uuid()::text` produces a
UUID. On ORM inserts the `$defaultFn` wins, so live writes get cuid2; only raw
SQL inserts (none exist today — zero consumers by design) would get UUIDs. Both
are valid `text` PKs and the column is `text` either way, so there is no type or
length incompatibility. Worth a one-line comment in the migration if a future
raw-SQL writer is expected, but not blocking.

Indexes match the design doc: `idx_entity_relationships_source (org_id,
source_type, source_id)`, `idx_entity_relationships_target (org_id,
target_type, target_id)`, and the unique edge index
`uq_entity_relationships_edge (org_id, source_type, source_id, target_type,
target_id, relationship_type)`. Both-direction traversal and duplicate-edge
prevention are covered.

### RLS
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is present. Two policies are
created, both `FOR ALL`, both guarded by `EXCEPTION WHEN duplicate_object`:

1. `app_runtime_tenant_isolation` on role `app_runtime`, `USING (org_id =
   compliance.current_org_id())` — correctly scoped by `org_id` via the same
   `current_org_id()` session function the rest of the tenant model uses. No
   explicit `WITH CHECK` is given; for a `FOR ALL` policy Postgres defaults
   `WITH CHECK` to the `USING` expression, so INSERT/UPDATE are also constrained
   to `org_id = current_org_id()`. Tenant isolation is enforced for reads and
   writes. ✓
2. `service_role_bypass_entity_relationships` on role `service_role`,
   `USING (true)` — the standard privileged bypass for migrations/internal
   jobs. ✓

This is the exact `interior_mood_boards` policy shape the design doc said it was
copying. No `PUBLIC` policy, no `USING (true)` on `app_runtime`. Correct.

### Service tenant-scoping
Every exported function in `entity-graph-service.ts` wraps its DB access in
`withTenantContext(ctx, (db) => ...)`, where `ctx` carries `orgId`/`userId`.
`createRelationship` writes `orgId: ctx.orgId` explicitly; the read/delete
functions rely on RLS (set by `withTenantContext`'s session variable) rather
than an explicit `orgId` filter in the `WHERE`. That is the established
convention in this codebase (every other service in `src/lib/services/` does the
same) and is defense-via-RLS, not a missing check — `current_org_id()` is what
makes the `app_runtime_tenant_isolation` policy actually isolate.

`deleteRelationship(ctx, id)` deletes by `id` only. This is the one spot that
*looks* like an IDOR surface, but it is not: the delete runs under
`withTenantContext`, so RLS restricts the affected row to the caller's `org_id`.
A caller passing another tenant's `id` simply deletes zero rows (the row is
invisible to `app_runtime`). No cross-tenant delete is possible. ✓

### getNeighbors searches both sides
`getNeighbors` builds an `or()` of two `and()` clauses — one matching
`sourceType/sourceId`, one matching `targetType/targetId` — against the same
entity. It genuinely merges both directions, not just the source side. ✓

**Verdict: PASS.** No injection, no broken auth, no IDOR, no missing tenant
isolation. The only note is the cosmetic cuid2-vs-uuid default mismatch, which
is inert for current ORM-driven writes.

---

## ITEM 2 — Event bus — **PASS**

### Async-safety of publish()
`publish()` fans handlers out via `Promise.all(Array.from(set).map(async ...))`,
and each mapped callback wraps `await handler(payload)` in `try/catch`, logging
on catch:

```ts
await Promise.all(
  Array.from(set).map(async (handler) => {
    try { await handler(payload) }
    catch (err) { console.error(`[event-bus] subscriber to "${String(event)}" threw:`, err) }
  })
)
```

Because the catch swallows the rejection, the mapped promise always resolves, so
`Promise.all` never rejects. Consequences:

- A throwing subscriber cannot prevent any *other* subscriber in the same
  `publish()` call from running — all handlers are scheduled concurrently by
  `Promise.all`, and each is independently try/catch-guarded. ✓
- A throwing subscriber cannot stop the `publish()` promise from resolving — the
  outer `Promise.all` resolves once every mapped promise resolves (which they
  all do, via catch). ✓

The only behavioral nuance: handlers run **concurrently**, not sequentially
(the design doc says "publish awaits all handlers but isolates failures
per-handler" — concurrent execution satisfies that). If a future subscriber
depends on ordering relative to another subscriber in the same event, that
ordering is not guaranteed; but no such subscriber exists today (zero call
sites), so this is a forward note, not a defect.

### Honesty about non-durability
The file's header comment is explicit and accurate: it states this is
"deliberately NOT a durable cross-invocation queue," explains *why* (Vercel
serverless, no shared memory across invocations), and explicitly warns that "a
fake 'durable' bus on an in-memory Map would silently drop events on every cold
start." It does not oversell: it never claims persistence, ordering across
requests, or at-least-once delivery. The `Map`-backed `listeners` is plainly
in-memory and the `_clearAllListenersForTests()` escape hatch confirms the
intended scope. No reader could mistake this for a durable queue. ✓

**Verdict: PASS.** Fault isolation is correctly implemented; the
non-durability limitation is honestly documented, not concealed.

---

## ITEM 3 — Software-first reply gate — **CONCERN**

### detectFalseActionClaim phrase-list precision
The phrase list is exclusively **first-person + past-tense + high-impact verb**:
`"i have deleted"`, `"i've deleted"`, `"i have approved"`, `"i've approved"`,
`"i have paid"`, `"i've paid"`, `"i've made the payment"`, `"i have submitted"`,
`"i've filed"`, `"i have granted access"`, `"i've revoked access"`,
`"i have archived"`, etc. Matching is `lower.includes(phrase)` (substring on the
lowercased reply).

Against the two specific informational replies the audit asks about:

- **"Your payment was recorded"** → lowercased `"your payment was recorded"`.
  Contains none of the phrases (no `"i have paid"` / `"i've paid"` / `"i have
  made the payment"`). **Does not trigger.** ✓
- **"This was approved by your manager"** → lowercased `"this was approved by
  your manager"`. Contains `"approved"` but not `"i have approved"` or `"i've
  approved"`. **Does not trigger.** ✓

The first-person framing is what makes the distinction: a third-person
informational statement ("payment was recorded", "this was approved by your
manager") structurally cannot contain `"i have <verb>"` / `"i've <verb>"`. This
is exactly the precision property the design doc intended, and it correctly
diverges from Phase 2's `detectHighImpactAction` (which would false-positive on
"Your payment was recorded" because it keys on the verb alone).

One residual precision edge (accepted, documented, not a defect): because
matching is substring-based, a sentence like "I have paid attention to your
concern" would match `"i have paid"`. This is a known precision-over-recall
tradeoff the design doc explicitly accepts ("a false positive here blocks a
legitimate reply"), and the phrase list is narrow enough that such collisions
are rare in practice. Noting it for completeness; not a finding.

### Gate wiring: after generation, before insert
In `generateAiReply()` (chat-service.ts), the sequence is:

1. `const { content: reply, usage } = await callLLM(...)` — reply generated.
2. `recordOrchestraExecution({ ..., status: "completed", output: { reply:
   redactPii(reply), replyLength: reply.length } })` — see CONCERN below.
3. `const gateResult = passesReplyGate(reply)` — gate runs **after** the reply
   exists, **before** any `messages` insert.
4. On `!gateResult.passed`: a second `recordOrchestraExecution` with
   `status: "gated"` is written, and the `messages` insert stores the **safe
   fallback** (`"I wasn't able to give a reliable answer..."`), **not** `reply`.
5. On pass: `db.insert(messages).values({ ..., content: reply })`.

So a gated reply never reaches the `messages` table and therefore never reaches
the user. The user-visible content on a gate failure is the static fallback.
✓ The gate is correctly positioned.

### CONCERN: the pre-gate "completed" log re-logs the raw ungated reply
Step 2 above is the problem. `recordOrchestraExecution` with
`status: "completed"` is called **before** `passesReplyGate` runs, and its
`output` includes `reply: redactPii(reply)` — i.e. the full raw ungated reply
text (PII-redacted, but otherwise verbatim). When the reply is subsequently
gated in step 3-4, two `orchestra_executions` rows exist for the same call:

- a `"completed"` row whose `output.reply` is the **full raw ungated reply**
  (redacted), and whose `status` is `"completed"` — which is misleading, because
  the reply was never completed/delivered; it was gated and replaced with a
  fallback; and
- a `"gated"` row whose `output` is correctly limited to `{ reason,
  matchedPhrase }` — **no raw reply text**. ✓ (the gated row itself is clean.)

The audit question asks whether the log for a gated reply "avoid[s] re-logging
the raw ungated reply text anywhere." The `"gated"` row avoids it. The preceding
`"completed"` row does **not** — it contains the full redacted raw reply. So the
raw ungated reply text *is* persisted to `orchestra_executions` for gated
replies, just in the `"completed"` row rather than the `"gated"` row.

Severity assessment: this is a **CONCERN, not a FAIL**. The `orchestra_executions`
table is tenant-scoped/RLS-protected (the Wave 144 comment in the same function
confirms this) and the reply is PII-redacted before write, so there is no
user-facing leak and no cross-tenant exposure — the gated reply never reaches
the `messages` table or the UI. The issue is twofold: (a) the `"completed"`
status is factually wrong for a reply that was then gated (it implies success),
which muddies audit/observability of the gate; and (b) the design doc's stated
intent ("a safe fallback message is stored instead ... and
recordOrchestraExecution logs status: 'gated' with the reason — so this is
auditable, not silent") is only half-met: the gate *is* auditable via the
`"gated"` row, but the raw reply it gated against is *also* retained in the
`"completed"` row, which the design doc does not acknowledge.

Recommended fix (small, scoped): move the `status: "completed"` log to **after**
the gate passes (so a gated reply produces only the `"gated"` row, with no raw
reply retained), or — if retaining the raw reply for debugging is desired —
relabel the pre-gate row (e.g. `status: "generated"` rather than `"completed"`)
and document that the raw reply is intentionally retained for gate forensics.
Either resolves the misleading-status and the unacknowledged-retention issues
without changing the gate logic itself.

**Verdict: CONCERN.** Gate placement and user-facing safety are correct (gated
reply never reaches the user). The pre-gate `"completed"` log row retains the
full redacted raw reply and carries a misleading `"completed"` status for
replies that were in fact gated; recommend relocating or relabeling that log
entry.

---

## ITEM 4 — ReDoS fix (collapseWhitespaceAndPunctuation) — **PASS**

### No regex with quantifiers in the hot path
`collapseWhitespaceAndPunctuation` contains **zero regex**. It is a single
`for (const ch of s)` pass over the string with two `Set.has()` lookups per
character (`WHITESPACE_CHARS`, `PUNCTUATION_CHARS`) and string concatenation.
There is no `RegExp`, no `.replace`, no `.match`, no `.split`, and therefore no
possibility of backtracking or catastrophic repetition. It is O(n) by
construction. The CodeQL-flagged `\s+`-based `replace()` chain it replaces is
gone from this function. ✓

I also checked the rest of `normalizeForLlm` for leftover unbounded-repetition
regex applied to user-controlled text, since the audit asks about the hot path
broadly:

- Phase A filler stripping: `new RegExp(\`\\b${escapeRegex(phrase)}\\b\`, "gi")`
  — `escapeRegex` escapes every regex metacharacter in the phrase, so the
  pattern is a **fixed literal string** anchored by zero-width `\b` assertions.
  No quantifier, no alternation, no backtracking risk. ✓
- `spanContainsDenylistedWord`: `new RegExp(\`\\b${escapeRegex(w)}\\b\`)` — same
  fixed-literal-with-`\b` shape. ✓
- Phase B: `working.split(/([.,;!?])/)` — a character class with no quantifier.
  ✓
- Final emptiness guard: `working.replace(/[^\w]/g, "")` — a negated character
  class with a global flag, no quantifier. ✓

No `\s+`, `.+`, `.*`, `(?:...)+`, or any other unbounded-repetition pattern
remains anywhere user-controlled text flows in this module. The ReDoS vector is
fully eliminated.

### Logical equivalence to the prior `\s+` chain
Tracing the state machine against what a `.replace(/\s+/g, ' ')` +
drop-space-before-punctuation + trim chain would produce:

- **Collapse whitespace runs to a single space:** whitespace sets `pendingSpace`
  (only after content seen); the next non-punctuation content char emits exactly
  one `" "` then the char. Runs of any length collapse to one space. ✓
- **Drop a space immediately before punctuation:** when `pendingSpace` is true
  and the next char is punctuation, the `if (pendingSpace && !PUNCTUATION...)`
  guard is false, so no space is emitted; the punctuation is appended directly
  (`"word ,"` → `"word,"`). ✓
- **Strip leading whitespace:** before `sawContent`, whitespace sets no
  `pendingSpace` (the `if (sawContent)` guard), so leading whitespace never
  emits anything. ✓
- **Strip trailing whitespace:** trailing whitespace may leave `pendingSpace`
  true, but with no following char it is never flushed, so trailing space is
  dropped. ✓
- **Strip leading punctuation:** the `!sawContent && PUNCTUATION_CHARS.has(ch)`
  branch drops leading punctuation before any content. This is a behavior the
  comment explicitly claims ("strips leading whitespace/punctuation") and frames
  as equivalent to the prior chain. It is a slight *addition* over a pure
  `\s+`-collapse, but it is documented as intended and is conservative
  (dropping leading punctuation from a normalized LLM prompt is harmless and
  desirable). No regression for the whitespace/punctuation-tidying purpose. ✓

No obvious behavioral regression. The function does exactly what the comment
advertises and what the prior regex chain did (plus the documented
leading-punctuation strip).

**Verdict: PASS.** All regex with quantifiers is removed from the hot path; the
replacement is a linear single-pass state machine logically equivalent to the
prior `\s+`-collapse + punctuation-tidy chain.

---

## Overall verdict: **APPROVE WITH NOTES**

Three of four items (graph store, event bus, ReDoS fix) are clean PASS — correct
tenant isolation/RLS, correct async fault isolation, and a complete ReDoS
elimination with no behavioral regression. No injection, broken-auth, XSS, or
IDOR issues found in any of the four items; every new DB-accessing path runs
under `withTenantContext` with RLS enforcing `org_id` isolation.

The single CONCERN (ITEM 3) is not a security breach — the gated reply never
reaches the user and the retained log row is RLS-protected and PII-redacted —
but the pre-gate `recordOrchestraExecution({ status: "completed", output: {
reply: redactPii(reply) } })` call retains the full raw ungated reply in the
`"completed"` row and labels it `"completed"` for a reply that was in fact
gated. This is an observability/audit-hygiene issue worth fixing (move the
`"completed"` log to after the gate passes, or relabel to `"generated"` and
document the intentional retention) before the gate sees real traffic. It does
not block merge.
