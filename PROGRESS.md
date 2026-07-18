# PROGRESS -- task-20260718-085003-checks---balances--business-rule---calcu

VERIDIAN Review Framework gap-closure: Checks & Balances / Business Rule &
Calculation Verification. The 6 findings in this task's brief are 3 unique
gaps, each listed twice.

## Completed

- [x] Re-read the current codebase before planning (per this task's own
      instructions) rather than trusting the finding text as still-accurate.
      Confirmed: `guardrail-engine.ts` (Wave 157) is real, existing generic
      rule-engine infrastructure -- it just had zero "process"/"output"
      phase consumers wired to real calculation dispatch or AI output, and
      GST already has genuine Calculation Cross-Verification
      (`gst/validation-engine.ts`'s `checkTaxCalculation()`), which this PR
      does **not** duplicate.
- [x] **Business Rule Validation Before Execution** -- new
      `src/lib/business-rule-validator.ts` wires `guardrail-engine.ts`'s
      `evaluateGuardrails()` as a genuine PRE-EXECUTION gate
      (`assertBusinessRulesBeforeExecution()`), called at the top of
      `dispatchTool()` and `dispatchEngine()` in `task-execution-engine.ts`,
      alongside the existing POST-execution `assertValidDispatchOutput()`
      (`dispatch-output-validator.ts`). Registered real "process"-phase
      rules in `guardrail-registrations.ts` for the financially material
      engines: GST rate-split engines (0-40% sanity bound), EMI/loan
      engines (principal/tenure/rate sanity bounds), gratuity calculator
      (salary/years-of-service sanity bounds), commission calculator (rate
      bound). Unregistered engine keys are unaffected (guardrail-engine's
      own "not rigid" guarantee).
- [x] **Calculation Cross-Verification** -- new
      `src/lib/calculation-cross-verification.ts`. GST already had this
      (not duplicated). Added the same discipline to the two named domains
      that didn't: `crossVerifyEmi()` independently re-derives
      principal/interest/final-balance from the amortization SCHEDULE
      itself (summation), a different route than the closed-form EMI
      formula that produced it; `crossVerifyGratuity()` checks the
      statutory "gratuity <= one month's salary per year of service" bound
      independently of the 15/26 or 15/30 formula. Wired into
      `dispatchEngine()`'s `gratuity_calculator` and
      `emi_calculator`/`loan_schedule_generator`/`amortization_engine`
      cases -- a verification failure throws
      `CalculationVerificationError` instead of returning a possibly-wrong
      result, matching `dispatch-output-validator.ts`'s own posture.
- [x] **AI Output Validation by Business Rules** -- found a concrete,
      previously-unvalidated target:
      `src/app/api/documents/extract/route.ts`'s AI document extraction
      (`demandAmount`/`gstin`/`pan`/`complianceType`/`dueDate`) feeds a
      human-reviewable compliance-item draft
      (`DocumentUploadSection.tsx`) with zero validation against business
      rules. Added a new "output"-phase guardrail
      (`AI_DOCUMENT_EXTRACTION_LEAF`) reusing existing deterministic
      validators (`isValidGstinFormat`/`isValidGstinChecksum`/
      `isValidPanFormat` from `data-quality-engine.ts`,
      `VALID_TYPES` from `compliance-service.ts`) plus new amount/date
      plausibility bounds. A violation is recorded via
      `recordGuardrailViolation()` (audit trail) and surfaced as a
      `validationWarning` in the API response and a visible banner in
      `DocumentUploadSection.tsx` -- non-blocking (a human still
      reviews/edits every field before a compliance item is created), so
      this is a second, independent check layered on the existing human
      review, not a replacement for it.
- [x] Added real unit tests: `business-rule-validator.test.ts`,
      `calculation-cross-verification.test.ts`, plus new describe blocks in
      `guardrail-registrations.test.ts` covering every new leaf/check
      (positive and negative cases, including deliberately-corrupted
      EMI/gratuity results to prove the cross-verification actually
      detects a broken calculation, not just restate the primary formula).
- [x] Verification: `bun install` (node_modules wasn't present in this
      workspace checkout), `bunx tsc --noEmit` clean (0 errors),
      `bunx eslint` clean on every changed/new file, `bun test` full suite
      1457 pass / 0 fail, `bun run build` succeeds.
- [x] Registered this session's claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
      per that file's protocol before starting real work. Did not touch
      `permission-service.ts`'s `ERP_ACTION_ROLES` table or any other
      in-flight worker's declared scope.

## Remaining

- [ ] None known. Everything scoped to this task's 3 unique findings is
      closed. Not attempted (explicitly out of scope / no live target
      found in this pass): retrofitting a "process"/"output" guardrail
      through every other `computation_engines.key` beyond the
      GST/EMI/payroll ones the review named -- guardrail-engine.ts's
      registry is additive, so extending coverage to more engines later is
      safe and doesn't require touching this PR's code.
