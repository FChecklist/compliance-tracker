# PROGRESS -- task-20260726-043023-phase4-defense-in-depth-prompt-security

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS, phase plan, gap analysis) and registered ACTIVE-CLAIMS entry
- [x] Confirmed real tool compatibility (WebFetch on Groq docs + live venv installs): Llama Guard 4
      (`meta-llama/llama-guard-4-12b`) and Prompt Guard 2 (`meta-llama/llama-prompt-guard-2-86m`) are
      hosted on Groq (already-integrated provider in llm-client.ts) via the standard /chat/completions
      shape -- zero new install. Garak v0.15.1 confirmed pip-installable/runnable (scratch venv).
      Presidio-analyzer confirmed pip-installable/runnable with real PII detection (scratch venv).
- [x] Tool evaluation table: ai-os/VERIDIAN_V2_DEFENSE_IN_DEPTH_TOOL_EVALUATION_2026-07-26.yaml
- [x] Built src/lib/prompt-security/ -- types, layer1 (deterministic regex/unicode + optional Prompt
      Guard 2), layer2 (XML-delimiter/instruction-hierarchy hardening), layer3 (Llama Guard 4 via Groq),
      layer4 (PII scrub + leaked-instruction detection + content moderation), quality-engine (heuristic
      accuracy/refusal/repetition/injection-echo scoring), defense-in-depth (orchestrator wrapping
      llm-client.ts's callLLM -- the real Gateway G05 boundary, unmodified), red-team-battery (curated
      adversarial battery, payload categories sourced from garak's published probe taxonomy) + 35 passing
      colocated bun:test tests (0 failures)
- [x] scripts/defense-in-depth-smoke-test.ts -- SUCCESS_CRITERIA command, run live with real GROQ_API_KEY:
      all deterministic + the real end-to-end Llama Guard 4 / Prompt Guard 2 / callLLM() path all PASS
- [x] scripts/red-team-prompt-security.ts -- Red Team Engine CLI, JSON findings output, exit 0/1 on
      pass-rate threshold, verified 12/12 (100%) against the curated battery
- [x] Registered knowledge via claude-control's scripts/superboss-register.py register-knowledge; verified
      via query-knowledge "veridian_v2_defense_in_depth" --tag domain:veridian_architecture_v2 -> found=1
      (SUCCESS_CRITERIA #1 satisfied)

## Remaining
- [ ] Update phase_4 status in claude-control's
      ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml (separate repo, separate commit/push)
- [ ] Move ACTIVE-CLAIMS entry to recently_completed once this PR merges
- [ ] Open PR on compliance-tracker

## Honest deferrals (not silently dropped -- see tool evaluation doc for full reasoning)
- Live cron-wiring of the Red Team Engine (a Python wrapper at /opt/veridian/ai-os/scripts/ mirroring
  audit_pipeline_security.py's subprocess pattern + an OWNER_DECISIONS_NEEDED/CRONTAB_APPROVED_SNAPSHOT
  entry) is NOT done this pass -- the CLI script (scripts/red-team-prompt-security.ts) is real, tested,
  and ready to be wired; standing up the live ops-side cron entry is left as a follow-up given this
  phase's own "minimum real subset" instruction and this task's budget.
- Garak (confirmed installable/runnable) and Presidio (confirmed installable/runnable, real PII
  detection verified live) are NOT adopted as live server-side dependencies this phase -- see the tool
  evaluation doc's per-tool verdict for why (Garak: full live-scan cron integration is a real follow-up;
  Presidio: the document's own "browser-adapted" framing makes this phase_5/phase_6 scope, plus a 400MB
  spaCy model is a real Vercel-deployment-footprint concern).
- PyRIT and NeMo Guardrails were not independently installed/verified this pass -- both have real overlap
  with an already-adopted tool for the same requirement (PyRIT vs Garak for Red Team; NeMo Guardrails vs
  Llama Guard for Layer 3 -- the source document itself treats NeMo Guardrails/Llama Guard as
  alternatives, not both-required).
