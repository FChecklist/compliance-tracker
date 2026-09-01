# Architecture Decision Records (ADR)

This folder captures significant architectural decisions in this codebase
alongside their first-principles rationale -- not just *what* was decided,
but *why*, reasoned from the actual constraints (multi-tenant isolation,
cost, auditability, the realistic failure modes of an AI-heavy codebase)
rather than from convention or convenience.

## Why this folder exists

Created 2026-08-15 in response to the VERIDIAN Review Framework's
Architecture & Design / Engineering Principles finding "First-Principles
Design Methodology": the review found real evidence of first-principles
thinking in this codebase (e.g. the centralized AI-call-site pattern, the
multi-tenant RLS-by-default posture, the `withTenantContext` wrapper), but
noted it could only be *inferred* from consistent patterns across the code
-- there was nowhere a reviewer (human or AI) could go to read the
reasoning directly. This folder is that place, going forward.

## Format

Each ADR is a short, numbered markdown file: `NNNN-short-title.md`.
Minimum content:
- **Context** -- the actual constraint or problem, stated plainly.
- **Decision** -- what was decided.
- **First-principles rationale** -- why, reasoned from the constraint, not
  "because that's how framework X does it."
- **Consequences** -- what this makes easier, what it makes harder, what
  it explicitly does not solve.

This folder does not retroactively document every past decision in the
codebase -- it starts now, with the decisions made in the PR that created
it, and grows as future decisions are made. It is not a substitute for
`ai-os/CONSTITUTION.yaml` (the governance rules) or `AGENTS.md` (agent
authority/process) -- it is for engineering/architecture decisions
specifically, the "why did we build it this way" record those two don't
carry.
