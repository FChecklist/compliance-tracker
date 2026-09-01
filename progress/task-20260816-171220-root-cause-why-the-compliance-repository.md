# RCA: 422 open PRs on FChecklist/compliance-tracker — structural cause & proposed fix

Owner directive 2026-08-16. Read-only investigation only — **no PR was triaged, closed, or merged
by this task**, per SPEC. Sibling tasks running concurrently on this box own that separate work
(observed live via `systemctl --user list-units`: `task-20260816-171212-classify-the-entire-...`,
`task-20260816-171257-land-the-genuinely-code-touching-...`, `task-20260816-171304-continue-landing-...`,
`task-20260816-171310-finish-disposing-...`).

## Completed
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
- [x] Pulled the real, complete 422-row open-PR dataset (`gh api --paginate`, not `gh pr list`
      which truncates — see below) and the most-recent 600 closed PRs
- [x] Quantified authors, branch-prefix families, title-prefix buckets, arrival-by-day
- [x] Found and read the real PR-creation code path (`supervisor-entrypoint.sh`) — confirmed the
      "open a PR unconditionally" design decision from the code's own comment
- [x] Found and read the real RCA-dispatch code path (`pm-sentinel-tick.sh` Check 2a)
- [x] Confirmed, from live branch protection + a sample of recent closed PRs, that the audit/merge
      mechanism is wired and does work (539/600 most-recently-updated closed PRs are merged, not
      just closed) — ruling out "merge step never wired" as the cause
- [x] Sampled `mergeable_state` for the 25 most-recently-opened PRs: 24/25 are `behind`/`dirty`
- [x] Quantified same-UMR duplication across still-open PRs (resume/retry-loop evidence)
- [x] Sampled real PR file-diffs for the RCA class (72/72 touch zero `src/`/`drizzle/` files) and a
      non-RCA `docs:` sample (12/15 touch zero `src/`/`drizzle/` files)
- [x] Cross-checked PR-volume against sibling repos on the same box (claude-control: 8 open,
      veridian-scripts: 16 open, projexa: 4 open) to confirm this is a compliance-tracker-specific
      outlier, not a systemic landing failure across every repo
- [x] Wrote up findings + single recommended structural fix (below) for Owner decision — **not
      implemented**, per SPEC's explicit instruction not to unilaterally ship a change that alters
      how every worker reports

## Remaining
- [ ] None — this task's scope is diagnosis + a proposed fix for Owner sign-off, not implementation.
      If the Owner approves the recommendation below, it should be scoped as its own follow-up task
      (implementation touches `supervisor-entrypoint.sh`, a shared script outside this repo, per
      Rule 9's guardrail-manifest discipline for anything that changes how every worker reports).

---

## 1. Real per-source volume (proven, not estimated)

Data pulled live 2026-08-16 via `gh api --paginate repos/FChecklist/compliance-tracker/pulls`
(422 open PRs, full set — `gh pr list`'s own JSON output silently truncates to ~121 bytes on this
box, a known local `gh` quirk; paginated `gh api` does not).

**Authors of the 422 open PRs:**
| author | count |
|---|---|
| `FChecklist` (the shared bot identity every AI worker commits/pushes as) | 414 |
| `dependabot[bot]` | 8 |

**Title-prefix buckets (422 total):**
| bucket | count |
|---|---|
| `docs:` (case-insensitive conventional-commit prefix) | 205 |
| no recognizable prefix | 130 |
| `RCA:`-prefixed title | 29 |
| `fix:` | 18 |
| `chore:` | 15 |
| `feat:` | 11 |
| `build:` | 6 |
| `ci:` / `audit:` | 2 each |

(These numbers are close to, not identical to, the Owner's own 189/28 framing — likely a slightly
different string match; the substance — docs/RCA-titled PRs are the dominant single class — is the
same conclusion either way.)

**Arrival rate:** 149 of the 422 open PRs were created within 7 days of the most-recent PR's own
`createdAt` (2026-08-16T14:39:43Z) — matches the Owner's "150 in the last 7 days" figure. Daily
open-count peaked at 81 on 2026-08-15 and 44 on 2026-08-14.

**Branch-name family (the real dispatch fingerprint):** the overwhelming majority of branches
follow `worker/task-<timestamp>-<slug>`, i.e. one branch → one PR per worker task, with three
recognizable sub-families:
- `worker/task-...-rca--umr-<id>-killed` — an automatic RCA-of-a-killed-task dispatch (72 of the
  422 branches match this pattern)
- `worker/task-...-retry-<0|1|2>--<gap-slug>` — a gap that was re-dispatched up to 3 times, each
  retry getting its **own new branch and its own new PR** rather than amending the prior one (11
  distinct gap-slugs have 2–6 such sibling PRs open simultaneously, e.g. `ai-model-lifecycle---
  benchmark` has 6: PRs #1284, #1270, #1265, #1264, #1263, #1260)
- everything else — one-off gap-closure/feature dispatches

## 2. Yes — a PR is opened per task by design, even with zero shippable code

Read `supervisor-entrypoint.sh` (the real script every worker task's completion runs through,
`/opt/veridian/scripts/supervisor-entrypoint.sh`). It contains exactly two guards that skip
`gh pr create`:
- a **zero-commits-ahead** no-op guard (branch has literally nothing new relative to `main`)
- a **gitlink-only** guard (branch's only change is an accidentally-swept-in nested `.git`
  submodule reference)

Neither guard checks *what kind* of content the commits contain. The `gh pr create` call itself is
preceded by the comment, verbatim: `# Create the PR (record exists regardless of outcome —
auditability)`. So a task whose only real output is a progress note or an RCA report — a genuine,
non-zero commit, just not product code — still goes through the exact same `gh pr create` path as
a real feature/fix.

Direct evidence this is happening at volume, not theoretically: sampled all 72 open PRs on
`rca--umr-...-killed` branches via `gh api .../pulls/{n}/files` — **72/72 touch zero files under
`src/` or `drizzle/`**; 36/72 are literally a single file (almost always
`progress/task-....md`). PR #1290 is the cleanest example: one file changed,
`progress/task-20260815-114029-rca--umr-20260806-171558-146e-killed.md`, titled `docs: RCA for
U...`. A separate 15-PR sample of non-RCA `docs:`-titled PRs found 12/15 (80%) also touch zero
`src/`/`drizzle/` files.

Where the RCA volume specifically comes from: `pm-sentinel-tick.sh` Check 2a queries
`resource_governor.py --query-umr --status killed --limit 15 --exclude-rca-complete` on every tick
and dispatches a fresh `RCA: <umr_id> killed` task for every row found — each becoming its own
worker task, branch, and (once the RCA writes its report) PR. This is a real, intentional,
already-bounded (`--limit 15`) mechanism, not a bug — but it was never taught that "the report I'm
about to write doesn't need its own pull request."

## 3. Why nothing lands — it's not that the merge step is missing or broken

Checked `main`'s live branch protection (`gh api .../branches/main/protection`): 8 required status
checks (Lint, Type Check, Build, `audit-check`, Guardrail Presence Check, Asset Registry Coverage
Check, Unit Tests, Metadata Index Coverage Check) and `required_approving_review_count: 0` — the
earlier self-approval deadlock documented in this session's own memory
(`veridian-branch-protection-self-approval-deadlock-active`) has since been resolved; that memory
is now stale for this repo.

`supervisor-entrypoint.sh` does attempt an autonomous merge for every approved PR
(`gh pr merge "$PR_URL" --merge`, gated only on the Owner's 2026-07-31 full-autonomy directive,
Rule 12) — and merging genuinely works: of the 600 most-recently-updated **closed** PRs, 539 (90%)
are `merged`, only 61 are closed-without-merge. Recent daily merge counts (26 on 08-13, 32 on
08-14, 17 on 08-15) confirm the pipeline is live, not dead.

The real problem is throughput vs. arrival rate, and it compounds:
- Sampled `mergeable_state` on the 25 most-recently-opened PRs: **24/25 are `behind` or `dirty`**
  (only 1 was `clean`). At 20–80 new PRs/day landing on `main`, any PR that takes more than a few
  hours to get reviewed, audited, and merged is already stale by the time its turn comes.
- `supervisor-entrypoint.sh`'s merge step polls for up to 5 minutes (`for _ in $(seq 1 20); sleep
  15`) waiting for a `BLOCKED`/`BEHIND` state to clear, then attempts the merge once. If it fails
  (real conflict), the task is checkpointed `blocked` and the PR is simply left open — **nothing
  ever revisits it, rebases it, or retries the merge later.** There is no rebase-and-retry loop
  anywhere in this pipeline.
- The more PRs pile up unmerged, the faster `main` moves out from under the *next* PR's base
  commit, which increases the fraction going `behind`/`dirty`, which increases the pile-up. This
  is self-reinforcing.

**Contrast with the rest of the box** — same script, same mechanism, wildly different volume:
`FChecklist/claude-control` has 8 open PRs, `FChecklist/veridian-scripts` has 16, `FChecklist/
projexa` has 4. `compliance-tracker` has 422. The merge/audit machinery isn't absent or broken
here relative to those repos — it's the same `supervisor-entrypoint.sh` for every repo on the box.
`compliance-tracker` is simply the flagship product repo that the overwhelming majority of AI-OS
gap-closure, audit, and RCA tasks target, so it receives an order of magnitude more PR arrivals
than the infra repos, and the fixed-throughput review/merge pipeline that keeps up fine at
4–16 open PRs is structurally unable to keep up at 400+.

## 4. Yes — the same underlying work is reported repeatedly across multiple open PRs

Extracted every `umr-<id>` referenced in an open PR's branch name or title: **79 distinct UMR ids
are referenced by open PRs, and 22 of those UMRs are each referenced by 2–4 separate still-open
PRs** (e.g. `umr-20260808-150937-43d0` has 4: PRs #1132, #1119, #1086, #1063; `umr-20260808-
175055-cebd` has 4: PRs #1159, #1130, #1103, #1087). Separately, the `retry-0/1/2` branch-name
convention itself (11 gap-slugs, up to 6 sibling PRs each — see §1) proves duplication is baked
into the naming, not incidental: each retry of the same gap gets a brand-new branch and PR rather
than superseding the previous attempt. Several of these `retry-*` branches date to 2026-07-18 —
essentially a month old and still open, evidence this isn't only a fresh-arrival problem but also
an accumulated, never-cleaned backlog of duplicate attempts.

## 5. Recommendation (for Owner decision — not implemented by this task)

**Smallest real structural change:** teach `supervisor-entrypoint.sh` to distinguish "this
branch's diff is entirely non-code" (progress notes, RCA reports, `ai-os/**` governance-only
edits) from a real product change, using the same deterministic, pre-existing machinery the
no-op/gitlink guards already use — a path-based classifier run right before `gh pr create`, e.g.:
"every changed file matches `progress/**`, `ai-os/**/*.md`, or is the one already-open per-task
progress file" → skip `gh pr create`, checkpoint the task `completed_docs_only`, and instead
**append the report content to a single rolling per-repo document** (e.g.
`ai-os/RCA_AND_PROGRESS_LOG.md`, one append-only entry per task, already the pattern
`ai-os/boss/COMPLETED.yaml` and `ACTIVE-CLAIMS.yaml` use successfully) rather than opening a PR
for it at all.

This is deliberately narrow: it does not touch the merge/audit/review logic, does not change how
any *code*-bearing PR is handled, and reuses the existing no-op-guard pattern (a real,
already-proven design in this exact file) rather than inventing a new mechanism. Two things this
does **not** solve on its own, flagged honestly rather than folded in as scope creep: (a) the
`retry-0/1/2` duplicate-PR pattern, which needs the dispatcher to check for an already-open PR on
the same gap before firing a new retry branch — a related but separate fix, in a different script
(`dispatch-tick.py`/whatever currently drives retries); (b) the existing 422-PR backlog itself,
which is sibling tasks' explicit scope, not this task's.

Because this changes how *every* worker across the fleet reports a docs/RCA-only outcome, it
should not be shipped unilaterally — flagging it here, with the evidence above, for the Owner's
explicit go/no-op decision per Rule 9's guardrail-adjacent discipline (this isn't a named guardrail
in `scripts/check-guardrail-presence.mjs`, but it does change a fleet-wide reporting contract, the
same class of decision Rule 7 reserves for explicit division-of-labor before implementation).

## Appendix — commands used (reproducible)

- `gh api --paginate "repos/FChecklist/compliance-tracker/pulls?state=open&per_page=100" -q '...'`
  — full 422-row open PR list (title/author/branch/created_at)
- `gh api "repos/FChecklist/compliance-tracker/branches/main/protection"` — live branch-protection
  config
- `gh api "repos/FChecklist/compliance-tracker/pulls/{n}/files"` — per-PR file lists, sampled for
  the RCA-branch family (72/72) and a 15-PR non-RCA `docs:` sample
- `gh api "repos/FChecklist/compliance-tracker/pulls/{n}"` — `mergeable_state` sample (25 most
  recent)
- `gh api "repos/FChecklist/{claude-control,veridian-scripts,projexa}/pulls?state=open&per_page=1"`
  (via the `Link: rel="last"` header) — cross-repo open-PR counts
- Read `/opt/veridian/scripts/supervisor-entrypoint.sh` and
  `/opt/veridian/scripts/pm-sentinel-tick.sh` in full for the real dispatch/PR-creation/merge logic
