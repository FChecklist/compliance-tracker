-- Priority 12 (OPEN-07 decision a, Owner directive 2026-07-14): capability-
-- audit's escalation dispatch moved from dispatch-repo.ts's repository_dispatch
-- (PAT-gated, never configured) to the advisory-only runRole() path
-- (advisory-dispatch-service.ts). That path never opens a PR by itself --
-- its real output is the model's advisory text -- so this column persists
-- it as the queryable artifact a human can review, where before
-- dispatchProposalToHigherAI() discarded the response after only recording
-- a bare 'dispatched' status flag.
alter table compliance.capability_improvement_proposals add column if not exists dispatch_output text;
