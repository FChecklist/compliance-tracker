# The 4th Tree -- Unified Requirements + Audited System

**Built 2026-07-11.** The merge of Tree 1 (`ai-os/audit-tree/10-merged-tree.yaml` -- what the 9 requirement documents say VERIDIAN should be) and Tree 3 (`ai-os/system-tree/50-merged-tree.yaml` -- the audited tree of what's actually built in the live codebase), per the Owner's explicit 2-step instruction: compare, then merge into one extremely granular tree with input/output/guardrails/narrow-tightened-workflow/instructions for everything.

## Files

- `01-COMPARISON.md` -- **Step 1's deliverable.** A domain-by-domain comparison of Tree 1's 28 domains against Tree 3's 94, with an honest status for each and a mechanical tally (1 fully implemented, 4 largely/mostly implemented, 16 partial, 6 confirmed-or-likely gap, 1 superseded by a better design). Also identifies the headline finding: most of Tree 3's content (ERP, PMS, The Firm, Construction/PROJEXA, HR, CRM, GST, the GRC suite, Facilities, veda-advisors) has NO Tree 1 counterpart at all, because the 9 documents describe the AI-governance layer specifically, not VERIDIAN's full business-platform surface.
- `10-merged-governance-layer.yaml` -- **Step 2's core synthesis, v3.** v1/v2 reconciled only at Tree 1's 28 DOMAIN level, which did not meet the Owner's explicit "extremely granular, don't leave anything" instruction -- confirmed by a mechanical keyword-coverage check that found only ~64% of Tree 1's 149 actual sub-branches were even loosely represented. v3 reconciles all 149 sub-branches individually against Tree 3's evidence, 1:1, mechanically verified (149 Tree 1 sub-branch ids in, 149 Tree 4 nodes out, zero missing, zero extra).
- `20-business-platform-modules.yaml` -- the 46 Tree 3 domains with no Tree 1 requirement (ERP/PMS/Firm/Construction/HR/CRM/GST/GRC/Facilities), carried forward in full, tagged as not requirement-sourced.
- `30-gap-backlog.yaml` -- **the actionable to-do list.** 11 implementation-ready backlog items expanded from Section 10's confirmed/likely gaps, each with priority (P0/P1/P2), effort size (XS/S/M/L), and a full input/output/guardrail/workflow spec ready to hand to an engineer -- plus a list of open decisions that need the Owner's input before work starts (not defaulted to either answer).
- `40-veda-advisors-and-brain.yaml` -- the other 2 repos, carried forward, same treatment as Section 20.
- `TREE4-AUDIT-ROUND-1.md`, `TREE4-AUDIT-ROUND-2.md` -- the 2-round standalone dedup+audit process applied to this tree (per the Owner's explicit instruction), same pattern used on Tree 1 and Tree 3. Round 1 discloses a real incident (a script bug truncated `10-merged-governance-layer.yaml` to empty mid-optimization; recovered in full from this session's own record, verified complete) plus 2 real findings: 3 domains missing guardrail content Tree 1's original spec actually had, and Section 30's `GAP-*` items deliberately restating Section 10's findings for standalone usability (kept, not trimmed -- reasoning documented). Round 2 verifies all fixes, normalizes a schema inconsistency (`why_p0`/`why_p1`/`why_p2` -> one `priority_rationale` field), and confirms the remaining empty-guardrail cases (25% of Section 10, 18% of Section 30) are each individually justified, not just numerically reduced.

## Headline numbers (sub-branch granularity, 149 total -- the real unit of measure, not the 28 domains)

| Status | Count | % |
|---|---|---|
| `implemented` | 8 | 5% |
| `mostly_implemented` | 14 | 9% |
| `fully_implemented` | 1 | 1% |
| `partial` | 58 | 39% |
| `confirmed_gap` | 31 | 21% |
| `likely_gap` | 16 | 11% |
| `narrow_scope` | 1 | 1% |
| `superseded_by_better_design` | 2 | 1% |
| `duplicate_ref` (Tree 1's own cross-references, not independently counted) | 6 | 4% |
| `not_applicable_to_code` (working practice/framing, not a buildable feature) | 12 | 8% |

Of the 131 sub-branches that are actually buildable claims (excluding `duplicate_ref` and `not_applicable_to_code`): **23 (18%) are solidly built** (implemented/mostly/fully), **47 (36%) are partially built**, **57 (44%) are confirmed or likely gaps**. This is a materially more sobering picture than the domain-level v1/v2 summary's "75% of domains have real implementation" -- domain-level status hid how much sub-branch-level detail inside each "partial" domain is actually unbuilt.

**Updated 2026-07-11 after the first real execution pass** (`50-completion-plan/04-implementation-log.yaml`): all 15 Phase-1 verification items were run against live code (not assumed), correcting 22 sub-branch statuses. The gap count went UP, not down, mostly because uncertainty got resolved honestly rather than assumed favorably -- e.g. the `tasks` table has only 6-7 of ~40 spec'd fields (not "partial," genuinely mostly absent), and 5 of 6 named onboarding UX specifics are directly contradicted by the live code. One real positive surprise: "My Option Is Not Available" (`U-D5.B5.S1`) turned out to be fully, robustly implemented with real AI analysis and governance routing -- better than assumed. Real code shipped this same pass, each independently verified (migration re-queried, `tsc`+`eslint` clean, and where applicable real unit tests run): all 9 Income Tax Engine functions wired into live dispatch; a real production bug fixed (invited users were permanently blocked at login, `auth-guard.ts`); CI's guardrail-presence manifest hardened for 3 previously-unprotected guardrails; and a real self-assessment + peer-review closure gate built for the AI Team dispatch path (`U-D12.B4.S3`, `likely_gap` -> `mostly_implemented`, live DB migration applied via Supabase MCP after a near-miss where the first migration-generation attempt would have tried to re-create the entire schema -- caught by reading the generated SQL before applying it, not just trusting the command).

- **The 3 largest confirmed-gap clusters**: (1) the ~150-specialist Audit Organization + the 5/6-level executive hierarchy (`U-D2`, 10+ sub-branches), (2) the L1-L7 audit cadence's specific mechanics and re-audit triggers (`U-D15`, 6+ sub-branches), (3) Connector Layers 2-4 + the Business Digital Twin (`U-D26`, 4 sub-branches).
- **The single highest-leverage, lowest-risk finding**: 23 of 25 computation-engine files (GAP-01, P0) are fully written but not wired into dispatch.
- **The single highest-leverage governance finding**: only 4 of ~30 constitutional guardrails are registered in the unified guardrail-engine.ts registry (GAP-02, P0) -- though sub-branch-level analysis found `U-D12.B2.S1` (Identity) is actually very well covered by a DIFFERENT mechanism (auth-guard.ts's route-level enforcement, not the guardrail registry) -- a case where "not registered" didn't mean "unenforced."
- **A structurally significant, previously-uncounted gap**: `U-D15.B3.S1`, "no task is EVER permanently complete" (re-audit on new evidence/changed requirements/incidents) has zero code support today -- only surfaced at sub-branch granularity, invisible in the v1/v2 domain-level summary.

## What this tree does NOT do

- It does not re-read the live codebase -- everything here traces back to Tree 3's already-audited evidence, per the instruction not to compare against the system again in this pass.
- It does not silently resolve open questions that need the Owner's judgment (see `30-gap-backlog.yaml`'s `open_decisions_needing_owner_input`) -- these are surfaced, not defaulted.
- It does not force a false gap narrative onto Tree 3's business-platform content that was simply never requested by the 9 documents (Section 20) -- that's real, valuable, built product, just outside this comparison's scope.
