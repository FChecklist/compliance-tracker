# DSPy Integration: adopt-vs-reject technology decision

**Phase:** `phase_8_dspy_learning_distribution_engines` increment 1
(claude-control repo: `ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`),
gap item `engine-dspy-integration`.
**Decision date:** 2026-07-27.
**Required by:** the phase's own scope bullet -- "Evaluate and, if adopted,
integrate DSPy... a real technology-adoption decision, not an assumption"
-- same rigor standard as
`ai-os/BROWSER_LITE_LLM_TECH_DECISION_2026-07-27.md` (phase_5 increment 1),
used as this doc's structural template.

## The real prior art (confirmed by reading the code, not assumed)

- `src/lib/prompt-compiler/` (phase_2, `pipeline.ts`/`prompt-construction.ts`)
  is the real, live compiler this phase's own scope names as DSPy's
  candidate integration point. It is explicitly documented as **pure,
  deterministic, zero-LLM-call** by design: `prompt-construction.ts`'s own
  header states this is "per the Owner's 2026-07-25 UX directive
  reconciliation: it is the machine-language-output CONTRACT phase_5's
  browser input surfaces will later compile into, **not a second AI
  pass**." That directive was issued two days before this task, by the same
  Owner this task answers to.
- `services/doc-processing/` (the real, existing standalone Python
  microservice this task's KNOWN_CONTEXT names as the integration surface
  for any DSPy Python runtime) is confirmed, by reading `main.py` and
  `requirements.txt` directly, to be a **FastAPI OCR/PDF/transcription**
  service (PaddleOCR, PyMuPDF/docling, whisper-cpp-python) with zero prompt-
  compilation, chat, or LLM-call logic anywhere in it. It has no functional
  relationship to the prompt-compiler domain -- it processes uploaded
  documents/audio, not user prompts.
- The real prompt-compilation domain logic (classification, intent,
  template-matching, machine-prompt compression) is 100% TypeScript, living
  entirely in `src/lib/prompt-compiler/`. DSPy is a Python-only framework
  with no maintained TypeScript port offering equivalent optimizer
  functionality (`BootstrapFewShot`, `MIPROv2`, etc.).

## Installability (confirmed live, not assumed)

`pip install --dry-run dspy numpy==1.26.4 PyMuPDF==1.20.2` (the two version
pins `services/doc-processing/requirements.txt` already carries, load-
bearing per that file's own documented paddleocr/PyMuPDF conflict history)
resolves cleanly: `dspy-3.2.1` installs alongside the pinned `numpy-1.26.4`
and `PyMuPDF-1.20.2` with **no version conflict** -- pip's resolver accepts
both pins unchanged. DSPy itself is genuinely installable against this
stack. Installability was never the blocker; integration fit is.

## The decision

**Do not adopt DSPy for real integration this increment.** Confirmed
installable, but there is no honest integration point for it that doesn't
violate an existing, explicit constraint:

| Candidate integration point | Why it doesn't work |
|---|---|
| Replace/augment `src/lib/prompt-compiler/`'s Layer 2-5 pipeline | Directly contradicts the Owner's own 2026-07-25 directive that this pipeline stay deterministic/zero-LLM-call. DSPy's entire value proposition (`BootstrapFewShot`/`MIPROv2` teleprompters) is optimizing prompts *by making real LLM calls* during compilation -- exactly the "second AI pass" that directive rules out. |
| Call DSPy from `services/doc-processing/` | That service's real, confirmed domain is document OCR/transcription, not prompt compilation -- there is no existing call site that needs a compiled/optimized LLM prompt. Bolting DSPy onto it would be an unrelated-domain shim with no real caller. |
| Stand up a new Python service for DSPy | Explicitly forbidden by this task's own KNOWN_CONTEXT ("Do NOT stand up a fresh Python deployment for DSPy"). |
| Call DSPy (Python) from the real LLM-call site (`llm-client.ts` / Gateway G05, TypeScript) | No Python process exists in that request path today; would require exactly the new deployment the constraint above forbids. |

Every real candidate integration point either violates an explicit prior
Owner directive or an explicit constraint set by this task itself. That is
a justified rejection, not an assumption or a default.

## Justification

1. **Objective mismatch, not just a missing wire-up.** DSPy trades prompt
   *length* for output *quality* (few-shot exemplars bootstrapped via real
   LLM calls, often lengthening the final prompt). Phase_2's compiler has
   the opposite, already-measured objective: deterministic token
   *reduction* with zero LLM calls (see next section for real numbers).
   These are not two implementations of the same job; adopting DSPy here
   would not "augment" the existing pipeline's goal, it would replace it
   with a different one the Owner already ruled out for this surface.
2. **The Owner's directive predates this task by two days and is still the
   live, uncontradicted rule.** `prompt-construction.ts`'s header is not a
   stale comment -- `services/doc-processing/`'s own domain and the real
   caller graph (`app/api/prompt-compiler/execute/route.ts`) both confirm
   the deterministic design is what's actually running in production, not
   an aspirational note.
3. **No real Python integration surface exists for this domain**, and
   this task is explicitly barred from creating one. Unlike the WebLLM
   decision (phase_5), where a real, if differently-scoped, browser
   inference surface already existed to build on, DSPy has zero real
   surface to attach to in this codebase today.
4. **Reusing this doc's own template's discipline**: the WebLLM decision
   adopted a named technology because the document explicitly named it
   *and* a compatible role existed. Here the document names DSPy *and* an
   explicit architectural directive already rules out its one real
   candidate role. Rejecting is the decision that actually follows the
   same evidence-first method, not a default-to-"no" shortcut.

## Real before/after evidence (the "justified alternative")

Per this phase's own success criteria ("a real command proving one real
prompt compiles through whichever compilation method this phase adopts --
DSPy or a justified alternative -- with a measurable quality/token-count
before/after, exit 0"): the adopted method is phase_2's own existing,
already-real deterministic compiler (no new engine built for this --
consistent with the Owner's "no new engine unless necessary" directive).

Real command or the phase_2 SUCCESS_CRITERIA:

```
bun run scripts/prompt-compiler-smoke-test.ts
```

Real measured result on the script's real sample prompt ("Hi, could you
please basically fix the login bug in the auth module for me today?
Thanks!"):

| Metric | Before | After | Change |
|---|---|---|---|
| Estimated tokens | 22 | 9 | -59.1% |
| Character noise | -- | -- | -42.7% cleaned-text reduction |
| Matched template | -- | `fix\|debug\|resolve ... in\|for\|on ...` (real template hit) | -- |

Exit code: 0 (script's own `PASS`/`FAIL` assertions all pass; verified
live this session).

## What this increment actually ships (honesty about scope)

- A real, live, evidenced adopt/reject decision on DSPy (this document),
  not silence or a default assumption.
- Real installability evidence (`pip install --dry-run`) and a real,
  already-existing before/after token-count command satisfying the
  success criteria via the justified alternative.
- Does **not** ship any DSPy code, dependency, or Python wiring -- there is
  none to ship under this decision.

**Follow-up (explicitly filed, not silently dropped):** if a future phase
introduces a real LLM-call site with a genuine Python runtime in its own
request path (not this task's OCR service), DSPy's `BootstrapFewShot`/
`MIPROv2` teleprompters remain a real candidate for optimizing *that*
call's prompt quality -- re-evaluate then, against that concrete site,
rather than forcing today's zero-fit candidates.
