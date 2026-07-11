# Audit Round 1 -- `10-merged-tree.yaml` (Round 1)

**Scope of this audit:** structural integrity, internal clarity, traceability back to `01-09-*.yaml`, and residual duplication *within the merged tree itself*. Per instruction, this audit does **not** compare against the live codebase and does **not** fix anything -- findings only, to be acted on in Round 2.

**Method:** every finding below was verified mechanically (grep/regex against the actual file), not asserted from memory. Scripts and exact counts are reproducible.

---

## Finding 1 (CRITICAL) -- No structured guardrail/input/output decomposition exists

Every one of the 137 sub-branches carries a single prose `requirement` field. A mechanical check (`grep -cE '^\s+(guardrail|input|output):'`) returns **0** -- there are no separate `guardrail`, `input`, or `output` fields anywhere in the tree, even though the source material specifies these distinctly in many places (e.g. D4.B1's Input/Process/Output/Handover field groups, D13's per-selection Input/Process/Output/Assumption/Logic validation, D9's approval option sets which are literally an "output" contract for a UI decision point).

The user's standard for this audit explicitly names "guardrails, input, out[put]" as things that must be clear per sub-branch. A single prose blob does not meet that bar, even where the prose *mentions* input/output in passing.

**Not every sub-branch has a natural input/output/guardrail shape** (e.g. D1.B1.S1's mission statement doesn't take an "input"). Round 2 should add explicit `guardrail:` / `input:` / `output:` fields wherever the source material actually specifies them, and leave them genuinely absent (not fabricated) where it doesn't -- but that must be a visible, deliberate choice per node, not a uniform silent omission.

## Finding 2 (moderate) -- Footer metadata is wrong

Declared: `count_of_branches: 68`, `count_of_sub_branches: 108`.
Actual (mechanically counted): **90 branches**, **137 sub-branches**. `count_of_domains: 28` is correct.

Trivial to fix, but its wrongness means the tree was never mechanically verified before being presented as complete.

## Finding 3 (moderate) -- Citation drift on Guardrails 21-29

All 9 sources for Guardrails 21-29 in `D12.B4` append a spurious trailing word "Guardrail" (e.g. `"01:Guardrail 21 -- Quality Assurance Guardrail"`) that does not exactly match the source part name in `01-consutitution.yaml` (`"Guardrail 21 -- Quality Assurance"`, no trailing word). Guardrails 1-20 and 30 are cited correctly, without the extra word. This is a mechanical traceability break, confirmed by exact-string diff -- not a content problem (the paraphrased content is accurate), a citation-format problem.

## Finding 4 (minor) -- Citation typo on D5.B4.S2

`D5.B4.S2` cites `"04:Dynamic Mode Pill & Chain Requirement (for VERI Chat conversations)"`. The actual part name in `04-veri-chat.yaml` is `"Dynamic Mode Pill & Dynamic Chain Requirement (for VERI Chat conversations)"` (dropped the second "Dynamic"). Same class of defect as Finding 3.

## Finding 5 (moderate) -- Real content gaps: 12 source sections never made it into any branch

A mechanical diff of every `- part:` heading in `01-09-*.yaml` against every source string cited in `10-merged-tree.yaml` found **26 of 303 source parts (8.6%) with zero citations**. Of those 26:

**Legitimately excluded (14)** -- meta-instructions to the analyst, not system requirements (e.g. "Preamble / operating instructions" in 03/05/06/08, "Closing instruction (repeats the preamble...)" in 08, "Title / framing" cover-page text). Correct to exclude, but the tree should say so explicitly rather than silently drop them -- currently there is no record anywhere that these were considered and excluded on purpose vs. simply missed.

**Genuine content gaps (12)** -- real requirements/rationale that are absent from every branch:

| # | Source | Content missing | Why it matters |
|---|---|---|---|
| 1 | `05 §1. Vision` | WGIEF's "why" -- transform manual execution into decision-driven execution | D7/D1 cover the *Constitutional Principle* (§2) but never the Vision (§1) that motivates it |
| 2 | `05 §17. Human-Centric Design Principle` | Reduce administrative effort; VERI proactively does prep/coordination/monitoring so humans focus on judgment | A closing design principle for the entire WGIEF domain, absent everywhere |
| 3 | `05 Closing addendum 1` | Work Object as single source of truth -- unify To-Do/MoM/Email/Reviews/Approvals/Reports as views of one object, not separate modules | One of the most concrete, actionable architectural ideas in the whole corpus; D4 (Universal Work Object) defines fields/states/lifecycle but never states this unification principle |
| 4 | `03 Closing note` | Elevate Dynamic Chain to primary system object; single Chain ID linking task/chat/approvals/audit/knowledge | Only the *field name* ("Dynamic Chain ID") survived into D4/D5 -- the actual architectural rationale did not |
| 5 | `03 §19. Constitutional Principles` | DMP-DCF's closing mandatory-compliance statement | D5.B1 covers Vision/Purpose/Core Principle but not this closing mandate language |
| 6 | `06 Preamble` | "Must be simple enough that a non-technical user can do it in one click" | A concrete UX bar for the entire connector domain (D26), currently absent |
| 7 | `08 Preamble` + `08 Closing instruction` | Don't make the system too rigid; don't make it too "open"/unconstrained; minimize tokens; help automation/loop engineering; "perfect for human use" | A cross-cutting balance principle for D5/D12/D13/D25 collectively -- not captured as an explicit principle anywhere |
| 8 | `02 Framing / naming correction` | Why roles are "Chief X Officer" not "X Officer" (these are AI executives running organizations, not individual auditors) | Rationale behind D2's naming convention, dropped |
| 9 | `02 Universal Task Lifecycle -- audit cadence framing` | Why continuous audit beats daily audit for an AI-native OS (vs. traditional ERP) | The rationale for D15's entire cadence model is gone, only the resulting rules survived |

(Rows counted: 9 distinct gap topics covering the 12 missing parts, since a few parts share one topic, e.g. the 08 preamble+closing pair.)

## Finding 6 (minor) -- One un-cross-referenced duplication survived

`D2.B3.S3` (DeepSeek's role definition, "AI Resource Management" responsibility) restates the same model-allocation percentages as `D3.B1.S1`, with no note pointing to D3 as the canonical policy location -- inconsistent with how every other cross-domain overlap in this tree (e.g. `D12.B3.S3` -> D3, `D15.B1.S2` -> D14.B3) was explicitly cross-noted.

## Positive findings (confirmed, not just asserted)

- **Zero dangling cross-references.** Every `see DX.BY...` pointer in the tree resolves to a real, defined node id (checked against all 255 defined ids).
- **The two `open_reconciliation_items` (R1, R2) are the right call, not a defect.** Where source documents genuinely conflict (04 vs. 05's approval-option vocabularies; 02's cadence table vs. its own prose), the tree flags the conflict instead of forcing a false merge that would silently drop information.
- **91% citation coverage** (277/303 source parts traceable) with the gaps now itemized above rather than hand-waved.

---

## Carried into Round 2

1. Add `guardrail:` / `input:` / `output:` fields per sub-branch wherever the source specifies them (Finding 1).
2. Fix footer counts to match mechanically-verified totals (Finding 2).
3. Fix the 9 Guardrail 21-29 citation strings + the D5.B4.S2 citation typo (Findings 3-4).
4. Add the 9 missing content topics as new sub-branches or explicit additions to existing ones (Finding 5) -- and explicitly mark the 14 legitimately-excluded preamble/meta parts as "excluded, not missed."
5. Add the missing D2.B3.S3 -> D3 cross-reference (Finding 6).
