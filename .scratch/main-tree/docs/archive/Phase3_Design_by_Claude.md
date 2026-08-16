> **ARCHIVED / STALE — do not treat as current.** See docs/master/INDEX.md or ai-os/MASTER-TRACKER.yaml for current status.

# Phase 3 Design — Foundational Substrate Decisions

**Author:** Claude Code Sonnet Desktop | **Date:** 2026-07-09
**Scope:** `Joint_Implementation_Plan.md`'s Phase 3 — the 3 items both `Study_by_Claude.md` and `Study_by_zaizlm5.2.md` flagged as structural prerequisites, explicitly deferred out of Phase 1/2 as "multi-week scope, requires dedicated design work." Boss directive 2026-07-09: "you can parallelly start also on phase 3 yourself to complete it" (while z.ai finishes its Phase 2 cross-audit retry).

**Framing carried over from the whole session so far:** every previous wave in this plan has favored a real, narrow, honestly-scoped slice over a fabricated full solution (see z.ai's Wave 146 "Outcome B" decision on conversation state columns — documented as `docs/wave146-state-columns-decision.md`, and my own CLEE work choosing `afterState: null` rather than guessing). Phase 3 follows the same discipline: each of the 3 items below ships a real, working, tested foundation now, with an explicit, honest statement of what is deliberately **not** attempted in this pass and why.

---

## 1. Graph store decision

**Decision: add `entity_relationships`, a generic typed-edge table, additive migration, no RLS/data-model changes to anything else.**

### What exists today (confirmed via code survey)
No generic entity-relationship graph table exists anywhere in `schema.ts`. The closest pattern is `embeddings` (`schema.ts:523`) — an entity-agnostic table keyed by `(entityType, entityId)` used for similarity search via pgvector, wrapped by `capability-registry-service.ts`. It links entities only by vector similarity score, never by a typed, directional, named edge (`"worker_agent X supervises worker_agent Y"`, `"task X blocks task Y"`, `"conversation X derived_from capability Y"`). Every "Enterprise * Graph" proposal in both studies (Enterprise Cognitive Graph, Capability Graph, Compliance Dependency Graph, etc.) needs exactly this kind of typed edge and none of them has it — they'd otherwise each invent their own linking table, which is the duplication both studies flagged as the top platform-wide risk.

### Schema (follows `webhooks`/`embeddings` conventions exactly — see `schema.ts:473`, `:523`)

```typescript
export const entityRelationships = complianceSchemaDB.table('entity_relationships', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  relationshipType: text('relationship_type').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
```

`sourceType`/`targetType`/`relationshipType` are free text, not enums — same choice `embeddings.entityType` made, for the same reason: the set of entity kinds that might need linking (worker agents, tasks, conversations, compliance items, capabilities, documents, projects...) already spans dozens of tables and will keep growing; an enum would need a migration every time a new module wants to participate in the graph, defeating the point of a generic substrate.

Composite indexes on `(org_id, source_type, source_id)` and `(org_id, target_type, target_id)` for both-direction traversal; a unique index on `(org_id, source_type, source_id, target_type, target_id, relationship_type)` to prevent duplicate edges. RLS: same `app_runtime_tenant_isolation` / `service_role_bypass` pattern as every other tenant-scoped table (see `interior_mood_boards` in `drizzle/0125_wave142_interior_moodboards_ffe.sql:60-66` for the exact policy shape being copied).

### Service layer
`src/lib/services/entity-graph-service.ts`: `createRelationship`, `deleteRelationship`, `getOutgoing(orgId, sourceType, sourceId)`, `getIncoming(orgId, targetType, targetId)`, `getNeighbors(orgId, entityType, entityId)` (both directions merged). All tenant-scoped via `withTenantContext`, matching every other service in `src/lib/services/`.

### Explicitly NOT done in this pass
No existing table is migrated to use this (e.g. `workerAgents.supervisorWorkerAgentId`, flagged in Phase 1 item 8, stays as its own column — converting it to a graph edge is a follow-up, not bundled here to keep this migration purely additive and risk-free). No module is required to adopt this yet. The table ships with a working, tested service and zero consumers wired in, by design — matching the same reasoning z.ai gave for not forcing a writer onto the Wave 144 conversation state columns: a consumer should be added when a real feature needs it, not invented to make the migration look "used."

---

## 2. Event bus decision

**Decision: an in-process, typed, per-request pub/sub module — explicitly *not* a durable cross-invocation queue.**

### What exists today (confirmed via code survey)
No `EventEmitter`, generic `publish`/`subscribe`, or queue/job/outbox table exists anywhere in `src/` or `schema.ts`. What looks superficially similar — `webhooks`/`webhookDeliveries` (`schema.ts:473`) and `src/lib/webhook-deliver.ts` — is outbound HTTP fan-out to *external* URLs, not an internal decoupling mechanism; it's synchronous, in-request, with manual retry, no queue table backing it. Cross-module "X happened, do Y" today is hand-wired: direct function calls, sometimes inside `after()` fire-and-forget blocks (e.g. `chat-service.ts`'s `recordOrchestraExecution`/`recordWorkerAgentLearning` calls).

### Why not a durable queue
This app runs on Vercel serverless functions — no shared memory across invocations, no long-running process to host a durable in-memory queue. A real durable event bus needs a backing table (outbox pattern) and a worker/poller, which is exactly the kind of multi-week, dedicated-design-work item both studies agreed to defer. Building a fake "durable" bus on top of an in-memory `Map` would be worse than not building one — it would silently drop events on every cold start, a much worse failure mode than the current hand-wired call sites (which at least run synchronously and predictably).

### What ships instead
`src/lib/event-bus.ts` — a small, typed, **synchronous-within-one-request** pub/sub:

```typescript
type VeridianEventMap = {
  "task.created": { orgId: string; taskId: string; needsConfirmation: boolean }
  "loop.improvement_proposed": { loopId: string; improvementType: string; targetId: string | null }
  // extend as real consumers are added
}
export function subscribe<K extends keyof VeridianEventMap>(event: K, handler: (payload: VeridianEventMap[K]) => void | Promise<void>): () => void
export async function publish<K extends keyof VeridianEventMap>(event: K, payload: VeridianEventMap[K]): Promise<void>
```

`publish` awaits all handlers but isolates failures per-handler (one throwing subscriber logs and continues, never breaks the publisher) — the same fault-isolation principle `webhook-deliver.ts` already uses for external fan-out, applied internally. This genuinely decouples "something happened" from "who reacts to it" *within a single request's lifecycle* (e.g. a route handler that fires 3 independent side effects today can register 3 independent subscribers instead of hand-threading all 3 through the trigger code), without pretending to solve cross-invocation durability.

### Explicitly NOT done in this pass
Not wired into any production call site yet. Forcing a call site in to "prove it's used" would repeat the exact mistake this design doc is arguing against — a contrived integration that exists to look complete rather than because a real feature needs it. Shipped with unit tests proving publish/subscribe/unsubscribe/error-isolation actually work, so it's real, tested infrastructure ready for the first genuine consumer (likely candidate: task-service.ts's multi-effect paths, once Phase 2's confirmation-gate UX settles).

---

## 3. Structured-response contract + software-first gate (chat path)

**Decision: ship the contract type + one real, narrow, deterministic gate; explicitly do NOT attempt the full renderer/parser rollout in this pass.**

### What exists today (confirmed via code survey)
`chat-service.ts`'s `generateAiReply()` (line 304): `callLLM()`'s raw text `reply` is used completely verbatim — no parsing, no validation, no schema — straight into `redactPii(reply)` for logging and `db.insert(messages).values({ content: reply })` for storage. It is rendered to the user exactly as returned. This is the single largest drift both studies independently flagged: the document's "golden rule" is that the LLM should never talk to the user directly without a software layer between it and the UI. Zod is already used elsewhere in this codebase for schema validation (`src/lib/schemas/compliance.ts` etc.) but only as the OpenAPI-facing external contract, never applied to LLM output.

### Why the full fix is out of scope for this pass
The complete vision — LLM emits structured JSON, a renderer turns it into typed UI (cards, confirmations, tables) instead of a raw text bubble — is a genuinely large, cross-cutting rewrite of the entire chat experience: new system prompt, new parsing layer, new React rendering components per structured-content type, and a migration story for every existing conversation's stored plain-text messages. That is real "multi-week, dedicated design and rollout plan" work, not something to blitz inside this pass — attempting it now risks breaking the one AI-facing feature that's currently live and working.

### What ships instead: a narrow, high-precision safety gate
Investigating what tool-calling capability the LLM actually has in this path (`callLLM` in `generateAiReply`) confirms it has **none** — the model's reply is stored as a chat message and nothing else; it never triggers task creation, payments, approvals, or any other side effect directly. That means the specific, provable risk in the *current* system isn't unauthorized action (nothing the LLM says can execute anything) — it's **hallucinated claims of completed action**: the model asserting in prose "I've approved this" or "Payment has been submitted" when no such thing happened anywhere in the system, because it has no tool to have actually done it. This is a real, narrow, high-confidence pattern to catch deterministically, unlike trying to reuse Phase 2's `detectHighImpactAction` (that detector is tuned for *user intent* language like "delete this" — reusing it on the assistant's own reply text would false-positive constantly on completely legitimate informational sentences like "Your payment of ₹5,000 was recorded on the 3rd").

`src/lib/ai-reply-gate.ts`:
- `AiReplyEnvelope` (Zod schema): `{ message: string, confidence: "high" | "medium" | "low" | null }` — the contract decision itself, ready for a future structured-content field to be added without a breaking change.
- `detectFalseActionClaim(replyText)`: a narrow, first-person, past-tense, high-impact-verb phrase list ("I have deleted", "I've deleted", "I have approved", "I've approved", "I have paid", "I've made the payment", "I have submitted", "I've filed", "I have granted access", "I've revoked access", "I have archived") — deliberately much narrower than Phase 2's user-intent detector, tuned for precision over recall since a false positive here blocks a legitimate reply.
- `passesReplyGate(replyText)`: empty-reply check, a length cap (8000 chars), and the false-action-claim check. Returns `{ passed: true }` or `{ passed: false, reason, matchedPhrase? }`.

Wired into `generateAiReply`: after `callLLM` returns, the reply goes through `passesReplyGate()` before the `db.insert(messages)` write. On failure, a safe fallback message is stored instead (matching the existing pattern already used for policy refusals and missing-model-config in the same function), and `recordOrchestraExecution` logs `status: "gated"` with the reason — so this is auditable, not silent.

### Explicitly NOT done in this pass
No structured JSON output from the LLM, no renderer, no UI change, no new message content types. This is a deterministic safety net on top of the existing plain-text chat path, not the full structured-response system the document ultimately calls for — that remains Phase 3's largest genuinely-deferred item, to be scoped as its own dedicated design/rollout plan per the original Joint Implementation Plan's own framing.

---

## Cross-audit note

Per Operating Rule 7, whichever agent didn't implement a task audits it. z.ai is still finishing its Phase 2 cross-audit retry as this doc is written; Phase 3's audit by z.ai is queued as a follow-up once it's free, same pattern as every prior wave in this plan. Not blocking implementation — mirrors how Phase 2's implementation started before every cross-audit had landed.
