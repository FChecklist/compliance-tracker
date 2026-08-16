> **ARCHIVED / STALE — do not treat as current.** See docs/master/INDEX.md or ai-os/MASTER-TRACKER.yaml for current status.

# Priority 6 item 2 — Constitutional foundation drift: veda-advisors + projexa

**Status: research/tracking artifact only — no code in this repo changed for this item.** This document is the deliverable itself, per the Priority 6 scope note: "produce a concrete, actionable delta document... so that a future dispatch (which WILL have access to those [sibling] repos) has a precise, no-research-needed task list rather than a vague 'keep in sync' note."

## Why this exists

Priority 1 dispatched two background agents to port a "constitutional foundation" — a Guardrail Engine skeleton, the task-tightening validator, and a CI guardrail-presence check — from this repo (`compliance-tracker`) into two sibling FChecklist repos, `veda-advisors` and `projexa`. That port shipped as open, unmerged PRs (`veda-advisors#15`, `projexa#1`) and is recorded in `ai-os/boss/COMPLETED.yaml`, entry `WAVE-160`:

> "Cross-repo: dispatched 2 background agents (isolated, one per repo) to port a constitutional foundation to veda-advisors and projexa, adapted honestly to each product's real code (not copy-pasted) — both left as open, unmerged PRs for review (veda-advisors#15, projexa#1)."
> "Code-level rollout to veda-advisors/projexa (Guardrail Engine, task-tightening, anti-bypass CI check equivalents) explicitly **NOT done this wave** — tracked as the clearly-labeled next priority, not silently deferred."

That "next priority" (task #17 in this session's tracker) has stayed open ever since, because this repo's own copies of the three files kept evolving after the port — most recently and substantially under Priority 5. This session (Priority 6) does **not** have write/read access to `veda-advisors` or `projexa` (separate repos, not checked out here), so it cannot verify what those repos actually contain today or perform the re-port itself. What it *can* do, and does here, is pin down exactly what changed in **this repo's** copies since the port baseline, so a future dispatch with access to the sibling repos has a mechanical checklist instead of having to redo this archaeology.

## Port baseline

**Commit `8726de0`** (merge of PR #158, "Audit Organization (CAO + L1 audit gate) + Universal Task Lifecycle Phase 1"), **2026-07-11 12:39:40 +0530** — this is the commit that dispatched the two porting agents (per `WAVE-160`). It made one small, unrelated edit to `scripts/check-guardrail-presence.mjs` itself (widened an existing `route.ts` marker to include `detectLowConfidenceResponse(`) but did not touch `guardrail-registrations.ts` or `task-tightening.ts`.

All three files' state **as of `8726de0`** is the baseline the sibling-repo ports should be compared against. Everything below is drift accumulated in **this repo** strictly after that commit.

## Summary of drift

| File | Commits since port | New exports/markers | Manifest entries added |
|---|---|---|---|
| `src/lib/guardrail-registrations.ts` | 9 | 5 new `*_LEAF` constants + 1 test-isolation export (`_resetRegisteredForTests`) + 2 logic-only enhancements to existing checks | (reflected in the manifest column below) |
| `src/lib/task-tightening.ts` | 5 | 1 new type (`ComplexityTier`) + 5 new functions + 1 wording-only revision (no new export) | — |
| `scripts/check-guardrail-presence.mjs` | 12 | — | 57 new entries (27 → 84 total) |

## `src/lib/guardrail-registrations.ts` — items added since the port

| # | Item | Commit | Date | PR |
|---|---|---|---|---|
| 1 | Bug fix: `tightTaskCheck` now actually reads `complexityTier`/`expectedOutput` (previously silently omitted — every dispatch was failing closed; CAO-001 finding) | `91bf4e0` | 2026-07-11 15:01 | #162 |
| 2 | `AI_TEAM_CLOSURE_REVIEW_LEAF` + `closureReviewCheck` | `a016ca0` | 2026-07-11 19:40 | #165 |
| 3 | `_resetRegisteredForTests()` (test-isolation export) | `6751c8e` | 2026-07-11 20:39 | #171 |
| 4 | `HANDOVER_PROTOCOL_LEAF` + `handoverCheck` | `e0d1489` | 2026-07-11 20:47 | #170 |
| 5 | Confidence-banding branch added to `closureReviewCheck` (`bandConfidence`, `confidence_below_escalation_threshold`) — imports `confidence-banding.ts`/`escalation-ladder.ts` | `52bc3aa` | 2026-07-11 22:51 | #179 |
| 6 | Risk-routing branch added to `closureReviewCheck` (`classifyAuditCadence`, `critical_risk_requires_escalation`) — imports `audit-cadence.ts`/`risk-classification.ts` | `3f8177f` | 2026-07-11 23:42 | #181 |
| 7 | `QA_PRECOMPLETION_GATE_LEAF` + `qaPreCompletionCheck` | `7ae0bdc` | 2026-07-12 01:04 | #189 |
| 8 | `COMMUNICATION_DRAFT_SEND_LEAF` + `communicationDraftSendCheck` | `b67c0e3` | 2026-07-12 11:49 | #195 |
| 9 | `AUDIT_PROTOCOL_COMPLIANCE_LEAF` + `auditProtocolCheck` | `050af9c` | 2026-07-12 12:39 | #197 |

**Re-port task for a future dispatch:** confirm whether `veda-advisors`/`projexa`'s Guardrail Engine skeleton has an equivalent registration pattern (a `*_LEAF` constant + a check function + a call inside `registerAllGuardrails()`); if so, add the 5 new leaves/checks (items 2, 4, 5, 6, 7, 8, 9 above — item 1 is a bug fix to pre-existing logic, item 3 is test-only) **adapted to each product's own real code**, the same way the original port was done — not copy-pasted verbatim, since neither sibling repo has `capability-audit-service.ts`, `handover-protocol.ts`, `confidence-banding.ts`, `escalation-ladder.ts`, `audit-cadence.ts`, or `risk-classification.ts` to call into. Each sibling repo's port should decide, per item, whether an equivalent concept exists locally to wire the check to, or whether the item is compliance-tracker-specific and should be a documented "not applicable" rather than a stub.

## `src/lib/task-tightening.ts` — items added since the port

| # | Item | Commit | Date | PR |
|---|---|---|---|---|
| 1 | `ComplexityTier` type | `91bf4e0` | 2026-07-11 15:01 | #162 |
| 2 | `detectAmbiguousLanguage()` | `a016ca0` | 2026-07-11 19:40 | #165 |
| 3 | `detectFieldContradiction()` | `a016ca0` | 2026-07-11 19:40 | #165 |
| 4 | `validateKnowledgeSufficiency()` | `52bc3aa` | 2026-07-11 22:51 | #179 |
| 5 | `ScopeFileCheck` type + `extractDeclaredScopeFiles()` + `checkFilesWithinDeclaredScope()` | `59ebc9d` | 2026-07-12 00:22 | #184 |
| 6 | Reworded `guidance:` strings for a politer tone (no new export, but the sibling repos' copies would still read the old, less-polite wording if not refreshed) | `0351c4a` | 2026-07-12 00:12 | #183 |

**Re-port task for a future dispatch:** these are pure validation functions with no compliance-tracker-specific dependencies (they operate on strings/text and a `TightTask`/`TaskBrief`-shaped object) — they are the most directly portable items in this whole drift list. Items 2-5 should port close to verbatim, adjusted only for whatever the sibling repo's own task/brief type is named. Item 6 (wording) is a one-line-per-string find-and-replace if the sibling repos kept the original guidance strings verbatim.

## `scripts/check-guardrail-presence.mjs` — manifest drift

Manifest size grew from **27 entries (at the port) to 84 entries (today)** — **57 new entries**, across 12 commits:

`91bf4e0`(#162, +5) → `a016ca0`(#165, +13) → `e0d1489`(#170, +3) → `52bc3aa`(#179, +7) → `3f8177f`(#181, +4) → `59ebc9d`(#184, +6) → `f5b844d`(#186, +2) → `7ae0bdc`(#189, +5) → `b67c0e3`(#195, +3) → `050af9c`(#197, +5) → `a1c341c`(P5/#214, +1) → `343df6c`(P5/#214, +3)

New manifest categories added post-port (in the order they appear in the file today): Ambiguity/contradiction detection (Wave 166) · Self-Assessment/Peer-Review closure gate (Wave 165) · Model-tier eligibility + mandatory audit (Wave 163) · Mandatory Structured Handover (Wave 167) · Knowledge-sufficiency (Guardrail 6) · Risk Classification + Confidence Banding (Guardrails 9/10) · Scope-file conformance (PLAN-16 (b)) · Audit Cadence + Re-Audit Flag (area 9) · L2 cron scan (area 9 follow-up) · QA pre-completion gate (PLAN-16 (f)) · Communication Governance send gate (P2 item 4/GAP-06) · Audit-organization independence (P2 item 3) · Audit-protocol compliance (P2 item 3) · Software Orchestrator Auditor-once-per-version (P5) · MISSING_INFORMATION hard rule (P5) · Proactive floor-tier gating for NOVEL work (P5).

**Re-port task for a future dispatch:** `veda-advisors`/`projexa` each got their own "anti-bypass CI check equivalent" per `WAVE-160` — a future dispatch should read whichever presence-check script each sibling repo actually has (its own manifest shape may already differ from this repo's, per the port's "adapted honestly, not copy-pasted" principle) and add manifest entries only for the items above that have a real local equivalent in that repo's own port of `guardrail-registrations.ts`/`task-tightening.ts`. Do not add entries pointing at files that don't exist in the sibling repo — that would make the sibling's own CI check fail permanently on files it never had.

## Priority 5's claimed contribution — confirmed, with a correction

This session's task history states "Priority 5 alone added ~7 new guardrail markers." Verified directly: Priority 5 (PRs #211–#214, all 2026-07-12) touched **only** `scripts/check-guardrail-presence.mjs` — it never touched `guardrail-registrations.ts` or `task-tightening.ts` at all. Its actual contribution is:

- `a1c341c` ("Priority 5 Parts 1 & 3"): **1** manifest entry — `capability-audit-service.ts` → `["export function shouldAuditCapability"]`.
- `343df6c` ("Priority 5 Part 2"): **3** manifest entries — `package-variable-resolver.ts` → `["export function resolvePackageVariablesOrThrow", "export class MissingInformationError"]`; `task-execution-engine.ts` → `["resolvePackageVariablesOrThrow(", "err instanceof MissingInformationError"]`; `task-execution-engine.ts` → `["\"novel_capability\""]`. This commit's own message states these round the manifest out to 84 entries.

**Corrected figure: 4 manifest entries / 6 individual marker strings, not "~7"** — close enough that "~7" was a reasonable loose estimate, but the precise count (verified against the merged code) is 4 entries. None of Priority 5's additions reference `guardrail-registrations.ts` or `task-tightening.ts` — its guardrail contribution is entirely new manifest coverage for Software-Orchestrator files (`capability-audit-service.ts`, `package-variable-resolver.ts`, `task-execution-engine.ts`) that don't exist in the originally-ported foundation at all. **There is nothing for the sibling repos to re-port from `guardrail-registrations.ts`/`task-tightening.ts` on Priority 5's account** — only a manifest-shape precedent (3 more `{file, mustContain}`-style entries) worth being aware of if `veda-advisors`/`projexa` build out their own equivalent Software Orchestrator concept later (neither repo has one today — `projexa` is a thin API client with no local task-execution engine per `ai-os/system-tree/20-projexa.yaml`, and `veda-advisors` has no Dynamic Chain/task-execution concept at all).

## What a future dispatch needs to do (mechanical checklist)

1. Clone/open `veda-advisors` PR #15 and `projexa` PR #1 (or their current default-branch state if already merged) and diff each against this document's baseline description of what was ported at `8726de0`.
2. For `guardrail-registrations.ts`: add items 2, 4, 5, 6, 7, 8, 9 from the table above, each adapted to whatever real check the sibling repo can actually perform (per-repo judgment call, not copy-paste — consistent with how the original port was done).
3. For `task-tightening.ts`: port items 2-5 near-verbatim (pure functions, minimal repo-specific coupling); apply item 6's wording refresh if the sibling repo kept the original guidance strings.
4. For each repo's own guardrail-presence-equivalent CI script: add manifest entries only for whichever of the above each repo actually implements locally — do not blindly mirror this repo's 57 new entries, most of which point at compliance-tracker-specific files (`capability-audit-service.ts`, `confidence-banding.ts`, etc.) that don't exist in either sibling repo.
5. Do not treat Priority 5's 4 manifest entries as a code-level gap in the sibling repos — they have no corresponding source files to port; the only genuinely portable Priority-5-adjacent lesson is the manifest-entry pattern itself, applicable only once a sibling repo builds an analogous Software Orchestrator feature.
6. Once re-ported, update `ai-os/boss/COMPLETED.yaml` with a new wave entry closing task #17, and update this document (or supersede it) with the new baseline commit so future drift is tracked from the re-port point forward rather than restarting from `8726de0`.

## What this document deliberately does NOT do

It does not modify `veda-advisors` or `projexa` — this session has no access to those repos. It does not modify this repo's `guardrail-registrations.ts`, `task-tightening.ts`, or `scripts/check-guardrail-presence.mjs` — there is no gap in *this* repo to close; the gap is entirely in the sibling repos being behind. It does not guess at what the sibling repos currently contain — every claim above is about this repo's own git history, verifiable independently of the sibling repos' state.
