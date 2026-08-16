# Source requirement documents

Every `.docx` file the Owner has provided as an instruction/requirement source for VERIDIAN AI OS, collated here from where they were scattered across the local `Downloads` folder. Originals remain in `Downloads` too (not deleted) — these are working copies so the actual source text lives inside the repo, next to the analysis that derives from it.

## The 9 official source documents (`./`)

These are the current, authoritative requirement set — the ones `ai-os/audit-tree/01-consutitution.yaml` through `09-...yaml` are faithful, full-fidelity transcriptions of (every atomic item, no gap-checking), which `ai-os/audit-tree/10-merged-tree.yaml` then deduplicates and reorganizes by domain (149 sub-branches, 98.7% source traceability). See `ai-os/audit-tree/00-INDEX.md` for the full status.

| # | File | Transcribed in | Atomic items |
|---|---|---|---|
| 1 | `Consutitution.docx` (AI Governance & Continuous Improvement Framework — filename typo is the Owner's own original) | `01-consutitution.yaml` | 322 |
| 2 | `Audit Organization.docx` | `02-audit-organization.yaml` | 168 |
| 3 | `Dynamic Mode Pills and Dynamic Option Selection.docx` | `03-dynamic-mode-pills.yaml` | 101 |
| 4 | `VERI AI and VERI Chat.docx` | `04-veri-chat.yaml` | 78 |
| 5 | `Work requirement.docx` (Work Governance & Intelligent Execution Framework) | `05-work-requirement.yaml` | 79 |
| 6 | `Connectors.docx` | `06-connectors.yaml` | 42 |
| 7 | `Requirement.docx` (registration/licensing/adoption dashboard) | `07-requirement-licensing-adoption.yaml` | 22 |
| 8 | `Task.docx` (per-task validation + Response Engine) | `08-task.yaml` | 47 |
| 9 | `VERIDIAN AI is no longer a compliance tool.docx` (onboarding/UX) | `09-...yaml` | 26 |

These 9 documents' requirements were reconciled against the actual codebase across Priorities 1 and 2 (see `ai-os/MASTER-TRACKER.yaml` for what's closed vs. still open — do not re-derive gap status from these `.docx` files directly, the tree + tracker are the current source of truth for "what's done").

## Earlier drafts / superseded documents (`earlier-drafts/`)

Real documents the Owner also provided, but not part of the current 9-document audit set — kept for history/context, not actively transcribed against:

- `VERIDIAN.docx` (2026-07-09) — the original constitution-study trigger document. Its analysis lives in `Study_by_Claude.md` and `Study_by_zaizlm5.2.md` at the repo root (not moved here — `AGENTS.md` Rule 7 references them at that exact path).
- `VERIDIAN_AI_OS_Master_Constitution_v1.docx` (2026-07-03) — an earlier standalone constitution draft, predating the current `VERIDIAN_*_CONSTITUTION.md` documents at the repo root (`VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`, `VERIDIAN_AUDIT_ORGANIZATION.md`, `VERIDIAN_DMP_DCF_CONSTITUTION.md`, `VERI_CHAT_GOVERNANCE.md`), which supersede it.
- `ComplianceTrack_TechSpec_v1.docx` (2026-06-18) / `ComplianceTrack_TechSpec_Complete.docx` (2026-06-25) — the original product tech spec, predating this whole governance/audit-tree effort. The live codebase is the current source of truth for what compliance-tracker actually does; these are historical.
- `Business Requirement Document.docx` (2026-04-21) — the earliest document in this whole set, predating the project's AI-OS governance work entirely.

## Where the derived analysis lives (not duplicated here)

- `ai-os/audit-tree/` — the 9 per-document transcriptions + `10-merged-tree.yaml` (the current authoritative merged requirement tree) + 2 audit rounds.
- `ai-os/MASTER-TRACKER.yaml` — the single current source of truth for what's open/closed/ratified across all of this (see that file, not this README, for status).
- `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`, `VERIDIAN_AUDIT_ORGANIZATION.md`, `VERIDIAN_DMP_DCF_CONSTITUTION.md`, `VERI_CHAT_GOVERNANCE.md` (repo root) — the constitutional documents derived from these source docs, stating what's `[ENFORCED]` vs `[NOT APPLICABLE YET]` in real code today.
