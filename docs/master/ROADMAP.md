# VERIDIAN AI OS — Roadmap

Synthesized from [`AUDIT_2026-07-09.md`](AUDIT_2026-07-09.md) and [`CRITICAL_GAPS.md`](CRITICAL_GAPS.md). Ordered by leverage (severity × how cheap the fix is), not strictly by severity alone — several Critical items are also the cheapest fixes and belong first for that reason.

---

## Immediate (this week — all are Small/hours-scale fixes with outsized risk reduction)

1. **Remove or correct the false Razorpay claim on the pricing page.** (10 min) — a live, false commercial statement is the single worst risk-to-effort ratio item in the whole audit.
2. **Fix the MCP `create_compliance_item` cross-tenant IDOR** — add org-scoped FK validation before insert. (1-2 hrs)
3. **Add the AI Dev Team's GLM models to `MODEL_PRICING`** before `AI_TEAM_LOG_SECRET` gets set — currently a silent time bomb. (15 min)
4. **Backfill the Capability Registry's missing embeddings** (13/27 agents, 38/99 modules) and hook indexing into the creation path going forward. (2-4 hrs)
5. **Add the 4 missing routes to the middleware allowlist** (`/connectors`, `/gst-reconciliation`, `/tds-returns`, `/the-firm-practice`) — the immediate fix, not yet the generator. (30 min)
6. **Fix the 16 routes silently downgrading `ServiceError` to 500.** (under an hour)
7. **Drop the 4 confirmed duplicate indexes** (`clients`/`client_entities`/`user_client_access`) — free, zero-risk performance win.
8. **Add the missing `erp_journal_entries(org_id, status, posting_date)` composite index** — the single highest-leverage performance fix in the audit.
9. **Consolidate the 4 hardcoded pooler-connection-string implementations into one shared module** — closes a dormant landmine identical in shape to a real past outage.

---

## 30 Days

**Security & access control**
- Build the Firm module's `clientIds` scoping fix (the Critical multi-tenant access-control bug) — schema/RLS work + ~25 route updates + regression testing.
- Wire the Policy Enforcement Engine into the 7+ unwired LLM call sites (construction AI, CRM AI, meeting intelligence, FM digitization, visitor/sales AI, document extraction, task-planning).
- Add `FORCE ROW LEVEL SECURITY` to all 357 tables (one migration, zero behavior change today).
- Add a role-change/emergency-deactivation API+UI for users.
- Fix the standard Supabase advisor hardening items (SECURITY DEFINER views/functions, mutable search_path, leaked-password protection).

**Observability**
- Ship `instrumentation.ts` → `application_errors` table → digest cron (closes the "no APM" gap without adding a vendor).
- Ship the "secrets present" deployment check (`/api/internal/secrets-audit/run`).
- Link CI to Vercel's deploy gate (branch protection + Vercel "Ignored Build Step" re-running typecheck/lint).

**Data model hygiene**
- Reconcile the 3 migration-file-missing-but-live-RLS tables; add a CI drift-detection gate.
- Clear the highest-blast-radius portion of the 203-unindexed-FK backlog (ERP procurement domain first).
- Investigate and resolve the orphaned `firm_client_portal_links` table.
- Fix the migration-numbering collision (`0101` used twice).

**Product**
- Wire PROJEXA expenses/labour costs into the General Ledger (at minimum, an optional "post to GL" action).
- Correct `CLAUDE.md`'s stale claims (table count, shared components, `compliance` schema note).

---

## 90 Days

**Worker Agent execution** (the single biggest product-positioning gap) — build the real `dispatchWorkerAgent()` executor with safety rails for arbitrary user-authored prompts, closing the "propose an agent, it never actually runs" gap for the majority of the registry.

**Multi-client UX** — a real client-onboarding wizard (add client → entities → invite users → assign staff → client-scoped dashboard) and a client-context switcher, building on the access-control fix from the 30-day plan. This is the product decision the audit flagged as needing human/business sign-off before execution.

**FK integrity, first wave** — add `.references()` constraints to the money/compliance-critical tables first (ERP financials, `complianceItems`, `auditFindings`, `risks`), 15-20 tables per wave.

**Testing maturity**
- Ship 5-10 smoke-path E2E tests (login, compliance-item round trip, one financial-posting-to-report flow, one cross-tenant isolation browser check) — the real blocker is the seeded test-org fixture, build that first.
- Extend `bun:test` unit coverage to the ~10-15 highest-stakes pure-calculation functions across ERP (GST, payroll tax, budget variance).
- Confirm/extend Loop 12's table coverage against every table with a documented past RLS bug.

**PROJEXA UI** — at minimum the CRUD-shaped subset (BOQ, attendance, site diary) via the existing `SimpleModulePage` pattern.

**Billing** — if commercial launch is imminent, the real Razorpay Subscriptions integration (2-3 weeks); otherwise keep the pricing page corrected and defer.

**Data portability** — the async bulk-export job for the top 15-20 customer-facing tables.

**VCEL expansion** — the next engine-file slice beyond GST (likely income-tax/TDS, given they back already-shipped payroll features).

---

## 1 Year

- Build the first real `global_intelligence_oa` consumer (anonymized cross-org pattern detection), or make an explicit decision to keep it a documented roadmap placeholder rather than implying it's live.
- Full FK-integrity retrofit across the remaining domains (PMS, CRM, construction, FM, GST, HR, worker-agents, sales) beyond the 90-day money-critical first wave.
- `/api/v1` expansion to the ~30 domains currently undocumented in the OpenAPI spec, prioritized by real partner/integration demand (likely CRM/HR first).
- Extend service-layer coverage to the 34 modules currently at zero (the actual lever behind MCP/AI reachability staying narrow).
- Consolidate the MCP vs. internal-dispatch tool registries into one shared source of truth.
- Regenerate (or formally retire and replace) `orchestra_changes.md` as the project's single source of truth for build history — it's 60+ waves stale and the gap will only widen.
- Codify the ERP/PMS/PROJEXA scaffold convention as an actual template/generator before a 4th large product branch is built, since the discipline has held by imitation with no enforcement mechanism.
- Schedule and document a real Supabase backup/restore drill; define RPO/RTO for financial data.
- Revisit Vercel/Supabase region alignment (`sin1` vs `ap-south-1`) if latency becomes a measured customer complaint.

---

## Explicit non-recommendations (things this audit considered and rejected)

- **Do not build a generic CRUD-service factory** to reduce cross-module duplication — the existing copy-adapt pattern is working well given genuine domain diversity; the real lever is service-layer *coverage*, not reducing duplication among modules that already have one.
- **Do not attempt to unit-test the DB-touching CRUD layer** the same way as the recommended pure-calculation functions — that's what the (currently manual, recommended-for-automation) RLS/business-logic simulation via Supabase MCP already covers more rigorously than a mocked test would.
- **Do not split `schema.ts` by domain** given Drizzle's `relations()` API constraint on cross-domain joins — flagged as informational technical debt, not an actionable fix, given the regression risk for uncertain payoff.
