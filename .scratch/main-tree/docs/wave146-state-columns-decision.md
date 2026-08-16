# Wave 146 — Decision: `conversations` State Columns Remain Unwritten (Outcome B)

**Date:** 2026-07-09
**Owner:** z.ai (Senior Backend Engineer, VERIDIAN AI Workforce)
**Phase 2 item:** Investigate the real conversation/task lifecycle and decide whether to add a real writer to the Wave 144 `conversations` state columns (`currentState`, `previousState`, `workflowId`, `status`) — or to document why no real writer exists yet.

**Outcome chosen: B — do not force a fake implementation; document the reasoning instead.**

---

## TL;DR

After investigating the actual conversation and task lifecycle in this codebase, there is **no genuinely meaningful, low-risk, minimal place to write real signal into `currentState` / `previousState` / `workflowId`** without inventing a fake state machine or arbitrary state names that the code does not actually act on today. The only honest, non-fabricated option is to leave the columns unwritten and document why, so the "inert scaffolding" flagged by the Wave 144 auditor has an explicit, traceable reason to wait rather than sitting silently unused.

A real writer requires the **Conversation State Machine (Phase 3)** to supply a state taxonomy, transition rules, and a real task↔conversation linkage first. Forcing a writer now would be hollow.

---

## What Wave 144 added

Migration `drizzle/0127_wave144_conversation_state_columns.sql` added four columns to the `conversations` table:

| Column          | Nullability | Default  | Written by app code today? |
| --------------- | ----------- | -------- | -------------------------- |
| `status`        | NOT NULL    | `'active'` | No (relies on DB default) |
| `current_state` | nullable    | NULL     | No                         |
| `previous_state`| nullable    | NULL     | No                         |
| `workflow_id`   | nullable    | NULL     | No                         |

The migration's own commentary states (paraphrased from the SQL): *no state taxonomy exists yet — `current_state`/`previous_state` are free text on purpose, and nothing writes to them yet.* This file exists to make that "yet" an explicit, reviewed decision rather than an unexplained gap.

---

## Investigation performed

### 1. Conversation lifecycle — `src/lib/services/chat-service.ts`

- **`ensureAiThread(ctx)`** — finds or creates the AI-thread conversation (`type: 'ai'`, `isAiThread: true`). On creation it **immediately seeds a welcome message**. The conversation is therefore born *active and usable*; there is no observable "created but not yet active" window. It sets `title`/`type`/`createdAt` only — it does **not** touch `current_state`, `previous_state`, `workflow_id`, or `status` (the latter relies on the DB default of `'active'`).
- **`createConversation(ctx, input)`** — creates a direct/group conversation. Sets `type`/`title`/`createdAt` only. No state columns.
- **`sendMessage(ctx, conversationId, input)`** — inserts the user message and, for AI threads, triggers `generateAiReply`. The only `conversations` mutation is bumping `updatedAt`. No state transition.
- **`generateAiReply` / `regenerateAiReply`** — produce/regenerate the assistant reply. No `conversations` state mutation beyond `updatedAt`.

**Conclusion for `status` / `current_state` / `previous_state`:** There is no real lifecycle transition to hook into. A conversation is born `active` (welcome message seeded at creation), stays `active`, and is **never closed, archived, paused, or transitioned** by any code path. Writing `current_state = 'active'` on creation would be redundant with the `status` default. Inventing a `created → active` transition would be fabrication — the code does not distinguish a "created" state from "active" (it is active from the first instant). Inventing `awaiting_user` / `awaiting_ai` / `replied` states would likewise be hollow: nothing in the codebase reads or branches on such values, so writing them would be signal with no consumer — exactly the "token/fake write just to say something was written" the task explicitly forbids.

### 2. Task dispatch — `src/components/veri-chat/VeriComposer.tsx` (`dispatchInstruction`)

- `dispatchInstruction` POSTs to `/api/tasks` with a payload of `{ title, description, projectId, workerAgentId, agentInputs, engineKey, engineInputs }`.
- It does **not** pass a `conversationId` / `aiThreadId` in that payload.
- The handler creates a record in the **`tasks` table** (a separate entity), not a conversation state change.

**Conclusion for `workflow_id`:** The connection between a dispatched task and the originating conversation is **not real or direct in existing code**. There is no code path that takes a created task's id and writes it onto `conversations.workflow_id`. To set `workflow_id` today I would have to *invent* that linkage (thread the conversation id through the dispatch payload, extend `createTask`, and write back to `conversations`) — that is new behavior, not "hooking into an actual, real lifecycle transition happening in existing code." The task brief itself flagged this possibility as one to judge; the judgment is that the linkage does not exist yet.

### 3. Task lifecycle — `src/lib/services/task-service.ts`

- Tasks live in the `tasks` table and carry their own `status` (`pending` / `in_progress` / `completed` / `failed` / `cancelled`).
- This is a **fully separate** status axis from `conversations.status`. There is no join, foreign key, or application code connecting a task's id to a conversation's `workflow_id`.

### 4. API surface

- `src/app/api/conversations/route.ts`, `…/[id]/messages/route.ts`, `…/[id]/regenerate/route.ts` all delegate to `chat-service.ts` and perform no `conversations` state mutation beyond what is described above. No close/archive endpoint exists.

---

## Why Outcome A would have been the wrong call here

The task's bar for Outcome A is strict and correct: a writer must point to an **actual, real lifecycle transition happening in existing code**, and must not be a token/fake write. Measured against that bar:

- **`status`**: redundant with the DB default; no transition exists to drive a change.
- **`current_state` / `previous_state`**: require a state taxonomy that does not exist. Every candidate value (`active`, `created`, `awaiting_user`, `awaiting_ai`, `closed`) is either redundant or invented — none is grounded in a transition the code actually performs and acts on.
- **`workflow_id`**: requires a task↔conversation linkage that does not exist in the code; writing it would mean inventing the linkage, not observing it.

Forcing writes in any of these cases would violate the repo-wide standard this study has held throughout: *verify before claiming done; do not fabricate.* A column that is written with no real semantics and no consumer is worse than an explicitly-documented unused column, because it creates the illusion of a working state machine where none exists.

---

## What Phase 3 (Conversation State Machine) needs to supply first

Before a real writer is added, Phase 3 should deliver:

1. **A state taxonomy** — a closed, named set of conversation states (e.g. `active`, `awaiting_user`, `awaiting_ai`, `paused`, `closed`, `archived`) with explicit definitions, not free text.
2. **Transition rules** — which states may transition to which, and the guard conditions (e.g. "only `active` → `awaiting_ai` on user message send; `awaiting_ai` → `awaiting_user` on reply completion").
3. **Real consumers of the state** — at least one code path that *reads* `current_state`/`status` and branches on it (e.g. suppress notifications when `paused`, hide from list when `archived`). Without a consumer, writes are signal into the void.
4. **A real task↔conversation linkage** — if `workflow_id` is to mean "the dispatched task this conversation is tracking," Phase 3 must first establish that relationship in the data model and the dispatch path (thread conversation id through `dispatchInstruction` → `createTask`, and write the task id back onto `conversations.workflow_id`), with a defined lifecycle for what happens to the conversation when the task completes.
5. **`previous_state` semantics** — a defined audit/transition-log contract (is it the immediately-prior state? a JSON history? an append-only log table?). Free-text `previous_state` without a contract is a footgun.

Until those exist, the columns should remain nullable-and-unwritten, with `status` continuing to rely on its `'active'` DB default. This file is the documented reason to wait.

---

## Recommendation for Phase 3 sequencing

When Phase 3 begins, the first concrete step should be to define the taxonomy + at least one real consumer *before* writing any state, so that the writer is provably non-hollow from the moment it lands. The Wave 144 columns are already in place to receive that writer; no schema change is required to start — only the taxonomy, rules, consumers, and linkage described above.
