> **ARCHIVED / STALE — do not treat as current.** See docs/master/INDEX.md or ai-os/MASTER-TRACKER.yaml for current status.

# AUDIT — Wave 146 (Claude items)

Scope: high-impact action confirmation gate, PII redaction, CLEE capture→apply gap.
Files reviewed (exactly once each): `high-impact-action-detector.ts`, `api/tasks/route.ts`,
`task-service.ts`, `VeriComposer.tsx`, `pii-redaction.ts`, `chat-service.ts`, `fde-service.ts`,
`loop-improvement-proposer.ts`, `loops/api-token-audit.ts`.

---

## ITEM 1 — High-impact action confirmation gate (files 1-4)

### Does `createTask()` return `needsConfirmation` without inserting anything?

**Yes.** `task-service.ts`:

```ts
if (!input.confirmed) {
  const detection = detectHighImpactAction(`${title} ${description ?? ""}`)
  if (detection.isHighImpact) {
    return {
      needsConfirmation: true as const,
      category: detection.category,
      categoryLabel: ...,
      matchedPhrase: detection.matchedPhrase,
    }
  }
}
```

This `return` sits **before** the `withTenantContext(...)` block that performs
`db.insert(tasks).values(...)` and before the `await executeTask(...)` call. No task row is
inserted and no execution is triggered on the first (unconfirmed) request. The gate is also
deterministic (keyword regex, no LLM), so it cannot be prompt-injected around — consistent with
the codebase's stated posture. ✓

### Does the POST route return 200 (not 201) in that case?

**Yes.** `api/tasks/route.ts`:

```ts
if ("needsConfirmation" in result && result.needsConfirmation) {
  return NextResponse.json(result, { status: 200 })
}
return NextResponse.json(result, { status: 201 })
```

The confirmation response is explicitly 200; the real creation is 201. ✓

### Does VeriComposer correctly resume/skip on confirm/cancel?

**Yes.** `VeriComposer.tsx`, inside `dispatchInstruction`:

```ts
if (json?.needsConfirmation) {
  const confirmed = await requestHighImpactConfirmation(...)
  if (!confirmed) { toast(`Skipped — ${crumb}`); continue; }
  res = await fetch("/api/tasks", { ..., body: JSON.stringify({ ...body, confirmed: true }) })
}
if (!res.ok) throw new Error();
```

- **Confirm** → `AlertDialogAction` onClick calls `resolve(true)` → `confirmed === true` →
  resubmits the **same** `body` verbatim plus `confirmed: true`. The reassigned `res` is then
  re-checked by `if (!res.ok)`. ✓
- **Cancel** → `AlertDialogCancel` onClick calls `resolve(false)` → `continue` skips this one
  concrete path without affecting others in the multi-path loop. ✓
- **Escape/backdrop dismiss** → `onOpenChange` with `!open` also calls `resolve(false)` then
  clears state — same skip behavior, no dangling promise. ✓

The `pendingConfirmation` state holds the exact resolve callback, so there is no re-derivation of
the body on confirm (it reuses the in-scope `body` closure). No way for the second request to
re-trigger the gate, since `confirmed: true` bypasses the `!input.confirmed` branch. ✓

**Minor (non-blocking) note:** the gate inspects only `title + description`. Structured dispatch
inputs (`agentInputs`/`engineInputs`) are not scanned. This is acceptable for a deterministic
keyword stand-in (structured leaves resolve to pre-approved global agents re-verified server-side),
and the file's own header comment acknowledges it is a Phase-2 stand-in for a deferred Intent
Engine. Not a security defect.

### Verdict: **PASS**

---

## ITEM 2 — PII redaction (files 5-7)

### Is CARD ordered before AADHAAR so a 16-digit card isn't partially eaten?

**Yes.** `pii-redaction.ts` `PATTERNS` array order: GSTIN → PAN → IFSC → **CARD** → **AADHAAR**
→ EMAIL → PHONE. CARD is tried before AADHAAR.

CARD regex: `/\b\d(?:[\s-]?\d){12,18}\b/g` → matches **13-19** digits (1 + 12..18), optionally
space/dash grouped. For a 16-digit grouped card like `4111 1111 1111 1111`, CARD consumes the full
run (15 reps, within {12,18}) before AADHAAR ever runs, so AADHAAR's 12-digit `4-4-4` pattern
cannot grab the first 12 digits. ✓

A genuine 12-digit AADHAAR (`1234 5678 9012`) has only 12 digits — below CARD's 13-digit minimum —
so CARD does **not** steal it, and AADHAAR matches correctly. ✓ The longer/more-specific pattern is
correctly tried first; the file's own comment documents the exact bug this ordering prevents.

### Is `redactPii()` applied only to the `orchestra_executions` logging, not stored text?

**Yes for the success paths; one inconsistency on the failure path (see below).**

`chat-service.ts` `generateAiReply`:
- Logging: `recordOrchestraExecution({ input: { systemPrompt: redactPii(systemPrompt),
  userMessage: redactPii(normalizedMessage), ... }, output: { reply: redactPii(reply), ... } })` —
  redacted. ✓
- Stored AI message: `db.insert(messages).values({ ..., content: reply })` — uses **unredacted**
  `reply`. ✓
- Stored user message (`sendMessage`): `db.insert(messages).values({ ..., content })` — raw
  trimmed input, unredacted. ✓
- `enforcePolicy` and the background `submitFdeRequest({ requestText: content })` both see raw
  text. ✓
- Failure path logs only `{ conversationId }` — no PII-bearing field, so no leak. ✓

`fde-service.ts` `submitFdeRequest`:
- Logging (success): `recordOrchestraExecution({ input: { requestText: redactPii(requestText), ...,
  systemPrompt: redactPii(systemPrompt), userMessage: redactPii(userMessage) }, output: { ...,
  responseToUser: redactPii(evaluation.responseToUser) } })` — redacted. ✓
- Stored `fdeRequests` row (`recordFdeRequest`): `db.insert(fdeRequests).values({ ..., requestText,
  responseText })` — both **raw/unredacted** (the `requestText` and `responseText` arguments are
  the unredacted originals). ✓

### CONCERN — failure-path redaction gap in `fde-service.ts`

```ts
} catch (err) {
  console.error("VERI FDE evaluation failed:", err)
  recordOrchestraExecution({
    ...,
    input: { requestText },          // <-- UNREDACTED
    status: "failed", ...
  })
```

On the **success** path, `requestText` is wrapped in `redactPii(...)` before being logged to
`orchestra_executions`. On the **failure** path (LLM call throws), the raw `requestText` is logged
to `orchestra_executions` **without** `redactPii()`. If a user's FDE request contained a card
number / PAN / Aadhaar and the LLM evaluation failed, that PII would be persisted unredacted to
the audit-log table — the exact leak the Wave 146 redaction pass exists to prevent. The matching
failure path in `chat-service.ts` does **not** have this issue (it logs only `conversationId`).

**Exploit/impact:** no auth bypass; this is a data-protection gap. A failed FDE LLM call persists
the requester's raw text (which may contain PII) into `orchestra_executions`, defeating the
redact-at-write guarantee for that row. Fix is one-line: `input: { requestText: redactPii(requestText) }`.

### Verdict: **CONCERN**

---

## ITEM 3 — CLEE capture→apply gap (files 8-9)

### Is `isDeployed` hardcoded false with no path to set it true?

**Yes.** `loop-improvement-proposer.ts`:

```ts
await db.insert(loopImprovements).values({
  loopId: input.loopId,
  improvementType: input.improvementType,
  targetType: input.targetType,
  targetId: input.targetId ?? null,
  beforeState: input.beforeState ?? null,
  afterState: input.afterState ?? null,
  improvementDelta: input.improvementDelta != null ? String(input.improvementDelta) : null,
  isDeployed: false,          // <-- hardcoded literal
})
```

`isDeployed` is the literal `false`, not derived from `input`. The `LoopImprovementProposal` type
exposes no `isDeployed` field, so no caller can influence it. There is no update/apply function in
this file — only an insert. Human-gated by construction; no autonomous deployment path exists. ✓

### Do `beforeState`/`afterState` in `api-token-audit.ts` match real query data?

**Yes — not fabricated.** `loops/api-token-audit.ts`:

The `staleKeys` query selects `{ id, orgId, name, scopes, lastUsedAt, createdAt }` filtered on
`eq(apiKeys.isActive, true)`. The proposal per key:

```ts
beforeState: { isActive: true, orgId: key.orgId, name: key.name, scopes: key.scopes, lastUsedAt: key.lastUsedAt },
afterState: { isActive: false },
```

- `isActive: true` is truthful — the query filtered to active keys only. ✓
- `orgId`, `name`, `scopes`, `lastUsedAt` are all real columns from the result row. ✓
- `afterState: { isActive: false }` is the intended post-revocation state (the improvement type is
  `revoke_stale_api_key`), a legitimate proposed end-state, not fabricated telemetry. ✓

The `staleMcp` query selects `{ id, orgId, name, lastUsedAt, createdAt }` filtered on
`eq(mcpAccessCodes.isActive, true)`. The proposal per code:

```ts
beforeState: { isActive: true, orgId: code.orgId, name: code.name, lastUsedAt: code.lastUsedAt },
afterState: { isActive: false },
```

Same — all fields are real query columns; `isActive: true` is truthful given the filter. ✓

No invented counts, no synthetic IDs, no hardcoded "before" values that don't correspond to the
actual row. The proposals are 1:1 with the rows the audit actually found. ✓

### Verdict: **PASS**

---

## Overall verdict: **APPROVE WITH NOTES**

Items 1 and 3 are clean PASS. Item 2 is a CONCERN, not a FAIL: the success-path redaction is
correctly scoped to `orchestra_executions` logging only (stored messages and `fde_requests` rows
keep raw text as intended), and the CARD-before-AADHAAR ordering is correct. The single actionable
note is the failure-path inconsistency in `fde-service.ts` where an unredacted `requestText` is
logged to `orchestra_executions` when the FDE LLM call throws — a one-line `redactPii()` wrap on
that `input.requestText` closes it. No auth/RBAC/IDOR/injection issues found in any of the
reviewed routes or services.
