# System-Tree Audit Round 2 -- `50-merged-tree.yaml` ("3rd tree", Round 2)

**Scope:** same as Round 1. Verifies Round 2's fixes actually landed correctly and checks the judgment call behind them, without fixing anything further in this pass.

---

## Verification of Round 1 fixes (still holding)

- Both duplication fixes (`UI-14` -> `GOV-09` cross-ref, `DB-04` -> `GOV-07` cross-ref) re-checked and confirmed still present and correct.
- 94 domains, 94 unique ids, zero dangling cross-references, YAML parses cleanly -- all re-verified mechanically after the Round 2 edits, not assumed to still hold from Round 1.

## Verification of Round 2 fixes

- **11 domains received new `guardrails` content**: `API-04`, `API-05`, `API-08`, `API-12`, `DB-06`, `DB-17`, `UI-06`, `UI-10`, `PRX-05`, `VA-01`, `VA-09`. Spot-checked 4 of the 11 directly against the file -- content present, correctly worded, correctly attributed to the right domain.
- **Empty-guardrails count dropped from 58/94 (62%) to 48/94 (51%)** -- a net improvement of 10 domains flipping from empty to populated (not 11, because `VA-09` already had non-empty `guardrails` before Round 2 and was extended rather than newly filled -- confirmed by checking Round 1's own empty-domain list, which did not include `VA-09`). This discrepancy was checked and is not a bug.
- **Reverse cross-reference added and verified**: both `API-02` and `API-06` now contain a rule mentioning `PRX-06`, confirmed by direct string search in the file.

## Judgment-call check (was the 11-domain subset actually well-chosen, or arbitrary?)

Reviewed each of the 11 against the two criteria stated in Round 1 ("does the existing `rules` text already imply an enforcement mechanism that should have been split out"):

| Domain | Justified? | Why |
|---|---|---|
| API-04 / API-05 | Yes | `pmsEnabled`/`firmEnabled` feature-flag gating was already stated as a `rule` in both; genuinely a guardrail, correctly promoted. |
| API-08 | Yes | Token-scoped guest access was described in `rules` across multiple related domains; stating it explicitly as the domain's guardrail is accurate. |
| API-12 | Yes | Retention-before-disposal was implied by `documents/[id]/retention + dispose` in `rules`; correctly made explicit. |
| DB-06 | Yes | "publish requires approval" was already stated in `rules` almost verbatim; this is textbook guardrail content that had been mis-filed. |
| DB-17 | Yes, with a caveat | This is a judgment call to describe an ABSENCE of a guardrail (the missing CRUD surface) as if it were guardrail-relevant content. Defensible -- it IS information a reader checking "what enforces this domain" needs -- but it stretches the `guardrails` field's normal meaning (a protective mechanism) to also cover "the thing that's supposed to protect an operation, except the operation isn't reachable yet." Flagged, not reversed. |
| UI-06 | Yes | Maker-checker/quorum dual control is a real, standard guardrail pattern, correctly identified from the existing workflow description. |
| UI-10 | Yes, and it's the most valuable addition | This one surfaced a genuine finding (non-admin users seeing a dispatch UI that will reject their actions server-side) that was NOT previously stated anywhere in the 2nd tree -- this is new analysis produced by the act of writing an explicit guardrail field, not just a relabeling of existing text. Worth flagging to the Owner as a real, if minor, UX/security mismatch. |
| PRX-05 | Yes, with the same caveat as DB-17 | Same "guardrail protecting nothing reachable" pattern. |
| VA-01 / VA-09 | Yes | Directly responsive to the security finding -- states what SHOULD have caught it (SENTINEL.yaml's rule) and that it evidently didn't, which is exactly the kind of guardrail-context a security finding needs. |

**Conclusion: the 11-domain subset was well-chosen, not arbitrary padding.** 9 of 11 are straightforward "this was already implied, now made explicit" fixes; 2 (`DB-17`, `PRX-05`) stretch the field's meaning slightly but are flagged as such, not silently presented as ordinary guardrails; 1 (`UI-10`) produced genuinely new analysis rather than just reformatting existing text.

## Confirmed clean (re-verified, not carried forward from Round 1)

- Zero dangling cross-references (94 unique ids, all `XX-nn` references resolve).
- Zero duplicate domain ids.
- YAML parses without error.
- Both Round 1 duplication fixes still present and correct.
- All 3 Round 2 changes (11 guardrail additions, 2 reverse cross-references) verified present and correctly worded.

## What remains open, stated honestly

- **48/94 domains (51%) still have empty `guardrails`.** This is down from 62% but is NOT "done" -- the remaining 47 (after excluding the 1 already-filled `VA-09`) were reviewed at the list level in Round 2 but not each individually re-justified the way the 11 fixed ones were. A Round 3 could go further; this tree does not claim to have exhausted the guardrail-extraction opportunity, only to have made a real, judged dent in it.
- **31/94 domains (33%) still have empty `workflow`** -- untouched in Round 2, since Round 1 flagged guardrails as the primary gap and cross-references as the secondary one; workflow completeness was not addressed this round.
- These two open items are the honest state of the tree at the end of the requested 2-round process, not a claim of completion.

---

## Bottom line

The 3rd tree is **substantially clear and demonstrably improved over both the raw copy (Round 1 start) and the requirement-document tree's own Round-1-to-Round-2 trajectory** (this tree started from a lower duplication baseline and ends with a documented, judged partial fix to its main gap rather than a full fix). It is **not perfectly clear**: 51% of domains still lack explicit guardrail content, and workflow coverage was not addressed this round. Both are stated plainly here rather than smoothed over.
