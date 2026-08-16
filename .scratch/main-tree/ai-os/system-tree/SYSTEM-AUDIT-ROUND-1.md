# System-Tree Audit Round 1 -- `50-merged-tree.yaml` ("3rd tree", Round 1)

**Scope:** standalone structural/clarity audit of the 3rd tree against itself and its stated source (the 2nd tree, `10/11/12/13/20/30/40-*.yaml`). No comparison against the live codebase in this pass -- that already happened when the 2nd tree was built; this audit checks the reorganization, not the underlying facts. Per instruction, this is audit only -- nothing below was fixed while writing this file.

**Method:** every claim mechanically verified via `yaml.safe_load` + regex, not asserted from memory.

---

## Verification of the copy-and-optimize step (Step 1)

- **94 domains copied from the 2nd tree, 94 unique ids in the 3rd tree** -- zero domains lost or accidentally duplicated during the merge.
- **YAML parses without error.**
- **Zero dangling cross-references** -- every `GOV-xx`/`API-xx`/`DB-xx`/`UI-xx`/`PRX-xx`/`VA-xx`/`VB-xx` id mentioned anywhere in the file's text resolves to a real domain defined in the same file.
- **A mechanical phrase-repetition scan across the original 7 source files (run before merging) found exactly 2 real near-duplicate restatements**, both fixed in this round:
  1. `UI-14` restated `GOV-09`'s "capability tree is not a hardcoded taxonomy, confirmed by direct code comment" finding verbatim. Fixed: `UI-14` now cross-references `GOV-09` instead of repeating the claim.
  2. `DB-04` restated `GOV-07`'s "only 2 of the 25 engine files are wired" fact verbatim. Fixed: `DB-04` now cross-references `GOV-07` for the count instead of repeating it.
- **No other duplication found** in the mechanical scan (40+ character exact-phrase matches). This is a materially different starting point than the requirement-document tree (`ai-os/audit-tree/`): that tree was built from 9 independently-written source documents that genuinely restated the same requirements in different words many times over. This system-tree was synthesized by one author (this session) with cross-references built in from the start, so the baseline duplication rate was already low -- 2 confirmed instances, not dozens.
- **Domains reordered by repo** (compliance-tracker, projexa, veda-advisors, veridian-brain) instead of by source-file -- a real readability improvement, not just relabeling, since the original file split (10/11/12/13 vs 20 vs 30 vs 40) was an artifact of how research agents were dispatched, not a meaningful grouping for a reader.

## New findings from this audit pass

### Finding 1 (the main one) -- guardrail/workflow field coverage is incomplete, same class of gap as the requirement-tree's Round 1 Finding 1

Mechanically counted across all 94 domains:
- **58/94 (62%) have an empty `guardrails` array.**
- **31/94 (33%) have an empty `workflow` array.**
- **11/94 (12%) have an empty `rules` array.**

This is a real, honest gap against the standard set for this exercise ("guardrails... clear for every small sub branch"). It is **not uniformly a defect** -- some domains genuinely have no meaningful guardrail (e.g. `DB-11` Products/projects is two plain lookup tables with no enforcement logic to describe) or no ordered workflow (a pure data-listing domain like `GOV-18`'s governance-manifest index). But 62% empty is too high a rate to be entirely "genuinely nothing to say" -- a meaningful fraction of these are cases where the domain's `rules` field already describes an enforcement mechanism that should have been split out into `guardrails` explicitly, but wasn't. Not fixed in this round, consistent with keeping audit and fix separate; carried into Round 2.

### Finding 2 (minor, informational not a defect) -- `input`/`output` are legitimately N/A for 10-14 domains

10 domains have no meaningful `input` and 14 have no meaningful `output` (`PRX-05`, `PRX-11`, `PRX-12`, `PRX-13`, `VA-01`, `VA-02`, `VA-05`, `VA-06`, `VA-08`, `VA-09`, `VA-10`, `VB-01`, plus `GOV-18`, `DB-17`). Checked each by category: these are **finding/gap nodes** (`PRX-05`'s 12+-module gap, `VA-01`'s security finding), **pure structural/index nodes** (`VA-02`'s top-level directory listing, `GOV-18`'s manifest-file index, `PRX-12`'s infra lib listing), or **business-content-not-code nodes** (`VA-08`'s BSCVI methodology). All 14 are legitimate -- none read as a disguised gap in the underlying research. Distinguishing this from Finding 1: those cases could plausibly have guardrail content and mostly don't; these cases genuinely have no input/output shape to state.

### Finding 3 (minor) -- `objects` field is 100% populated, a genuine strength

Every one of the 94 domains names real, verbatim code artifacts (file paths, route paths, table names, component names) -- zero domains rely on vague description without a concrete object list. This is the tree's strongest property and is confirmed, not merely carried forward from the 2nd tree's own claims.

### Finding 4 (informational) -- cross-repo relationships are asymmetric in detail

`PRX-06`/`PRX-01` (projexa side) describe their relationship to `API-02`/`API-06` (compliance-tracker's v1/construction and v1/projexa routes) in real detail. But the compliance-tracker-side domains (`API-02`, `API-06`) do not symmetrically reference back to `PRX-06` -- a reader starting from the compliance-tracker side has no pointer telling them PROJEXA is the actual consumer of that API surface. Not a duplication issue, a one-directional-cross-reference gap. Worth adding in Round 2 for symmetry, not required for correctness.

## Confirmed clean

- Zero dangling cross-references (checked mechanically, all `XX-nn` id patterns).
- Zero duplicate domain ids.
- 100% `objects` field coverage with concrete, verbatim code artifacts.
- Both confirmed duplications from the original 7-file scan are fixed and verified absent in the merged output.

---

## Carried into Round 2

1. Add `guardrails`/`workflow` content to a meaningful subset of the 58/31 empty-array domains where the existing `rules` text already implies an enforcement mechanism or ordered sequence (Finding 1) -- not a mechanical 100% fill, a judged pass distinguishing "genuinely nothing to say" from "should have been split out."
2. Add the missing reverse cross-reference from `API-02`/`API-06` back to `PRX-06` (Finding 4).
3. Re-run the full mechanical verification suite (parse, dangling-refs, duplicate-ids, field-completeness) after those changes.
