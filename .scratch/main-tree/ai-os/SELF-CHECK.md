# Mid-Session Self-Check

Gap closure, 2026-07-13 (GAP-UNIFIED-SOT-REMAINDER slice (c), Phase 1 of 3):
`PLATFORM_STRATEGY.md` §31.1 row 1 named the residual honestly -- `CLAUDE.md`
is auto-injected once at the start of every interactive session, and
`ai-workforce-agent.mjs`'s `fetchGovernancePreamble()` (PR #250) does the
same once per headless dispatch, but nothing re-affirms a standing rule
**mid-session**, after new work has merged and the session's own working
context has drifted from what it started with. This file is the fixed
checklist that closure points at. It is deliberately short -- five
questions, meant to be silently re-affirmed in a few seconds, not read as
a document.

Cadence and enforcement are defined in
`VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`'s "Mid-Session Self-Check"
section (placed near §7 Mandatory Monitoring / Loop Prevention). Read that
section for the honest, per-path breakdown of what is and isn't
code-enforced -- summarized here: the headless z.ai/OpenRouter dispatch
path (`ai-workforce-agent.mjs`) re-injects this file's content on a real
cadence via `shouldPromptSelfCheck()` (`src/lib/loop-prevention.ts`); the
interactive Claude Code/Desktop path has no equivalent hook (no
`.claude/settings.json` periodic-reminder slot exists in this repo) and
this file exists there only as something a session can voluntarily
re-read.

## The five questions

1. **Scope drift** -- does the current objective still match the original
   TightTask/instruction brief, or has scope silently expanded or shifted
   to something the brief didn't ask for?
2. **Guardrail bypass** -- has any guardrail named in
   `scripts/check-guardrail-presence.mjs`'s manifest been removed,
   weakened, or routed around without an explicit, quoted Owner sign-off
   (AGENTS.md Operating Rule 9)?
3. **Stale reliance** -- is the last handover/audit verdict this session is
   relying on still accurate, or has something changed (a merge, a fix, a
   reverted decision) since it was written?
4. **DO-NOT-TOUCH paths** -- is this session about to touch
   `.claude/`, `CLAUDE.md`, `AGENTS.md`, `SENTINEL.md`, or `ai-os/` without
   quoted Owner authorization for that specific edit?
5. **Real ambiguity** -- is there genuine ambiguity here that should be
   escalated or asked about, rather than silently guessed through?

## What this file is not

Not a gate. Not itself enforced against an interactive session -- see the
honest limitation above. Not a replacement for `CLAUDE.md`'s "Read Before
Starting Work" list (that is read-once-at-start context; this is a
periodic re-affirmation prompt). Not a new guardrail registered in
`scripts/check-guardrail-presence.mjs`'s manifest -- it has no code-level
mechanism to check compliance against on the interactive path, so
registering it there would overclaim what it does.
