# Audit Round 2 -- `10-merged-tree.yaml` (Round 2)

**Scope:** same as Round 1 -- structural integrity, internal clarity, traceability, residual duplication. No comparison against the live codebase. Findings only in this pass; nothing below was fixed as part of writing this file (per instruction, audit and fix are separate steps).

**Method:** every claim below is mechanically verified against the current file, not asserted from memory.

---

## Verification of Round 1 fixes

| Round 1 finding | Status |
|---|---|
| 1. No guardrail/input/output fields anywhere | **Partially addressed.** 24 sub-branches now carry `guardrail:`, 15 carry `input:`, 18 carry `output:` (out of 149 total sub-branches -- roughly 16%/10%/12%). Applied to the domains with the clearest input-output shape: D4.B1 (task field groups), D5.B3/B5 (chain selection flows), D9 (approval option sets), D12 (all 16 constitutional guardrail sub-branches, 100% coverage within that domain), D13 (per-selection validation), D15.B1.S1 (L1 audit gate), D17 (handover), D21.B4/D10.B3 (email split), D26.B3 (connector normalization), D6.B3/D4.B7 (new architectural recommendations). **Not applied** to D2 (org role definitions, which do contain real "Cannot X" authority-limit content that could have been extracted as `guardrail:` fields but wasn't), D18/D19/D22/D23 (Hallucination Discipline, Reporting, Follow-up, Dashboard), and most of D6/D7/D8/D10/D11/D16/D20/D24/D25/D27/D28. This was a deliberate scoping choice (stated in the file's own changelog), not silently dropped -- but it means the coverage is partial, not universal, and a reader should not assume every sub-branch has these fields. |
| 2. Wrong footer counts | **Fixed.** Mechanically recounted: 28 domains, 96 branches, 149 sub-branches, all verified by grep against the actual file, not estimated. |
| 3. Guardrail 21-29 citation typos | **Fixed.** All 9 corrected; verified via exact-string diff against `01-consutitution.yaml`. |
| 4. D5.B4.S2 citation typo | **Fixed.** Verified. |
| 5. 12 genuine content gaps (of 26 originally uncited parts) | **Fixed.** All 12 promoted into 10 new/extended branches (D1.B3, D1.B4, D2.B2.S2, D4.B7, D5.B1.S3, D5.B8, D6.B3, D7.B3.S2, D15.B1.S6, D26.B1.S5). Traceability re-verified mechanically: 299/303 source parts now cited (98.7%, up from 91%). The remaining 4 uncited parts are exactly the 4 confirmed-meta items logged in `excluded_meta_content` -- no unexplained gap remains. |
| 6. D2.B3.S3 missing cross-ref to D3 | **Fixed.** Verified present. |

## New findings from this round's independent pass

### Finding 7 (moderate) -- Round 2 introduced its own small duplication while fixing Finding 5

Promoting `03 §19. Constitutional Principles` into `D5.B1.S3` (to close the Finding-5 gap) created a new overlap: **D5.B1.S3's text substantially restates D5.B1.S1 and D5.B1.S2.**

- D5.B1.S1 (from §3 Core Principle): *"No business activity may exist without a Dynamic Chain -- mandatory, no exceptions (task/workflow/report/approval/communication/automation/AI execution/API execution/scheduled job)."*
- D5.B1.S3 (from §19 Constitutional Principles): *"every task/communication/workflow/decision/approval/report/automation/audit/API call/AI interaction/software operation shall be governed by a Dynamic Chain"*

These are the same claim, restated with a near-identical enumeration. D5.B1.S3 also restates D5.B1.S2's "software execution / continuous learning" objectives in its closing clause ("maximize deterministic software execution, minimize unnecessary AI intervention, continuously improve organizational knowledge"). The only genuinely new content in D5.B1.S3 is the authority-level statement ("mandatory for every component... a foundational constitutional requirement") -- which is worth keeping, but the branch as currently written duplicates roughly 70% of its own text with its two siblings.

**Not fixed in this pass**, consistent with Round 1's own practice of listing findings without correcting them inline. A Round 3 (if the Owner wants one) would tighten D5.B1.S3 down to only the authority-level clause and cross-reference D5.B1.S1/S2 for the restated parts, the same way every other Round 2 merge was handled.

### Finding 8 (informational, not a defect) -- guardrail-field coverage is intentionally partial

Documented under Finding 1's status above. Flagging separately here because it's the single largest remaining gap between the current tree and the user's original bar ("guardrails, input, out... clear for every small sub branch"). Two honest paths forward exist: (a) accept that not every sub-branch has a literal input/output/guardrail shape and the current ~15% coverage represents the sub-branches that genuinely do, or (b) do a further pass adding at least a `guardrail:` field to every sub-branch in D2 (role Cannot-lists), D18/D19/D22/D23, and the remaining largely-descriptive domains, even where it mostly restates the `requirement:` text. This tree does not decide between (a) and (b) -- that is an Owner call, not an audit finding to silently resolve.

## Confirmed clean (mechanically re-verified, not just carried forward from Round 1)

- **Zero dangling cross-references** across all 273 unique node ids (re-run after every edit in this round, not just once at the end).
- **Zero duplicate node ids** -- every one of the 273 defined ids is unique.
- **YAML parses without error** (`yaml.safe_load` succeeds).
- **98.7% source-part traceability** (299/303), with the remaining 4 explicitly logged as intentional exclusions, not silent gaps.
- **R1 and R2 open reconciliation items remain correctly unresolved** -- re-checked, still accurately describe genuine source-level conflicts (04 vs. 05 approval vocabularies; 02's cadence table vs. its own prose) that this tree should not paper over.

---

## Bottom line

The tree is **substantially clear**: every branch and sub-branch has a traceable, tightened requirement statement, cross-references are internally consistent (zero dangling, zero duplicate ids), and content coverage against the 9 source documents is 98.7% with the gap fully explained. It is **not perfectly clear** in two specific, named ways: (1) Finding 7's small self-inflicted overlap in D5.B1, and (2) guardrail/input/output field coverage is real but partial (~15% of sub-branches), by deliberate scope choice rather than oversight, and that scope choice has not been confirmed with the Owner.
