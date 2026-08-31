# Payroll Rate-Table Seed Audit — 2026-07-26

> **Task**: V2-17-HR-PERF-VALIDATION ("HR performance/error-handling + payroll rate audit"),
> redispatch of a task originally created 2026-07-20 and pre-emptively blocked by a
> spend-governance gate before any work started (`ai-os/TIER3_RELEVANCE_TRIAGE_REPORT_2026-07-26.md`,
> objective key `hr-performance-payroll`).
> **Scope**: the code half of "payroll rate-table seed audit against current-FY rates" --
> the CA/payroll-specialist real-external-reviewer half stays deferred, recorded in
> `ai-os/REVIEW_FRAMEWORK_DECISIONS_2026-07-19.md` (V2-6) per this task's own constraint.

## 1. What "seed" means in this codebase — confirmed, not assumed

Searched fresh before writing this (not relying on the redispatch prompt's own
characterization): there is **no hardcoded payroll-rate seed table anywhere in
compliance-tracker's code**, and this is a deliberate architectural decision, not a gap.

- `src/lib/db/schema.ts`'s comment directly above `erpStatutoryRules` (Wave 56, ERP
  benchmark Tier 2 #5/#6): *"Admin-editable master data -- the entire point of this table
  is that PF/ESI/PT rates, wage ceilings, and PT slabs are NEVER hardcoded in code."*
- `erpIncomeTaxSlabs`/`erpIncomeTaxSlabRates` (Wave 68) carry the identical discipline in
  their own schema.ts comment: *"An org must set these up (admin-editable, never
  hardcoded ... same 'rates come from a periodic government notification' discipline as
  Wave 56's erp_statutory_rules) before payroll can auto-compute TDS."*
- `src/lib/services/erp-payroll-service.ts` (the payroll rule engine) confirmed by direct
  read: every PF/ESI/Professional-Tax/TDS computation reads its rate/ceiling/slab from a
  DB row (`listStatutoryRules`/`createStatutoryRule`, `listIncomeTaxSlabs`) filtered by
  `orgId` + `effectiveFrom`/`effectiveTo` — **zero** hardcoded percentage or ceiling
  constant anywhere in that file (grepped for bare numeric literals resembling a rate or
  ceiling; none found outside the rate-table rows themselves).
- `src/db/seed.ts` inserts **no** rows into `erpStatutoryRules`, `erpIncomeTaxSlabs`, or
  `erpIncomeTaxSlabRates` for the demo org — confirmed by grep, zero hits. There is
  nothing pre-seeded to audit against a Postgres snapshot; every org is expected to enter
  its own current rates via the admin UI/API before payroll runs.

**Conclusion**: there is no "seed table" in the CSV-row sense of "a shipped default rate
list that might be stale." The architecture's whole point is to avoid ever shipping one.
The genuine audit surface is therefore narrower and different from what the phrase "seed
audit" implies: (a) the handful of statutory *constants* that genuinely are hardcoded in
code (§2 below, distinct from the admin-editable master-data tables), and (b) confirming
the admin-editable design itself hasn't silently regressed into a hardcoded default
anywhere (§3 below).

## 2. Hardcoded statutory constants found in code — flagged for CA verification

Two constants in `src/lib/engines/payroll-engine.ts` are genuinely embedded in code,
**not** admin-editable master data, and therefore **are** the real audit surface a
CA/payroll specialist needs to check against the current-FY (2026-27) government
notification:

| Constant | File:line | Value | What it represents | Why it's hardcoded, not a DB row |
|---|---|---|---|---|
| `STATUTORY_CAP` | `payroll-engine.ts:27` | ₹20,00,000 | Payment of Gratuity Act, 1972 statutory ceiling on gratuity payout | This is a single national Act ceiling (not org- or state-specific like PF/ESI/PT), last revised by the Payment of Gratuity (Amendment) Act 2018 to ₹20 lakh — genuinely rare to change, unlike PF/ESI rates which move via more frequent EPFO/ESIC notification |
| `EPS_WAGE_CEILING` | `payroll-engine.ts:63` | ₹15,000/month | EPFO Employees' Pension Scheme wage ceiling (employer PF share split) | Same class as above — a national EPFO-notified ceiling, not org-configurable data |
| Bonus % bounds (8.33–20%) | `payroll-engine.ts:79` (`calculateBonus`) | 8.33% min / 20% max | Payment of Bonus Act, 1965 statutory floor/ceiling | These are the Act's own legislated bounds (not a "current rate" that drifts) — a validation guardrail, not a rate |

**Honest limitation, stated plainly**: this audit confirms these three constants are
*documented and traceable to their statutory source* (each already carries a code comment
naming the Act/section it derives from — verified present, not added by this task). It
does **not** independently re-verify against the live government notification that ₹20
lakh / ₹15,000 / 8.33–20% are still current as of FY2026-27 — that verification requires
a real external CA/payroll-specialist reviewer, which this task's own constraints
explicitly defer (see `ai-os/REVIEW_FRAMEWORK_DECISIONS_2026-07-19.md`, new entry below).
No code change is proposed for these three constants: they are correctly placed in code
(national Act ceilings, not org-configurable data) and are not a "stale seed" in the
CSV-row sense — the only open question is whether the *values themselves* are still
current, which only a CA can answer.

## 3. Confirmed: the admin-editable design has not regressed

- `erp-payroll-service.ts`'s `getApplicableRate()`-style lookups (feeding
  `listStatutoryRules`) filter on `effectiveFrom`/`effectiveTo` so an org can version its
  own rate history (e.g. record a mid-year EPFO notification change) without losing the
  old row — re-read directly, confirmed still intact, not touched by this task.
- `erpIncomeTaxSlabs.name` field's own schema.ts example (`"New Regime FY 2026-27"`) shows
  the intended per-FY naming convention orgs are expected to follow when they set up their
  own slabs — this is guidance already present in the schema, not something this task
  needed to add.
- No code path in `erp-payroll-service.ts`, `erp-buying-service.ts`, or
  `src/lib/engines/payroll-engine.ts` falls back to a hardcoded default rate when an org
  hasn't configured `erpStatutoryRules`/`erpIncomeTaxSlabs` — confirmed by reading
  `listStatutoryRules`'s callers: an org with no configured rule simply gets an empty
  result (manual TDS entry / no auto-PF-deduction), never a silently-wrong guessed rate.
  This "fail to manual, never fail to a wrong guess" posture is the correct behavior for
  a statutory deduction and required no fix.

## 4. Out of scope, explicitly — "GstRt parity"

The redispatch prompt's OBJECTIVE line includes the phrase *"the seed-audit + GstRt
parity is code"* immediately after describing this same payroll rate audit. Checked this
literally rather than silently dropping or silently acting on an ambiguous instruction:
`GstRt` (the per-line GST-rate field in India's e-invoice IRP JSON schema) belongs to a
**separate, already-independently-tracked gap** — CSV row `#70` / decision-log item C12
in `ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md` ("E-invoicing (UAE/India) +
per-line GstRt... Fix the per-line GstRt gap in code"), which names `erp-einvoice-service.ts`
as its file scope — a GST e-invoicing concern, not a payroll one, and not touched by
`erp-payroll-service.ts`/`payroll-engine.ts` anywhere. V2-17's own READ FIRST list
(`employee_profiles`; `erp_statutory_rules`/`erp_income_tax_slabs`; HR service routes)
never mentions e-invoicing either. This is recorded here as a cross-reference bleed
between two adjacent decision-log rows (C7/C8/C12 sit next to each other in that plan's
table) rather than a real actionable ask inside V2-17 — **no GstRt code change is made by
this task**; that gap remains owned by its own tracked item.

## 5. Summary

| Sub-ask | Disposition |
|---|---|
| Audit the payroll rate *seed table* | No such table exists in code by design (§1) — confirmed, documented, not a gap |
| Flag hardcoded statutory constants for CA review | Done — 3 constants named with file:line (§2) |
| CA/payroll-specialist verification these are current for FY2026-27 | **Deferred** — real external reviewer required, recorded in V2-6 (§6 below) |
| Confirm the admin-editable design hasn't regressed | Confirmed intact (§3) |
| GstRt e-invoicing parity | Out of scope for V2-17 — owned by CSV row #70 / C12 (§4) |

## 6. Deferred half — recorded per this task's own constraint

The CA/payroll-specialist rate verification (whether ₹20,00,000 / ₹15,000 / 8.33–20% and
any org's own configured `erpStatutoryRules`/`erpIncomeTaxSlabs` rows are correct for
FY2026-27) is deferred pending a real external reviewer, per V2-17's own stated
constraint: *"CA/payroll-specialist rate verification = real-external reviewer → that
half stays deferred (record in V2-6)."* Recorded as a new entry in
`ai-os/REVIEW_FRAMEWORK_DECISIONS_2026-07-19.md`.
