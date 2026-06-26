# ADR-0003: AI Sentinel Governance System

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-06-26 |
| Confidence | High |
| Decider | Sentinel + Repository Owner |

## Context
AI-assisted development introduces risks: hallucinated APIs, undocumented changes, architectural drift, security regressions, deployment errors. A systematic governance layer is required.

## Decision
Install AI Sentinel as permanent governance across all FChecklist repositories, bound by SENTINEL.md at the root of each repository.

## Reason
- Verifies all references before use (prevents hallucinations)
- Requires documentation updates with every code change
- Enforces explicit human approval gates for all high-risk actions
- Provides audit trail via ADRs, changelog, and health reports

## Alternatives Considered
| Alternative | Reason Rejected |
|-------------|-----------------|
| No governance layer | High hallucination risk, undocumented drift |
| Manual code review only | Insufficient volume control for AI-generated code |

## Consequences
Positive: Systematic quality control, full decision history, clear escalation paths.
Negative: Additional overhead per AI task.

## References
- SENTINEL.md
- /docs/governance/
