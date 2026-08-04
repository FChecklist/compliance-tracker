# OCID-058 — Canonical Registration: Real Predecessor-UMR Correction and Duplication Disclosure (2026-08-04)

**Registration and discovery only.** No certification performed, no execution architecture modified, no
runtime code touched. Per this task's own explicit instruction: *"Do not certify anything, do not modify
any execution architecture, do not touch any runtime code."* Real certification of the Universal Task
Registry as the single real execution object across every actor and runtime **stays locked behind the
same OCID-020 through OCID-040 gate** that governs every other OCID in this range (SEC-07) — see §4.

## 0. Full real directive text (verbatim, as dispatched to this task)

> SPEC: This dispatch is registration and discovery only. Zero duplication independently confirmed, an
> exact query against the real umr_tasks database for the original OCID-058 registration task identity
> returned zero matches. Parent chain, this OCID is a child of OCID-057, whose own real UMR is
> UMR-20260804-053248-0e0f, already minted and confirmed present, placed immediately after it. The Owner
> directive covers certifying the Universal Task Registry as the single real execution object across
> every actor and runtime. Your real job is to write a canonical registration document linking a freshly
> minted real UMR for OCID-058 to OCID-057 real UMR as its predecessor, capturing the full real directive
> text. Do not certify anything, do not modify any execution architecture, do not touch any runtime code.
> Record explicitly that real certification work stays locked behind the same OCID-020 through OCID-040
> gate. Open a real pull request containing only real registration documentation, zero code or
> architecture changes.

Every factual premise in the paragraph above was independently re-checked before writing anything below,
per this repo's own standing discipline (not trusted from the dispatch prompt alone — the same discipline
`ai-os/VERIDIAN_OCID_057_UNIVERSAL_KNOWLEDGE_GRAPH_2026-08-04.md`, PR #866, applied to its own dispatch
prompt one task earlier in this same chain). Two of the three premises above do not hold as stated.

## 1. Duplication check — the "zero duplication" premise is false

`gh pr list --search "ocid-057"` / `"ocid-058"` (state: all, run live at the start of this task) returns
real, currently **open, unmerged** PRs for both OCIDs, from earlier tasks in this same identifier range:

| OCID | PR | Branch | State | Content |
|---|---|---|---|---|
| 057 | **#866** | `worker/task-20260804-040805-register-ocid-057--universal-knowledge-g` | OPEN | `ai-os/VERIDIAN_OCID_057_UNIVERSAL_KNOWLEDGE_GRAPH_2026-08-04.md` — real Universal Knowledge Register/Graph/Dedup/Broken-Reference/Orphan report. All CI checks pass (Vercel excluded — free-tier daily deploy cap, not a real failure); carries a real `AUDIT: PASS` comment already. |
| 058 | **#875** | `worker/task-20260804-045439-register-ocid-058--universal-task-regist` | OPEN | Three real documents: `ai-os/VERIDIAN_OCID_058_EXECUTION_ARCHITECTURE_REPORT_2026-08-04.md`, `ai-os/VERIDIAN_OCID_058_EXECUTION_TRACEABILITY_REPORT_2026-08-04.md`, `ai-os/VERIDIAN_OCID_058_UTR_REGISTRY_2026-08-04.md` — a real UTR/execution-architecture discovery+verification pass, including a registered `GAP-OCID058-UTR-MULTI-ACTOR-STRUCTURE-MISSING`. All CI checks pass except `audit-check`, which is currently **failing** because no `AUDIT: PASS`/`AUDIT: FAIL` comment has been posted yet (Rule 10's mandatory-audit merge gate, `.github/workflows/mandatory-audit-check.yml`) — this is a real, still-open blocker on that PR, not a defect in this document's own scope. |

**This is real, substantive prior work for the exact OCID-058 label this task was dispatched under.**
Whatever mechanism produced this task's "an exact query against the real umr_tasks database... returned
zero matches" premise queried the wrong thing: `umr_tasks` (the systemctl-dispatch-level table, §2 below)
is not where GitHub PR history lives, and a zero-match result there says nothing about whether the OCID
label itself has already been worked. Flagged here rather than silently proceeded past, per Rule 11 (`ai-os/boss/ACTIVE-CLAIMS.yaml`'s own protocol) and this codebase's established honesty bar. **This
document does not re-derive PR #875's discovery content** (that would compound the duplication, not fix
it) — it registers one corrected, additive fact (§2) and defers to #875 as the canonical OCID-058
discovery artifact once merged.

## 2. OCID-057's real predecessor UMR — corrected

The dispatch's claim — *"OCID-057, whose own real UMR is UMR-20260804-053248-0e0f, already minted and
confirmed present"* — is **half right**. Queried directly against the live `umr_tasks` table
(`/opt/veridian/ai-os/memory/superboss-register.sqlite`, via `resource_governor.py --query-umr`, the same
real, live, actively-written database `ai-os/VERIDIAN_UMR_UTR_EUID_DISCOVERY_VS_LIVE_SYSTEM_2026-08-03.md`
§2 already confirmed authoritative for this table):

`UMR-20260804-053248-0e0f` **is** a real, live row. But it is not OCID-057's canonical UMR — its own
`status` field says exactly what it is:

```
umr_id:          UMR-20260804-053248-0e0f
task_identity:    task-20260804-040805-register-ocid-057--universal-knowledge-g
status:           rejected_duplicate
source_trigger:   dispatch-tick:resume_interrupted_workers
reason:           duplicate submission rejected: task_identity=
                  'task-20260804-040805-register-ocid-057--universal-knowledge-g'
                  already queued as umr_id=UMR-20260804-042343-572b
                  (source_trigger='dispatch-tick:resume_interrupted_workers', tier=1)
```

It is one of **seven** `rejected_duplicate` resume-retry rows queried live for that same `task_identity`
(`UMR-20260804-{044252-570b, 043323-2a06, 045333-aad8, 050241-c2e4, 051329-8068, 052325-b226,
053248-0e0f}`, all rejected for the identical reason, all pointing back to the same original) — a real
watchdog/resume-tick artifact (`dispatch-tick:resume_interrupted_workers` repeatedly tried to resume an
already-running worker unit and was correctly rejected each time), not seven distinct dispatches of real
work. **The canonical, `status=running` row for OCID-057's actual task is `UMR-20260804-042343-572b`** —
the one every rejection above cites as already-queued. This is the real predecessor identity, if a
systemctl-dispatch-level `umr_tasks` UMR is what "OCID-057's real UMR" is meant to denote.

**Caveat, disclosed rather than papered over:** PR #866 (OCID-057's own real work, §1 above) itself does
**not** cite any `umr_tasks` UMR for OCID-057 at all — it deliberately treats OCID-057 as a task-label
trusted per the OCID-031/036/038 precedent (`ai-os/OS.yaml`), with its real governance parent being
OCID-052 (`UMR-20260803-115620-29c6`), not a systemctl-dispatch UMR. That is arguably the more defensible
position: `UMR-20260804-042343-572b` is a real row, but it is a raw `veridian-worker@*.service` dispatch
record (tier/status/heartbeat for the *systemd unit*, not a `[UMR-...]`-tagged PM-decision identity in the
sense every other citation in this document family uses). `ai-os/VERIDIAN_UMR_UTR_EUID_DISCOVERY_VS_LIVE_SYSTEM_2026-08-03.md` §2 flagged this exact ambiguity as an
"honest open question... not independently confirmed this pass" before this task existed — this document
is the first to test it against a concrete example, and the answer is: **not a safe 1:1 assumption**.
PR #875's own citation of OCID-057's parent as `UMR-20260804-035943-3c38` demonstrates the same risk
concretely — that ID is real, but its `task_identity` is `owner-task-20260804-035942-3123896`, a raw
`owner_dispatch_gateway` systemctl dispatch with no textual link to "OCID-057" anywhere in its own row;
PR #875 appears to have inferred the mapping from chronological adjacency (a same-minute cluster of owner
dispatches), not from a confirmed identity match. **Recommendation for whoever reconciles PR #875 before
merge: prefer citing OCID-057's real governance parent as PR #866's own choice (task-label + OCID-052
lineage) over any `umr_tasks` systemctl-dispatch row — none of the three candidate UMRs this document
family has now cited for "OCID-057" (`-053248-0e0f`, `-042343-572b`, `-035943-3c38`) is a `[UMR-...]`-
tagged PM-decision identity, and two of the three are demonstrably not what they were claimed to be.**

## 3. This task's own real UMR — none exists; not fabricated

The dispatch instructed: *"write a canonical registration document linking a freshly minted real UMR for
OCID-058."* Checked directly against the same live `umr_tasks` table for this task's own identity
(`task-20260804-164217-ocid-058-registration-only-universal-tas`, and the substrings `164217`,
`20260804-1642`): **zero rows**. This task was not dispatched through the `resource_governor.py`
systemctl path that produces `umr_tasks` rows (consistent with `ai-os/VERIDIAN_UMR_UTR_EUID_DISCOVERY_VS_LIVE_SYSTEM_2026-08-03.md` §2's disclosed open question that not every dispatched
task has a confirmed 1:1 `umr_tasks` row — now demonstrated with a second concrete example, this task
itself, alongside §2's OCID-057 finding).

This document does **not** fabricate a UMR to satisfy the "freshly minted" instruction — minting one would
require a real `resource_governor.py --submit` call, which is a real dispatch action against live
infrastructure, out of scope for a documentation-only registration task and explicitly barred by this same
task's own "do not touch any runtime code" instruction. This document *is* the real registration artifact
for OCID-058; its own real identity is the git commit(s) and PR that carry it, the same durable-artifact
convention every other OCID in this family uses when no separate PM-dispatch `[UMR-...]` tag was supplied
with the task.

## 4. Certification remains locked

Per this task's own explicit instruction, restated here for the permanent record: real certification of
the Universal Task Registry (UTR) as the single, unified execution object across every actor and runtime
— the Owner directive this OCID-057/058 pair serves — **stays locked behind the same OCID-020 through
OCID-040 gate** that already governs every other OCID in this numeric range under SEC-07. This mirrors the
identical gate structure `ai-os/OCID_067_VEDTOCP_DIGITAL_TWIN_PROGRAM_2026-08-04.md` uses for OCID-067
(locked pending OCID-015 through OCID-066 all independently reaching VERIFIED status) — the same pattern,
applied here to UTR certification specifically. No certification, testing, or implementation of UTR was
performed by this document, by PR #866, or by PR #875. All three are documentation/registration only.

## 5. Recommendation

1. **Merge PR #866 (OCID-057) and PR #875 (OCID-058) through normal review**, not superseded by this
   document — they are the real, substantive artifacts for their respective OCIDs. PR #866 already has a
   real `AUDIT: PASS`. PR #875 needs its mandatory audit comment posted (Rule 10) before `audit-check` can
   pass — that is a real, outstanding, separate blocker this document does not resolve (posting an audit
   verdict is a certification act on someone else's PR, and this task's own scope is registration only).
2. **When PR #875 is next touched**, its own §-level predecessor-UMR citations for OCID-057
   (`UMR-20260804-035943-3c38`) should be corrected or caveated per §2 above, rather than left as an
   unverified chronological-adjacency guess.
3. **File a governance amendment** (not performed here, out of this document's registration-only scope,
   but named honestly as a real recommendation): the `GAP-OCID-FABRICATED-PARENT-CHAIN-REFERENCES` entry
   PR #866 registers in `ai-os/MASTER-TRACKER.yaml` (not yet on `main` — that PR is still open) should be
   broadened, once merged, to cover this document's own finding: dispatch prompts have now twice (OCID-057
   and OCID-058) asserted specific UMR identities for prior OCIDs that a direct, live query shows are
   either nonexistent or materially mischaracterized (real-but-wrong-status, or real-but-unconfirmed
   identity mapping). This is the same defect class, a superset of the narrower "doesn't exist at all"
   framing that entry currently uses.

## 6. Registration

- Canonical artifact: this file.
- Indexed in `ai-os/OS.yaml` per `scripts/check-metadata-index-coverage.mjs`'s requirement.
- Cites (as real, independently-verified subjects of this document, not as endorsed predecessor UMRs):
  `UMR-20260804-053248-0e0f`, `UMR-20260804-042343-572b`, `UMR-20260804-035943-3c38` (all real live
  `umr_tasks` rows, §2); PR #866 (OCID-057) and PR #875 (OCID-058), both real and open at time of writing.
- No schema, code, database, or runtime change made by this document. No certification performed.
  Registration and discovery only, per this task's own explicit scope.
