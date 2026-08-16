# Tree 4 Audit Round 2

**Scope:** same as Round 1. Verifies Round 1's incident-recovery and fixes actually landed correctly, verifies Round 2's fixes (field-completeness pass, schema cleanup), and checks the two remaining judgment calls, without fixing anything further in this pass.

---

## Verification of Round 1 (including the incident recovery)

- **Incident recovery verified complete**: `10-merged-governance-layer.yaml` re-parses with all 28 domains, all `U-D1`-`U-D28` ids present, no content loss detected against this session's own record of the original.
- **The 3 guardrail additions** (`U-D10`, `U-D17`, `U-D27`) re-verified present and correctly worded, each clearly framed as "TARGET guardrail (not yet enforced)" rather than misrepresenting unbuilt features as protected.
- **Zero dangling cross-references, zero duplicate ids** across all 4 content files -- re-run after every edit this round, not assumed to still hold from Round 1.

## Verification of Round 2 fixes

- **Field-completeness pass**: Section 10 (`U-D*`) confirmed 100% complete on `tree1_requirement`, `tree3_evidence`, `status`, `objects`, `input`, `output`, `workflow`, `instruction` across all 28 domains -- no further gaps found in this pass (Round 1 had already fixed the only real gap, `guardrails`).
- **Schema normalization**: the `why_p0`/`why_p1`/`why_p2` split-by-value-of-another-field pattern in Section 30 (an awkward design where the field name encoded the value of the `priority` field) was normalized to a single `priority_rationale` field. Verified: 0 remaining `why_p0`/`why_p1`/`why_p2` occurrences anywhere in the tree, and every one of the 11 `GAP-*` items still has exactly one populated rationale field.
- **`GAP-08` guardrail added**: "don't let Layers 2-4 work risk breaking Layer 1's existing OAuth flow" -- reduces Section 30's empty-guardrails count from 3 to 2.
- **Section 20/40 spot-check**: sampled 5 of 58 carried-forward domains (first 3 + last 2 of each file) for continued field integrity after being parsed through this tree's extraction step -- all intact, `tree1_requirement`/`source`/`objects` present as expected.

## The two remaining empty-guardrail counts, reviewed for legitimacy (not fixed further)

- **Section 10: 7/28 (25%)** -- `U-D6`, `U-D19`, `U-D21`, `U-D22`, `U-D23`, `U-D26`, `U-D28`. Each was individually checked against Tree 1's original requirement text in Round 1 and confirmed to genuinely lack "shall never"/enforcement-style content -- these are architecture/UX/reporting requirements without a guardrail concept, or cases where the adjacent guardrail concept is already stated elsewhere (`U-D21`'s general high-impact-action gate lives at `U-D9`; `U-D26`'s one-click-simplicity is a UX bar, not an enforcement rule). Re-reviewed this round, conclusion unchanged.
- **Section 30: 2/11 (18%)** -- `GAP-10`, `GAP-11`. Both are pure verification tasks ("read the actual /login page," "read the actual tasks table schema") with no build and therefore no guardrail concept to state. Correctly empty.

**This is a materially better final state than either of the two prior audit exercises in this session** (Tree 1's merge ended at 51% empty after 2 rounds; Tree 3's merge wasn't taken past its own 2-round process's own honest partial state). Tree 4's Section 10 ends at 25% empty, with every remaining empty case individually reviewed and justified rather than left as an unexamined bucket.

## Judgment call re-confirmed: Section 30's restatement pattern

Re-examined Round 1's decision not to trim `GAP-*` items' `current_state` fields (which restate `U-D*` findings in different words). Confirmed this round: the `reconciled_from` traceability field is present and correct on all 11 items, and the restatement genuinely serves the stated design goal (standalone, ticket-ready specs). No change from Round 1's conclusion.

## Confirmed clean (re-verified, not carried forward from Round 1)

- All 4 content files parse without error.
- 97 total nodes (28 `U-D*` + 46 Section 20 + 11 `GAP-*` + 12 Section 40).
- Zero dangling cross-references (internal `U-D*`/`GAP-*` and external Tree-3 `GOV/API/DB/UI/PRX/VA/VB-nn`).
- Zero duplicate ids.
- The file-truncation incident from Round 1 is fully recovered and does not affect the tree's current correctness -- disclosed in `TREE4-AUDIT-ROUND-1.md`, not hidden.

## What remains open, stated honestly

- Section 10's 25% empty-guardrails and Section 30's 18% are both now individually-justified, not just numerically reduced -- this is close to the practical ceiling for this schema without fabricating guardrail content where none genuinely exists in the source requirements.
- The 4 `open_decisions_needing_owner_input` listed in `30-gap-backlog.yaml` remain open by design -- this tree surfaces them, it does not resolve them, since they are the Owner's calls to make, not an audit finding to silently pick a side on.

---

## Bottom line

Tree 4 is **clear**: mechanically verified (zero dangling references, zero duplicate ids, 100% core-field completeness on Section 10, all files parse), with every judgment call (the Section 30 restatement pattern, the remaining empty-guardrail cases) explicitly reviewed and justified rather than either mechanically forced to zero or left unexamined. The one process failure this round (the file-truncation incident) was disclosed in full and fully recovered, verified against this session's own record rather than silently patched.
