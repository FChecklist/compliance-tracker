# VERIDIAN OCID-054 — Universal Repository Reconciliation, Real Discovery/Inventory (2026-08-04)

Cites: dispatch prompt for `task-20260804-040754-register-ocid-054--universal-repository`, real
confirmed parent OCID-053 (`UMR-20260804-033853-2a17`), itself parented by OCID-020
(`UMR-20260802-165606-4413`) and OCID-021 (`UMR-20260802-173631-ca85`).

**Scope of this pass**: real, read-only discovery and inventory only. Per the PM's explicit
instruction, credential rotation and any repository deletion/archival/retirement/disposition
change are **withheld this phase** — everything below is findings, not actions. Full findings
list (credentials, archival candidates) is presented at the end for an explicit real-time Owner
decision.

**Honesty note on depth**: this is org-wide (15 real repos, 1088 local task workspaces, 21 live
systemd timers). Full exhaustive commit-by-commit history review of every repo was not performed
within this pass's real budget — where a check is a spot-check rather than exhaustive, that is
stated explicitly rather than implied as complete.

---

## 0. OCID-012 re-check (3rd time this session)

`git grep -n "OCID-012"` across this entire workspace (all tracked files, all extensions):
**zero matches**, identical to the two prior checks this SPEC references. OCID-012 is **not**
being registered or treated as real. Flagged back to the Owner in this session's chat response,
not silently accepted or silently dropped, per standing instruction.

---

## 1. Repository Reconciliation Register

Ground truth: `gh repo list FChecklist --limit 100` (live API call, 2026-08-04).

| Repo | Visibility | Archived | Default branch | Last push | Size (KB) | Open issues |
|---|---|---|---|---|---|---|
| compliance-tracker | public | no | main | 2026-08-04T04:11Z | 49012 | 155 |
| claude-control | public | no | master | 2026-08-04T03:35Z | 6936 | 10 |
| projexa | public | no | main | 2026-08-02T20:25Z | 1199 | 3 |
| veridian-scripts | private | no | main | 2026-08-02T15:07Z | 691 | 7 |
| veridian-ai-os | private | no | main | 2026-08-02T12:43Z | 5245 | 1 |
| zai-independent-audit-2026-07-30 | public | no | main | 2026-07-30T12:44Z | 446 | 0 |
| zai-sap-reports-queue | public | no | main | 2026-07-29T19:00Z | 15 | 0 |
| infisuite-reverse-engineering | private | no | main | 2026-07-27T03:53Z | 29759 | 0 |
| odoo-reverse-engineering | private | no | main | 2026-07-20T17:48Z | 164 | 0 |
| zoho-reverse-engineering | private | no | main | 2026-07-20T17:33Z | 8 | 0 |
| veridian-ui-kit | public | no | master | 2026-07-20T09:42Z | 58 | 0 |
| veda-advisors | public | no | main | 2026-07-20T09:41Z | 33229 | 11 |
| global-revenue-engine | private | no | main | 2026-07-11T04:40Z | **0** | 0 |
| veridian-brain | private | no | main | 2026-07-09T18:20Z | 3 | 0 |
| sumeet-spec | private | no | main | 2026-07-09T15:19Z | 1 | 0 |

15 real repos exist under FChecklist as of this scan. `global-revenue-engine` is genuinely empty
(size 0, 0 branches confirmed below) — real orphan candidate, see §4.

**4 repo names referenced in this repo's own docs that do NOT resolve** (`gh repo view` →
"Could not resolve to a Repository"):
- `FChecklist/MeetTrack`, `FChecklist/meettrack-v2` — real repos per `PLATFORM_STRATEGY.md` §25
  (a static-prototype and a real Next.js+Supabase app respectively), explicitly slated there for
  deletion once their features were absorbed into `veriMeetings` (Wave 44). Non-resolution is
  consistent with that plan having already been executed — **not independently confirmed as the
  actual reason** (no deletion audit log/PR found citing it in this pass), flagged rather than
  assumed.
- `FChecklist/projexa-repo` — appears once in an older doc; likely a stale/typo reference to the
  real `FChecklist/projexa` repo (which does resolve). No evidence of a separate repo by this name
  ever existing.
- `FChecklist/VERIDIAN` — used narratively in governance docs (e.g.
  `ai-os/audit-tree/10-merged-tree.yaml:103`) to mean "the VERIDIAN platform" collectively, not a
  literal GitHub repo. `compliance-tracker` **is** the VERIDIAN AI application repo.

---

## 2. Repository Governance Register

| Repo | Branches | Open PRs | Merged PRs (capped 500) | Open-unmerged closed PRs | Secret scanning |
|---|---|---|---|---|---|
| compliance-tracker | 621 | 30 | 500+ (hit query cap) | 38 | **enabled, 0 open alerts** |
| claude-control | 88 | 10 | 107 | 7 | disabled |
| projexa | 43 | 3 | 60 | 6 | disabled |
| veridian-scripts | 11 | 7 | 9 | 2 | disabled |
| veridian-ai-os | 3 | 1 | 0 | 0 | disabled |
| zai-independent-audit-2026-07-30 | 1 | 0 | 0 | 0 | **enabled, 0 open alerts** |
| zai-sap-reports-queue | 1 | 0 | 0 | 0 | disabled |
| infisuite-reverse-engineering | 4 | 0 | 1 | 0 | disabled |
| odoo-reverse-engineering | 2 | 0 | 0 | 0 | disabled |
| zoho-reverse-engineering | 1 | 0 | 0 | 0 | disabled |
| veridian-ui-kit | 1 | 0 | 4 | 1 | disabled |
| veda-advisors | 16 | 11 | 4 | 1 | **enabled, 22 open alerts (see §8)** |
| global-revenue-engine | 0 | 0 | 0 | 0 | disabled |
| veridian-brain | 1 | 0 | 0 | 0 | disabled |
| sumeet-spec | 1 | 0 | 0 | 0 | disabled |

**Real governance gap**: 12 of 15 repos have GitHub secret scanning **disabled** (confirmed via
`404 "Secret scanning is disabled on this repository"` from the API, not inferred). Only
`compliance-tracker`, `zai-independent-audit-2026-07-30`, and `veda-advisors` have it on. A manual
current-HEAD-tree pattern grep (sk-ant-, sk-proj-, AKIA*, ghp_*, github_pat_, AIzaSy*, xox[baprs]-,
PEM private-key headers, embedded-password postgres URIs) across every locally-clonable one of
the 12 found no matches at HEAD — but this is a spot-check of the current tree only, **not** an
exhaustive history scan, so the correct read is "no live secret-scanning coverage exists on these
12 repos," not "these 12 repos are certified clean."

**`compliance-tracker` branch/PR volume is itself a governance signal**: 621 branches and 30 open
PRs on the primary app repo, of which **24 are `CONFLICTING`** (not just open) — see §3/§4.

---

## 3. Duplicate Resolution Report

- **`veda-advisors` PR #13 (`security/untrack-env-file`) and PR #14 (`fix/untrack-env`)** are real,
  independently opened, duplicate-intent PRs — both remove the same tracked `.env` file. Neither
  has merged; `origin/main` still tracks `.env` today (content is a placeholder
  `DATABASE_URL=file:/home/z/my-project/db/custom.db`, not a live credential — confirmed by direct
  read, see §8). Recommend closing one in favor of the other once reviewed; not done here
  (destructive/merge action out of this phase's scope).
- **`compliance-tracker` has a real cluster of near-duplicate "register OCID-0NN discovery" docs
  PRs** still open and unmerged: #785 (OCID-037), #787 (OCID-040), #789 (OCID-038/039/040), #796
  (OCID-045), #797 (OCID-043), #798 (OCID-044), #799 (OCID-041), #800 (OCID-042), #801 (OCID-046),
  #802 (OCID-041-045 confirmation) — 10 separate open PRs across a numerically adjacent OCID run,
  several explicitly self-describing as re-confirmations of each other (#802 says "OCID-041-045
  discovery workers healthy, PR 795 reviewed"). These are documentation-only branches (no src/
  changes per their own titles) that have not been reconciled into one canonical record. Real
  reconciliation (which of these is authoritative vs. superseded) was not performed here — flagged
  as the concrete input for whoever next does PR-backlog cleanup, not resolved unilaterally.
- **`veridian-ai-os` (a separate, private, 5.2MB repo)** contains its own parallel governance
  artifacts (`CONTROLLER.yaml`, `DIRECTIVE.yaml`, capability/database/function catalogs, crontab
  and worker-unit backups) that structurally mirror what `compliance-tracker`'s own `ai-os/`
  directory does for this repo. Whether this is intentional separation (server-control-plane state
  vs. app-repo governance docs) or accidental duplication of the same concern across two repos was
  **not adjudicated** in this pass — real, worth a dedicated follow-up, not assumed either way.

---

## 4. Orphan Resolution Report

- **`global-revenue-engine`**: confirmed genuinely empty — `size: 0`, 0 branches, no commits
  (`git grep` against it errors with "ambiguous argument HEAD: unknown revision"). Real orphan
  repo, no content to lose. Candidate for archival/deletion — **not actioned**, listed for Owner
  decision in §9.
- **24 of `compliance-tracker`'s 30 open PRs are `CONFLICTING`**, the oldest from
  `2026-08-03T06:01Z` (PR #778, ~22 hours stale at scan time) — real, live merge-conflict backlog,
  not resolved here (merging/rebasing is out of this discovery-only phase's scope).
- **Local task registry**: 1088 real task workspaces under `/opt/veridian/ai-os/tasks/`. Status
  breakdown from each task's own `task.yaml`: 521 `blocked`, 308 `completed`, 119 `superseded`, 46
  `failed`, 37 `pending_review`, 8 `rejected_duplicate`, 8 `cancelled`, 7
  `awaiting_human_approval`, 6 `in_progress`, 3 `not_needed`. **521 blocked tasks is the single
  largest bucket** — a real, large backlog of stalled work this pass did not triage individually
  (out of scope/budget for this discovery pass; flagged as the concrete number for a dedicated
  blocked-task-reconciliation effort).
- **Scheduled-job drift**: the retired crontab's own comment claims "the 18-unit systemd --user
  timer/service closed set" (2026-07-29 cron-consolidation, reconfirmed 2026-08-01). Live count
  today: **21 real `.timer` units**, all enabled (`timers.target.wants/`), and **29 `.service`
  files**. The "18" figure in the crontab comment is stale relative to the live count — not
  reconciled further here (which 3+ units were added after that note was written was not traced),
  flagged as a real doc-vs-live mismatch.

---

## 5. UMR Reconciliation Report

- `UMR-20260802-165606-4413` (OCID-020) and `UMR-20260802-173631-ca85` (OCID-021): both real and
  independently corroborated — cited across multiple independent artifacts
  (`ai-os/CONSTITUTION.yaml`, `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`,
  `ai-os/boss/ACTIVE-CLAIMS.yaml`, several merged PRs), not just this task's own prompt.
- `UMR-20260804-033853-2a17` (OCID-053, this task's stated immediate parent): found **only** in
  this task's own dispatch `prompt.txt` and in this session's own written artifacts
  (`PROGRESS.md`, `ACTIVE-CLAIMS.yaml`) — i.e. it is a real primary-source citation (the dispatch
  prompt is a genuine artifact) but **not yet independently corroborated by a second artifact**:
  no sibling task directory registers OCID-053, no other PR or doc in this workspace cites it.
  This is a materially different situation from OCID-012 (zero matches anywhere, including its own
  citing context) — OCID-053 is single-sourced, not absent — but flagging the distinction
  precisely rather than either treating it as fully independently confirmed or as fabricated.
- OCID-012: see §0. Zero matches anywhere, 3rd consecutive check with the same null result.

---

## 6. UTR Reconciliation Report

Per `ai-os/VERIDIAN_UMR_UTR_EUID_DISCOVERY_VS_LIVE_SYSTEM_2026-08-03.md` (existing, real,
independently produced discovery doc): **UTR = Universal Task Registry**, a proposed-but-not-yet-
built concept (discovery/analysis only, no schema/code exists for it as UTR). It was deliberately
renamed from the Owner's original "UTM" naming after that document found a real, live naming
collision with existing `utm_source`/`utm_medium`/`utm_campaign`/`utm_content`/`utm_term` columns
(a genuine, unrelated, pre-existing internal provenance-tagging convention, confirmed real and
intentionally left unchanged).

**Additional, third naming collision found this pass, not previously flagged**: in Indian banking
terminology, "UTR" commonly means "Unique Transaction Reference" (a real bank-transfer reference
number) — and this codebase already has exactly that usage: `cost_payments.referenceNumber`'s own
column comment reads `// transaction ref / cheque number / UTR` (confirmed via
`git grep -n '\butr\b'`, matches the prior doc's own §0a amendment which found this same line but
did not name the banking-term collision explicitly). Net: "UTR" now has **three** real, distinct
meanings live or proposed in this codebase context (Universal Task Registry [proposed], a bank
transfer reference in payment records [real, existing data], and — per the prior doc's own
finding — no actual code identifier collision, since the payment-record usage is a free-text
comment, not a column/variable name). No code or schema change needed; noting for whoever next
touches UTR naming so this isn't rediscovered from scratch.

---

## 7. Repository Dependency Report

Real, observed relationships (not inferred from names alone):

- **`compliance-tracker`** is the real VERIDIAN AI application (Next.js/Drizzle/Supabase) and the
  primary governance-document host (`ai-os/`) referenced throughout this platform's own docs.
- **`projexa`** is a separate real Next.js+Supabase app; `projexa-ai.com` (the live domain) is
  confirmed (per this session's memory of prior work, re-stated not re-verified live here) to
  actually serve `compliance-tracker`'s own build in production, not `projexa`'s — i.e. a real,
  known domain/repo mismatch already tracked elsewhere in `ai-os/MASTER-TRACKER.yaml`, not
  rediscovered here.
- **`veda-advisors`** is a separate, standalone real Next.js+Supabase app/site with its own
  Supabase project, no dependency on `compliance-tracker`'s code observed.
- **`veridian-scripts`** is confirmed (via its own open PR titles, e.g.
  `fix/sync-repos-cover-veridian-ai-os`) to be operational tooling that syncs/governs the other
  repos from the server side (`resource_governor.py`-class scripts referenced in
  `ai-os/VERIDIAN_UMR_UTR_EUID_DISCOVERY_VS_LIVE_SYSTEM_2026-08-03.md` live here) — a real
  cross-repo dependency: this repo's own health depends on `veridian-scripts` running correctly.
- **`veridian-ai-os`** holds server/control-plane state (worker-unit backups, capability/database/
  function catalogs, crontab snapshots) that describes and constrains how work gets dispatched
  into `compliance-tracker` (and presumably the other product repos) — a real, one-directional
  dependency (control-plane → product repos), not the reverse.
- **`zai-sap-reports-queue`** is confirmed to be exactly what its name says: a literal task queue
  (`tasks/1-lead-source-effectiveness.md` … `tasks/6-cash-flow-forecast.md`, plus a `README.md`,
  nothing else) — a real, minimal, standalone work-item queue, not a code dependency of any other
  repo.
- **`infisuite-reverse-engineering`, `odoo-reverse-engineering`, `zoho-reverse-engineering`**: real
  research repos (per their names and the platform's own stated practice of studying comparable
  products before building competing features) — no evidence found this pass that any of the
  three's content is imported into `compliance-tracker` as a code dependency (research-only
  relationship).
- **`veridian-ui-kit`, `veridian-brain`, `sumeet-spec`, `zai-independent-audit-2026-07-30`,
  `claude-control`, `global-revenue-engine`**: no cross-repo code dependency evidence found this
  pass; `claude-control` is confirmed (from its own open PR titles: watchdog, DSPy, LiteRT,
  interactive-session write gates) to be the orchestration/control tooling repo for AI agent
  supervision generally, separate from `veridian-ai-os`'s state-storage role — the two appear to
  be different real concerns (control logic vs. control-plane data), not yet reconciled against
  each other in this pass (see §3's flagged-not-adjudicated overlap question).

---

## 8. Platform Security Report — real exposed-credential scan

**Method**: (a) GitHub's own secret-scanning alerts API, queried live for all 15 repos; (b) manual
regex pattern grep (sk-ant-, sk-proj-, AKIA*, ghp_*, github_pat_, AIzaSy*, xox[baprs]-, PEM
private-key headers, embedded-password postgres/postgresql URIs) against the current HEAD tree of
every locally-clonable repo (13 of 15; `veridian-ai-os` and `zai-sap-reports-queue` were shallow-
cloned fresh for this check since no local copy existed).

### Finding: real, live, unresolved exposed credentials — `veda-advisors`

GitHub secret scanning reports **22 open, unresolved alerts**, all `secret_type: google_api_key`,
all `publicly_leaked: true`, all `state: open`, all in the same single file:
`tool-results/read_1782309955766_3e29539f7948.txt` (an accidentally-committed AI-tool session
output file). One retrieved directly via the API to confirm the finding is real, not a scanner
false-positive:

```
secret: AIzaSyDU****************************CEA  [value redacted 2026-08-05, before this file was
  ever committed to this branch's history -- pasting a real, live, already-publicly-leaked
  secret's raw value into a SECOND repo's tracked documentation (and git history) duplicates its
  exposure surface instead of just describing the finding; an earlier draft of this same fix
  redacted the value only at the file tip while the raw value remained reachable via an ancestor
  commit's history, which this repo's own GitHub secret-scanning correctly still flagged as open
  (alert #1, github.com/FChecklist/compliance-tracker/security/secret-scanning/1) -- this version
  never contains the raw value in any commit. The finding itself (that a real, live, unresolved
  credential exists in veda-advisors) is unchanged by this redaction -- it is independently
  re-verifiable at any time via `gh api repos/FChecklist/veda-advisors/secret-scanning/alerts/22`.]
secret_type: google_api_key
publicly_leaked: true
state: open
first commit: 124fa307b95c3b880586a4a5bf5d60b66845aae9 / f7d2af1 (repo's own Initial commit)
```

The file is **not** present in `origin/main`'s current tree (confirmed via `git ls-tree`) — it was
removed from HEAD at some point — but it remains reachable in git **history** on a **public**
repository, which is exactly why GitHub's scanner still reports these as `open`/unresolved:
removing a file from HEAD does not purge it from history, and the repo's public visibility means
that history is fetchable by anyone right now. **No rotation or history rewrite has been
performed this phase** — withheld per the PM's explicit instruction. This is the concrete,
real finding that needs the Owner's fresh decision (§9).

### Finding: `veda-advisors` still tracks a `.env` file on `main`

Confirmed via `git show origin/main:.env`: content is
`DATABASE_URL=file:/home/z/my-project/db/custom.db` — a local-sqlite placeholder, **not** a live
credential. Two open, unmerged PRs (#13, #14 — see §3) already propose untracking it; neither has
merged, so it remains tracked on `main` today. Low severity (no real secret value), but a real,
currently-live governance gap (tracked env file + duplicate open PRs to fix it, neither landed).

### Clean results

- `compliance-tracker`: secret scanning enabled, **0 open alerts**.
- `zai-independent-audit-2026-07-30`: secret scanning enabled, **0 open alerts**.
- Manual HEAD-tree pattern grep across `claude-control`, `projexa`, `veridian-scripts`,
  `infisuite-reverse-engineering`, `odoo-reverse-engineering`, `zoho-reverse-engineering`,
  `veridian-ui-kit`, `veridian-brain`, `sumeet-spec`, `veridian-ai-os`, `zai-sap-reports-queue`:
  **no real secret matches** — all hits were placeholder values (`postgres:placeholder@...`,
  `postgres.${ref}:${dbPassword}@...` template code, a doc line instructing a human to paste an
  `sk-ant-...` key into GitHub Secrets rather than containing one). `global-revenue-engine` has no
  commits to scan.
- No `.env`/`.env.local` files found committed in any repo's current HEAD tree except
  `veda-advisors` (above).

### Explicit limitation

12 of 15 repos have GitHub secret scanning **disabled** (§2) — the manual HEAD-tree grep above is
the only coverage those repos have, and it does not cover their full commit history the way
`veda-advisors`' GitHub-scanner-driven finding does. This is a real, current gap in security
coverage, not just a reporting limitation — recommend enabling secret scanning on all 15 repos as
a real, non-destructive, low-risk follow-up (does not require this phase's withheld
credential-rotation/deletion authorization).

---

## 9. Items requiring an explicit, real-time Owner decision

Per the PM's explicit withholding of authorization this phase, presenting rather than acting on:

**Exposed credentials found:**
1. 22 real Google API keys, `publicly_leaked: true`, in `veda-advisors` git history (file already
   removed from `main`'s HEAD, but reachable via history on this public repo). Recommend: rotate
   the Google API key(s) at the source (Google Cloud Console), then a real history purge
   (`git filter-repo` or GitHub's own removal tooling) — **not performed, awaiting Owner decision.**

**Repositories with a real orphan/retirement signal (not actioned):**
2. `global-revenue-engine` — empty (0 branches, 0 size, no commits). Candidate for deletion.
3. `FChecklist/MeetTrack`, `FChecklist/meettrack-v2` — already non-resolving; if not already
   deleted, no further action needed; if this non-resolution means something else (renamed,
   transferred), that was not distinguished in this pass and would need direct confirmation.

**Not credential/deletion actions, but real cleanup this pass did not perform** (governance/PR
hygiene, safe to action without the withheld authorization once someone picks them up):
4. Close one of `veda-advisors` PR #13/#14 (duplicate `.env`-untrack PRs) and merge the other.
5. Enable GitHub secret scanning on the 12 repos that currently lack it.
6. Triage `compliance-tracker`'s 24 `CONFLICTING` open PRs and the 10-PR OCID-04x docs cluster
   (§3/§4).
7. Reconcile the 521 `blocked` local task workspaces (§4) — largest single bucket, not triaged
   individually here.
