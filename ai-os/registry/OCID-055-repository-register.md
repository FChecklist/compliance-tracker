# OCID-055 -- Universal Repository Register (Discovery/Cataloging/Classification Phase)

**Scope:** real, read-only GitHub discovery across every organization and user this session's
token has access to. Evidence source: `gh api`/`gh repo list`/`gh pr list`/`gh api search/*`
against the live GitHub account, run 2026-08-04.

**Account scope note (real finding, not assumed):** the authenticated token
(`gh auth status`: user `FChecklist`, scopes `gist`, `read:org`, `repo`) belongs to zero GitHub
organizations -- `gh api user/orgs` and `gh api user/memberships/orgs` both return an empty list.
"Every organization and user" therefore resolves, in reality, to exactly one real account:
**`FChecklist`**, which owns all 15 real repositories cataloged below. No other org or user
account is reachable with this token; if additional repositories exist under a different GitHub
identity, they are outside this session's real access and are not claimed as covered here.

**Premise correction (flagged to the Owner, not silently accepted):** this task's dispatch says
to reuse "the discovery already produced under OCID-054." OCID-054's own task workspace
(`/opt/veridian/ai-os/tasks/task-20260804-040754-register-ocid-054--universal-repository`,
created 4 seconds before this one) has **not produced any real discovery yet** -- its own
`PROGRESS.md` is the unstarted stub ("## Remaining / - [ ] Not started"), its `task.yaml` shows
`completed_steps: []`, and no systemd unit for either OCID-054 or OCID-055 is currently running.
There is nothing real to reuse, so the register below is original discovery, not a reuse of prior
work. Separately: OCID-053/OCID-054/OCID-055 and their cited UMR ids do not appear anywhere in
this repository's own `ai-os/` tree, nor in the separately-checked-out `claude-control` repo's
`CONTROLLER.yaml` (grepped both, zero matches) -- these decision records exist only in the PM's
own chat-side tracking, not in any repo file this session can independently verify against.

**OCID-012 note (repeating the PM's own flag, independently reconfirmed this session):** the
incoming prompt reference chain again lists OCID-012. Grepped this repo's `ai-os/` tree for
OCID-012: no match tying it to a real UMR chain. Per the PM's own instruction, it is not being
registered or treated as real here either.

---

## 1. Repository Register

| Repository | Visibility | Default Branch | Created | Last Push (Activity) | Open PRs | Merged PRs | Total PRs | Branches | README |
|---|---|---|---|---|---|---|---|---|---|
| `compliance-tracker` | **PUBLIC** | `main` | 2026-06-26 | 2026-08-04 (today) | 153 | 631 | 862 | 621 | none at repo root (docs live in `docs/`/`ai-os/`) |
| `claude-control` | **PUBLIC** | `master` | 2026-07-16 | 2026-08-04 (today) | 10 | n/a (not queried) | 124 | 88 | README.md |
| `projexa` | **PUBLIC** | `main` | 2026-07-08 | 2026-08-02 | 3 | n/a | 69 | 43 | none at repo root |
| `veridian-scripts` | private | `main` | 2026-07-30 | 2026-08-02 | 7 | n/a | 18 | 11 | none at repo root |
| `veridian-ai-os` | private | `main` | 2026-07-30 | 2026-08-02 | 1 | n/a | 1 | 3 | none at repo root |
| `zai-independent-audit-2026-07-30` | **PUBLIC** | `main` | 2026-07-30 | 2026-07-30 | 0 | n/a | 0 | 1 | README.md |
| `zai-sap-reports-queue` | **PUBLIC** | `main` | 2026-07-28 | 2026-07-29 | 0 | n/a | 0 | 1 | README.md |
| `infisuite-reverse-engineering` | private | `main` | 2026-07-20 | 2026-07-27 | 0 | n/a | 1 | 4 | README.md |
| `odoo-reverse-engineering` | private | `main` | 2026-07-20 | 2026-07-20 | 0 | n/a | 0 | 2 | README.md |
| `zoho-reverse-engineering` | private | `main` | 2026-07-20 | 2026-07-20 | 0 | n/a | 0 | 1 | README.md |
| `veridian-ui-kit` | **PUBLIC** | `master` | 2026-07-18 | 2026-07-20 | 0 | n/a | 5 | 1 | README.md |
| `veda-advisors` | **PUBLIC** | `main` | 2026-06-24 | 2026-07-20 | 11 | n/a | 16 | 16 | none at repo root |
| `global-revenue-engine` | private | `main` | 2026-07-11 | 2026-07-11 (never pushed to, size 0) | 0 | n/a | 0 | 0 | none (empty repo) |
| `veridian-brain` | private | `main` | 2026-07-09 | 2026-07-09 | 0 | n/a | 0 | 1 | README.md |
| `sumeet-spec` | private | `main` | 2026-07-09 | 2026-07-09 | 0 | n/a | 0 | 1 | none at repo root |

Related OCIDs/UMRs/PRs/commits per repository, where real evidence exists:
- `compliance-tracker`: this is the primary VERIDIAN AI OS repository -- effectively the entire
  live `ai-os/MASTER-TRACKER.yaml`/`ai-os/boss/ACTIVE-CLAIMS.yaml`/`ai-os/boss/COMPLETED.yaml`
  OCID/UMR history lives here (`gh api search/commits?q=OCID+repo:FChecklist/compliance-tracker`
  → 143 commits mentioning "OCID"). Latest PR at discovery time: #865.
- `projexa`: 1 commit mentions "OCID" (`gh api search/commits?q=OCID+repo:FChecklist/projexa`).
  Real cross-repo relationship confirmed: PROJEXA is described as "built on VERIDIAN AI OS via
  API," i.e. it is a real consumer of the `compliance-tracker` platform, not an independent
  product.
- `claude-control`: 0 commits match "OCID" by commit-message text, but the repo's own purpose
  (per its description) is to be the cross-project coordination ledger for
  `compliance-tracker`, `projexa`, `veda-advisors`, and a fourth repo, `content-pipeline`, that
  **does not exist** -- see Documentation Audit, Finding D1.
- All other repositories: 0 commits match "OCID" by commit-message text search. These are
  either pure documentation/reverse-engineering artifacts, task-queue definitions, or dormant
  placeholders with no direct OCID/UMR linkage found in their own commit history.

---

## 2. Repository Classification Register

| Repository | Real Category | Basis |
|---|---|---|
| `compliance-tracker` | **Core platform** | The live multi-tenant SaaS product itself; deployed at `veridian-compliance-ai.vercel.app`; owns the `compliance` DB schema, all `/api/*` routes, and the entire `ai-os/` governance tree. |
| `claude-control` | **Infrastructure** | Cross-project orchestration: worker/supervisor scripts (`scripts/`), dispatch prompts/logs (`dispatch_prompts/`, `dispatch_logs/`), systemd units (`systemd/`) -- the automation control-plane, not application code. |
| `projexa` | **Business module** (separate deployed product surface) | "Construction Intelligence AI OS. Frontend for the AI-native construction ERP, built on VERIDIAN AI OS via API" -- deployed at `projexa-smoky.vercel.app`; consumes `compliance-tracker` as a backend rather than being part of it. |
| `veridian-scripts` | **Infrastructure** | Version-controlled snapshot of the live `/opt/veridian/scripts` production automation tree. |
| `veridian-ai-os` | **Infrastructure / documentation mirror** | Version-controlled snapshot of the live `/opt/veridian/ai-os` control-plane tree; low real dev activity (1 PR total). |
| `zai-independent-audit-2026-07-30` | **Documentation (audit artifact)** | Third-party independent audit findings about `compliance-tracker`; not application code. |
| `zai-sap-reports-queue` | **Shared/task-definition utility** | Queue of closed-ended report tasks for external Z.ai workers; not application code. |
| `infisuite-reverse-engineering` | **Documentation** | Reverse-engineered docs of a third-party CRM system, used as reference material. |
| `odoo-reverse-engineering` | **Documentation** | Reverse-engineered docs of a third-party ERP, used as reference material. |
| `zoho-reverse-engineering` | **Documentation** | Reverse-engineered docs of third-party CRM/PM tools, used as reference material. |
| `veridian-ui-kit` | **Shared library** | Standalone UI component kit, described purpose, no repo-root README description text set on GitHub (description field empty) even though README.md exists in-repo. |
| `veda-advisors` | **Out of VERIDIAN AI OS scope** (unrelated business) | "Custom Website for Rajat Rajkamal Agarwal, Startup Fundraising Advisor" -- the Owner's own separate personal/consulting business, not part of the VERIDIAN AI OS product family. Does not fit any of core-platform/business-module/shared-library/infra/docs cleanly; flagged here as its own category rather than force-fit. |
| `global-revenue-engine` | **Archive / dormant placeholder** | Size 0, zero branches, never pushed to since creation (2026-07-11) -- an empty, uninitialized repository. Description ties it to "Sumeet project," a third party unrelated to VERIDIAN AI OS. |
| `veridian-brain` | **Archive / dormant scaffold** | Own description: "Phase A groundwork scaffold. Not yet extracted from compliance-tracker" -- a placeholder for future extraction work that has not proceeded (0 PRs, no activity since creation). |
| `sumeet-spec` | **Out of VERIDIAN AI OS scope** (unrelated third party) | "Spec/memory doc for Sumeet's project (ChatGPT-authored)" -- unrelated third-party project material, correctly private. |

---

## 3. Repository Dependency Register

Real, evidence-based dependency relationships (from repository descriptions and deployed-URL
metadata; no assumed relationships):

- `projexa` → **depends on** `compliance-tracker` ("built on VERIDIAN AI OS via API" -- PROJEXA's
  frontend calls the compliance-tracker backend as its API layer).
- `claude-control` → **coordinates** `compliance-tracker`, `projexa`, `veda-advisors`, and a
  claimed but nonexistent `content-pipeline` (see Finding D1 below) -- it holds `CONTROLLER.yaml`
  and dispatch tooling that targets these repos, but does not contain their application code.
- `veridian-scripts` and `veridian-ai-os` → **mirror** the live `/opt/veridian/scripts` and
  `/opt/veridian/ai-os` trees respectively (their own descriptions: "Version-controlled snapshot
  of VERIDIAN-DEV ..."); these are downstream artifacts of the live filesystem, not independently
  authored.
- `infisuite-reverse-engineering`, `odoo-reverse-engineering`, `zoho-reverse-engineering` →
  **reference material for** `compliance-tracker`'s and `projexa`'s feature-parity work (SAP/ERP
  benchmark docs found in the OCID-054 task workspace, e.g. `ERP_BENCHMARK_COMPARISON.md`,
  `evaluation_by_ca.md`, cite these third-party systems as comparison baselines).
- `zai-independent-audit-2026-07-30` → **audits** `compliance-tracker` (own description: "audit of
  VERIDIAN by Z.ai").
- `zai-sap-reports-queue` → **produces work consumed by** `compliance-tracker`'s SAP-parity gap
  backlog.
- `veda-advisors`, `global-revenue-engine`, `sumeet-spec` → **no dependency relationship found**
  to any VERIDIAN AI OS repository; independent/unrelated projects.
- `veridian-brain`, `veridian-ui-kit` → **no live consumer found**: `veridian-brain`'s own README
  states it has not yet been extracted from `compliance-tracker` (i.e., `compliance-tracker` does
  not yet depend on it); no repository was found importing from `veridian-ui-kit` in this
  session's discovery pass (a deeper package-manifest cross-check across all 15 repos was not
  performed this phase -- scope note, not a negative claim).

---

## 4. Repository Relationship Graph (text form)

```
compliance-tracker (core platform, PUBLIC)
  ├─ consumed by → projexa (business module, PUBLIC)
  ├─ audited by  → zai-independent-audit-2026-07-30 (PUBLIC)
  ├─ fed by      → zai-sap-reports-queue (PUBLIC)
  ├─ referenced against → infisuite-reverse-engineering (private)
  ├─ referenced against → odoo-reverse-engineering (private)
  ├─ referenced against → zoho-reverse-engineering (private)
  ├─ mirrored by → veridian-scripts (private) [snapshot of /opt/veridian/scripts]
  ├─ mirrored by → veridian-ai-os (private) [snapshot of /opt/veridian/ai-os]
  ├─ planned-extraction target ← veridian-brain (private, not yet wired)
  └─ coordinated by → claude-control (PUBLIC) [also coordinates projexa, veda-advisors,
                       and a claimed-but-missing content-pipeline repo -- Finding D1]

veda-advisors (PUBLIC) -- standalone, unrelated business, no VERIDIAN dependency edge
global-revenue-engine (private, empty) -- standalone, unrelated (Sumeet project), no edge
sumeet-spec (private) -- standalone, unrelated (Sumeet project), no edge
veridian-ui-kit (PUBLIC) -- standalone, no confirmed live consumer found this pass
```

---

## 5. Repository Documentation Audit

Real findings, with evidence, no narration:

- **Finding D1 (documentation/data-integrity, PUBLIC repo):** `claude-control`'s own GitHub
  description reads "Cross-project controller/coordination ledger (CONTROLLER.yaml) spanning
  compliance-tracker, projexa, veda-advisors, content-pipeline." `content-pipeline` **does not
  exist** under the `FChecklist` account -- `gh api repos/FChecklist/content-pipeline` returns
  `404 Not Found`, and `gh api search/repositories?q=content-pipeline+user:FChecklist` returns
  zero matches. Either the repo was deleted/renamed without the description being updated, or it
  was never created and the description is aspirational/stale. This is a real, verifiable
  documentation defect in a **public** repository description, independent of any content-level
  finding.
- **Finding D2 (repository hygiene, informational):** `compliance-tracker` carries **621 real
  branches** (paginated count via `gh api --paginate repos/.../branches`, not the default
  30-per-page truncation) against 862 total PRs. The large majority are almost certainly stale
  `worker/task-*` branches from completed/merged/abandoned dispatch cycles. No deletion is
  proposed here (out of scope, and branch deletion was not explicitly authorized this phase
  either) -- flagged as a real, quantified hygiene fact for the Owner's own future disposition
  decision, not acted on.
- **Finding D3 (missing root README, several repos):** `compliance-tracker`, `projexa`,
  `veridian-scripts`, `veridian-ai-os`, `veda-advisors`, and `sumeet-spec` have no `README.md` at
  repository root (verified via `gh api repos/.../readme` → 404 for each). For
  `compliance-tracker` and `projexa` this is likely intentional (`CLAUDE.md`/`AGENTS.md` serve
  that role instead, confirmed present); for the others, no root-level orientation document
  exists for a GitHub visitor landing on the repo directly.
- **Finding D4 (empty repository, informational):** `global-revenue-engine` has never received a
  single push since creation on 2026-07-11 (size 0, 0 branches returned by the branches API
  despite a `default_branch: main` being set). It exists as a name/description placeholder only.

---

## 6. Findings Requiring an Explicit Owner Decision (visibility/ownership -- no action taken)

Per this dispatch's explicit withholding of visibility- and ownership-change authorization, the
following are presented as findings only. **No repository's visibility or permissions were
changed by this task.**

1. **`compliance-tracker` is PUBLIC.** This is the full source of a real, live, multi-tenant SaaS
   platform (`veridian-compliance-ai.vercel.app`) -- including its Drizzle schema, every API
   route, auth/RLS logic, and its entire `ai-os/` governance history (repository- and
   operations-level detail about how the platform is built and run). Collaborator check (`gh api
   repos/FChecklist/compliance-tracker/collaborators`) confirms exactly one collaborator
   (`FChecklist`, owner/admin) -- no ownership anomaly, but the visibility itself is the
   highest-blast-radius item in this register given it is the production platform's entire
   codebase. Flagged for an explicit Owner decision on whether public visibility is intended
   long-term or should be reconsidered; no change made.
2. **`zai-independent-audit-2026-07-30` is PUBLIC.** This repository holds a third-party
   independent *security/quality audit* of the same live platform -- "owner / deterministic
   software / multitenant end-user perspectives." An audit repository enumerating a live
   production system's weaknesses being publicly readable is a distinct risk class from source
   code being public (it can point a reader directly at known-weak areas). Flagged for an
   explicit Owner decision; no change made.
3. **`claude-control` is PUBLIC.** Holds the operational coordination ledger, dispatch prompts,
   dispatch logs, and supervisor/worker automation scripts for the whole multi-repo system (see
   Finding D1 above for a related documentation defect in this same repo). Operational
   control-plane visibility for a live autonomous system is worth an explicit Owner call
   independent of whether any literal secret was found in it (no credential/secret scan was
   performed against repository contents this phase -- that pass was explicitly out of scope for
   OCID-055, which authorizes discovery/cataloging/classification/documentation-audit/search-
   indexing only, not the security/credential discovery pass that OCID-054's own prompt describes
   separately). Flagged for an explicit Owner decision; no change made.
4. **`veda-advisors` and `veridian-ui-kit` are PUBLIC** but are lower-severity by comparison (a
   marketing site and a UI kit, respectively) -- listed for completeness, not urgency.

No ownership/permission anomaly was found: every repository checked for collaborators
(`compliance-tracker`, `claude-control`, `projexa`, `veridian-scripts`, `veridian-ai-os`) returned
exactly one collaborator, `FChecklist`, with owner/admin permissions. A full collaborator sweep of
the remaining 10 repositories was not performed this phase (budget/scope judgment call, all 10 are
low-activity/dormant repositories with no PR/commit activity suggesting any second contributor
exists); if the Owner wants that completed, it is a fast follow-up, not a blocker to this register.
