# System-Tree Audit Round 3 -- `50-merged-tree.yaml` ("3rd tree", Round 3)

**Trigger:** two findings from a VERIDIAN Review Framework pass on AI Documentation / Documentation Lifecycle (2026-08-01) -- "Documentation Completeness" (roughly half of documented domains missing key fields, recommending a Round 3 targeting the highest-risk domains' empty `guardrails` fields first) and "Documentation Synchronization with Code" (CI checks catch structural drift, not semantic drift, recommending periodic spot-check audits like this one as the practical complement).

**Scope, same discipline as Round 1/2:** a judged subset, not a mechanical 100% fill. Round 2 left 48/94 (51%) domains with empty `guardrails`. This round picked the **8 highest-risk** of those 48 by real-world blast radius (financial data, legal exposure, access control, e-signature integrity) and did a real code-grounded research pass on each -- not a relabeling of existing `rules` text (Round 2's method), a fresh investigation via two parallel Explore-agent passes over the live codebase, each independently reading the actual service/route files, not assuming the tree's own prior text was accurate.

---

## Domains fixed this round

| Domain | Why highest-risk | Guardrails added |
|---|---|---|
| `DB-15` | ERP general ledger/payroll/inventory, ~150 tables, real money | Multi-step approval engine with a hard four-eyes floor + self-approval block; period-close posting lock; role-gated period close/reopen via `permission-service.ts`'s `ERP_ACTION_ROLES`. |
| `UI-08` | Finance/ERP pages, the UI surface over DB-15 | Status-conditional Close/Reopen rendering on the periods page; **real gap flagged**: the Close button isn't client-side disabled when the checklist is incomplete (server-side gate still holds). |
| `DB-14` | E-signature -- legal enforceability depends on this being real | Genuine signature capture + SHA-256 document-hash tamper detection at both request and sign time; server-enforced signing order; opaque, time-bound, non-enumerable share/guest tokens. |
| `DB-07` | Legal (litigation, IP, legal opinions) | Org-scoped access + manager-role-gated writes. **Also corrected a factual error in the tree's own `rules` text** (see below) -- the tree previously claimed AI-drafted legal opinions with human review; that is not what the code does. |
| `DB-02` | Compliance core -- the platform's primary domain | Real Postgres RLS via `withTenantContext()`, not just app-level filtering; role-ranked create/update/delete. **Real gap flagged**: marking a compliance item "completed" or resolving an audit point has no sign-off/maker-checker gate. |
| `DB-05` | Access review, ingestion -- security-relevant by name | Admin-only certification; a `revoked` access-review decision actually hard-blocks login (not just a status flag); staged-import confirm/reject is real and blocks post-confirm edits. **Real gap flagged**: the ingest confirm/reject routes only call `requireAuth()`, not `requireRole()`.
| `UI-02` | Compliance core pages -- highest-traffic authenticated surface | `/ingest`'s review UI is really wired to the API; `/audit`'s trail viewer is genuinely read-only (no PATCH/PUT/DELETE route exists). **Real gap flagged**: `/audit-engagements`' CAPA finding "ownership" is a label, not an enforced gate -- any manager+ can close any finding, and closing auto-passes the retest.
| `UI-07` | Admin pages -- if this domain's guardrails are weak, everything downstream is exposed | MFA is a real session-wide AAL2 edge gate via `src/proxy.ts`; SSO settings are server-role-gated. **Significant real gap flagged, see below.** |

## The one finding worth escalating: `UI-07`

Same class of discovery as Round 2's `UI-10` finding (new analysis produced by the act of writing an explicit guardrail field, not a relabeling of existing text): **"Admin pages" is a UI-section label, not a uniformly admin-only surface.**

- The sidebar's Admin section (Users, Departments, Access Review, Settings, Audit Log) has no role conditional -- every authenticated user sees the links.
- `GET /api/users` and `GET /api/departments` have no `requireRole` call -- only the write paths are role-gated.
- Most notably: `ApiKeySection` and `WebhookSection` render unconditionally in `/settings` (unlike the `isAdmin`-gated sections around them), and their backing routes call only `requireAuth()`, never `requireRole()`. **Any authenticated org member, including the lowest `viewer` rank, can mint a write-scoped API key or register a webhook (with its secret), and neither route writes an activity-log entry.**

This is flagged here, not fixed -- remediating it is a permission/auth-guard code change, out of scope for a documentation-lifecycle task (and outside this task's declared file scope, which does not touch `permission-service.ts` or `auth-guard.ts`). Surfacing it honestly, the same way Round 2 surfaced `UI-10`, is what this tree is for.

## Correction to `DB-07`'s `rules` text (accuracy fix, not just a guardrails addition)

The tree previously stated: *"legal_opinions/[id]/generate ... drafts against this table using AI, human-reviewed before finalization."* Direct code research this round found `src/lib/services/legal-opinion-service.ts`'s own header states it is **"deliberately NOT generative/AI authoring"** -- it is a CLM-template token-substitution engine over human-written clause text, not an LLM drafting pipeline. There is also no status/finalization field or route on `legal_opinions` at all -- `generateOpinionDraft` simply overwrites `bodyText` each call. The tree's prior text was wrong on both the mechanism (AI vs. template substitution) and the workflow (a "finalization" step that doesn't exist in code). Corrected in place, with the correction itself left visible in the file (not silently overwritten) so the history of the mistake is legible, consistent with this tree's honesty discipline elsewhere (e.g. `12-compliance-tracker-database.yaml`'s own note about `CLAUDE.md`'s stale table count).

## Verification of Round 1/2 fixes (still holding)

- **94 domains, 94 unique ids, zero dangling cross-references, YAML parses cleanly** -- re-verified mechanically after this round's edits, same method as Round 1/2 (`yaml.safe_load` + regex over every `GOV/API/DB/UI/PRX/VA/VB-nn` pattern).
- Round 2's 11 guardrail additions and 2 reverse cross-references untouched by this round's edits (different domain ids).

## What remains open, stated honestly

- **40/94 domains (43%) still have empty `guardrails`**, down from 51% after Round 2 and 62% after the raw copy. This round deliberately traded breadth for depth -- 8 domains got a real independent research pass (not just a relabeling of existing `rules` text) rather than a larger number getting a shallower one. The remaining 40 were not reviewed this round.
- **31/94 domains (33%) still have empty `workflow`** -- untouched across all three rounds; still an open item, same as Round 2 left it.
- Three real security/process gaps were **found and documented, not fixed**: `UI-07`'s unrestricted API-key/webhook minting (the most significant), `DB-02`'s missing sign-off on compliance-item/audit-point status changes, `DB-05`'s missing role gate on ingest confirm/reject, and `UI-02`'s label-only CAPA-finding ownership. All four are flagged in their respective domain's `guardrails` field for visibility, not remediated here.

---

## Finding #5 (Documentation Synchronization with Code): recommended audit cadence

The new `scripts/check-doc-drift.mjs` CI check (added alongside this round, see `ai-os/system-tree/doc-counts-baseline.yaml`) catches **structural** drift -- table/route/page counts moving away from what the docs claim. It cannot catch **semantic** drift -- a domain's `guardrails`/`rules` text becoming wrong while the object counts stay stable (exactly what happened to `DB-07` above: the count of legal tables never changed, but the description of how `legal_opinions/[id]/generate` works was simply incorrect). No CI check can catch that class of error without re-reading the actual service code, which is judgment-heavy work, not a mechanical diff.

**Recommendation:** run a new `SYSTEM-AUDIT-ROUND-N` spot-check pass at a defined cadence rather than an ad-hoc one, so this class of drift doesn't silently accumulate for months between review-framework passes:
- **Trigger 1 (time-based):** every ~90 days, matching the cadence already established for the 90-day quality mandate in `AGENTS.md` Rule 8.
- **Trigger 2 (activity-based):** whenever `scripts/check-doc-drift.mjs` fires in CI (i.e. structural drift already crossed the 10% tolerance) -- at that point a full re-synthesis pass is warranted anyway, and a semantic spot-check of a judged subset of domains should ride along with it, the same way this round rode along with the drift-check's introduction.
- **Scope per round:** 6-10 domains, prioritized by risk (financial/legal/access-control first, matching this round's own prioritization), not an attempt at full 94-domain coverage in one pass -- Round 1/2/3's own trajectory (62% -> 51% -> 43% empty `guardrails`) shows steady, judged progress is more sustainable than a one-shot full audit that then goes stale again.

This is a process recommendation, not a code change -- there is no reliable mechanical way to schedule or enforce "someone did a judgment-heavy re-read," the same honest limitation every guardrail-presence-class check in this repo already states about itself.
