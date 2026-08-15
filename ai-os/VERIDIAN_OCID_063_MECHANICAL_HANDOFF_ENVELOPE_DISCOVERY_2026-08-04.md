# OCID-063 — Mechanical Handoff Envelope: Discovery and Comparison Against Real Existing Mechanisms

Real parent: OCID-021 (`UMR-20260802-173631-ca85`), itself parented by OCID-020
(`UMR-20260802-165606-4413`). Governed by the Mandatory Governance Directive
(`UMR-20260804-051521-7099`, adopted under OCID-017 `UMR-20260802-165034-5747`), whose
own required sequence this document follows: discover -> verify -> reuse -> enhance ->
standardize -> update UMR -> update UTR -> update canonical artifact -> implement. This
document performs the first four steps only. **No new code, no new middleware, no new
schema, no new table is created by this document.** Implementation is explicitly held for
a fresh PM decision.

## 1. The proposal, restated precisely

A mechanical, non-narrated handoff envelope between agents, consisting of:

1. A **call log** of every real tool invocation during a task's execution, each entry
   carrying a real status code.
2. A **rejected paths list**, derived *mechanically* (not narrated) by filtering the call
   log for entries whose status falls into a client-error, server-error, or timeout
   category.
3. A **one-sentence conclusion**.
4. A **capped unknowns list**.
5. **Strict validation** that rejects the whole envelope if: the call log is empty; or
   rejected paths exist but the unknowns list is empty; or the conclusion exceeds one
   sentence.

## 2. Comparison against 5 real existing mechanisms

### 2a. `task.yaml`'s checkpoint structure

Real fields, confirmed directly in `/opt/veridian/scripts/veridian-task.py`
(`cmd_checkpoint`, lines ~456-606): `completed_steps`, `remaining_steps`,
`files_modified`, `recent_commits`, plus `status`, `note`, `at` on each checkpoint
record. Written every 5 minutes by `worker-entrypoint.sh`'s own background heartbeat
loop (`python3 veridian-task.py checkpoint "$TASK_ID" --auto --note "periodic
checkpoint"`) plus at natural task-lifecycle points.

**Honest verdict: covers part of the proposal's intent, but not its mechanism.**
`completed_steps`/`remaining_steps` are free-text bullet-point strings, written by the
worker's own LLM judgment at each checkpoint — a narrated summary, not a mechanical,
schema'd log of individual tool invocations with real status codes. There is no field
anywhere in this structure that records "tool X was called with status code Y at time
Z." `recent_commits` is the one genuinely mechanical (git-derived, not narrated) field
in this structure, but it only covers commits, not the full space of tool invocations
(file reads, API calls, test runs, etc.) the proposal's call log would need to include.

### 2b. `ACTIVE-CLAIMS.yaml`'s claim registration structure

Real fields, confirmed by direct read across dozens of real entries this session:
`session_label`, `claimed_at`, `claim` (free-text, often 20-50+ lines of prose),
`scope_note`. This is a **pre-work intent/scope declaration** for collision avoidance
between parallel sessions (per its own header, added 2026-07-14 after the Owner
confirmed 4 parallel sessions were running with no visibility into each other's work) —
not an execution-trace or handoff artifact at all. It answers "what is this session
about to do and why," not "what did this session's tools actually do, with what
outcomes." Zero overlap with the proposal's call-log/status-code ask.

### 2c. `resource_governor.py`'s `reuse_check_result`

Real, precisely-defined structure, confirmed via `check_reuse_before_dispatch()`'s own
docstring in `/opt/veridian/scripts/plan_generator.py` (lines ~198-280):

```
{
  "checked_at": iso8601 str or None,
  "intent_text": str, "task_identity": str or None,
  "capability": {...}, "wiring": {...}, "knowledge": {...},
  "system_index_search": {...},
  "reuse_candidates": [str, ...],
  "confidence": float,
  "recommendation": "proceed" | "needs_review" | "reuse_instead",
  "error": str or None,
}
```

Recorded on the UMR row itself at `metadata_json.reuse_check_result`
(`resource_governor.py` lines ~527-611, `metadata = {"reuse_check_result":
reuse_check_result}`).

**Honest verdict: this is the closest real precedent for "mechanical, structured,
non-narrated" on this platform**, and it directly demonstrates the platform already has
both the appetite and the storage pattern (a free-form `metadata_json` column on a UMR
row) for exactly this class of result. But its scope is narrow and different: it is
**one deterministic check result answering one question** ("does existing
capability/wiring/knowledge already cover this intent, before a task is even created"),
not a running log of arbitrary tool invocations across a task's entire execution. It has
no notion of multiple log entries, no per-entry status code, and no "rejected paths"
concept.

### 2d. `credit-accountant.py`'s deterministic JSON verdict

Real, confirmed structure (`/opt/veridian/scripts/credit-accountant.py`, lines
259-363): `{"approved": bool, "increment_number": int, "reason": str, "reviewer": str}`
(`reviewer` is either `"deterministic"` or `"claude_cli"`), printed as a single line of
JSON to stdout and consumed by `worker-entrypoint.sh`'s quality-gate loop. Seen live,
repeatedly, this session (e.g. the real rejections on task-20260803-214944 and
task-20260804-032121-group-c-closure, both citing `"reason": "existing
software/mechanism already covers this (system_index match)"`).

**Honest verdict: real, deterministic, JSON, and genuinely non-narrated — but, like
2c, it is a single verdict about a single spend-approval decision at one point in a
task's lifecycle**, not a log of tool invocations across the task's full execution. No
call log, no status-code taxonomy, no rejected-paths concept.

### 2e. The `AUDIT: PASS`/`FAIL` comment convention

Real, structured, schema-validated: `AuditProtocolFields` in
`src/lib/audit-protocol.ts` (`objectiveUnderstood`, `standardsReviewed`,
`scopeConfirmed`, `evidenceRecorded`, `severityClassified`, `verdict`,
`correctiveActionOwner`, `reAuditScheduled`), enforced at its one real wired call site
(`.github/workflows/mandatory-audit-check.yml` via `scripts/validate-audit-verdict.ts`
calling `validateAuditProtocolFields()` directly — confirmed this session: this exact
check genuinely rejected a self-audit-shaped submission and, separately, genuinely
passed a correctly-shaped one, multiple times).

**Honest verdict: the real, closest precedent for the proposal's "strict validation
that rejects a malformed submission" requirement.** This is a deterministic,
non-LLM-parsed structural validator that already rejects a submission outright if its
required fields are missing or malformed — the same posture the proposal wants for its
own call-log/rejected-paths/unknowns/conclusion rules. But its 8 fields are still
free-text narrative per field (a reviewer's prose describing what they checked), not a
mechanical log of individual tool invocations with status codes. It validates the
*shape* of a submission, not the *mechanical accuracy* of a call log against what
actually happened.

## 3. Confirmed real gap

**No existing mechanism on this platform is a structured, mechanical, per-tool-invocation
call log with real status codes, captured during a single task's execution.** The
closest structural home — `task.yaml`'s checkpoint record, already written by every
worker at every checkpoint — currently carries only free-text narrated summaries
(`completed_steps`/`remaining_steps`), not a schema'd array of individual tool-call
records.

## 4. Design proposal (discovery only — not authorized for implementation)

Per the Mandatory Governance Directive's explicit rule to never build a new
execution/governance model when an existing one can be enhanced, and per this
document's own findings above, the real gap should be closed by **extending**, not
replacing:

- **Primary proposal**: add a new, optional field to the existing `task.yaml` checkpoint
  record already written by `veridian-task.py checkpoint` (the same call site
  `worker-entrypoint.sh`'s heartbeat loop already invokes every 5 minutes, plus at
  natural checkpoints) — e.g. `tool_call_log: [{tool, status, ts}, ...]` — populated
  incrementally by the same mechanism that already populates `recent_commits` (a real,
  mechanical, git-derived field, proving this checkpoint mechanism already has real,
  non-narrated data sources available to it, not only LLM-narrated ones).
- **Secondary/complementary proposal**: for a cross-session, permanent record at the
  UMR level (rather than the per-task-workspace `task.yaml`), reuse the already-proven
  `metadata_json` free-form column pattern (§2c's `reuse_check_result` precedent) with a
  sibling key, e.g. `metadata_json.tool_call_log` or `metadata_json.handoff_envelope`,
  on the same `umr_tasks` row.
- **New logic genuinely needed** (not covered by any existing mechanism, so this part
  would be new, small, validation-only code once authorized): the mechanical
  rejected-paths filter (client-error/server-error/timeout status-category match over
  the call log), the capped-unknowns-list enforcement, the one-sentence-conclusion
  length check, and the "rejected paths non-empty implies unknowns non-empty" cross-field
  rule — all of which are pure, deterministic validation functions in the same spirit as
  `validateAuditProtocolFields()` (§2e), not a new execution or governance model.

This is a design proposal only. No implementation, no schema migration, no new script,
and no new middleware has been authorized or performed under this OCID.
