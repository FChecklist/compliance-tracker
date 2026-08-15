# REVIEW FRAMEWORK DECISIONS — 2026-07-19

> **Purpose**: durable decision-of-record for the rows in
> `claude-control/VERIDIAN_Review_Framework_evaluated_2045rows.csv` that the
> SUPERBOSS v2 plan (`ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md`,
> §2 decision log) closes **without writing code**. Each entry records the
> decision, its rationale, and the authority basis, so the CSV re-score has
> auditable evidence for every row moved off "Needs Owner Decision" /
> "Unable to Verify" by a *decision* rather than by a *build*.
>
> **Task**: V2-6-DECISIONS-OF-RECORD (docs-only, L1 Code Worker).
> **Tier**: 1 (docs-only; no code, no schema, no auth/RLS, no payment/billing, no `.env`).
>
> **Authority basis (applies to every entry below)**: the Owner pre-authorized every
> decision *except* spending real money. Per the v2 plan's §2 authority note:
> "the Owner pre-authorized every decision EXCEPT spending real money. Decisions
> below are made under that authority and disclosed per the task's disclosure
> standard." Real-money rows stay deferred (bucket (a) in §2) and are **not** in
> this doc — they are recorded as deferred in §2(a), not closed. Each entry below
> is bucket (b) "decided here under granted authority" or bucket (c)
> "code-closable / close-by-record", per §2's three-bucket split.
>
> **CSV references**: each entry cites the CSV row by Main Category / Sub Category /
> Parameter (the CSV's identifying columns) plus the row's own
> Recommendation / Alternative Solutions text, which is the primary authority basis
> — every decision below either adopts the row's own stated recommendation or, where
> the plan diverges, states why. Row-status values are the CSV's frozen-2026-07-16
> `Status` column, which the v2 plan (§1) flags as stale; the decision below is the
> re-score.

---

## D7 / D11 — CRM/ERP Connector Framework: **HOLD AND DOCUMENT, no build**

- **CSV row**: `General` / `Integration Framework` / **`ERP/CRM Integration Readiness`** (frozen status: *Evaluated - Needs Owner Decision*).
- **Decision**: **Defer the connector framework; do not build.** Add a Tally connector **only if a real sales blocker names it**. For now, the platform's native ERP (`erp/*`) and CRM (`crm/*`) modules remain the primary offering — external-system sync (SAP/Salesforce/Zoho/Tally) is not built and is intentionally not on the roadmap.
- **Rationale**: The CSV's own recommendation is *"If external-system sync becomes a sales blocker, evaluate a Tally connector first"*, and its Alternative Solutions explicitly accept *"Native ERP/CRM as the primary offering (current strategy, valid)"*. There is no money needed, but there is also **no confirmed demand** — building a connector speculatively would be scope-inflation against an unvalidated market signal. The right gate is a genuine sales-blocker (a prospect who will not sign unless VERIDIAN syncs with their existing Tally/SAP/etc.), which has not occurred.
- **Authority basis**: Owner pre-authorized decision authority minus real money. This is a product-scope decision (what to build, not what to buy); it adopts the row's own recommendation verbatim. D11 (#14 ERP/CRM Integration Readiness / Tally) is the same row and the same decision — folded here, not duplicated.
- **Re-score**: row stays *Open-but-decided* (no longer "Needs Owner Decision"); re-opened only on a documented sales-blocker signal. No code written; this paragraph **is** the close evidence.
- **Plan ref**: §2(b) D7, §2(b) D11 → V2-6.

---

## D9 — FinOps reconciliation against Finance ledger: **NO second independent cost source**

- **CSV row**: `AI Cost Governance & FinOps` / `Cost Monitoring & Forecasting` / **`AI Cost Governance & FinOps: FinOps dashboard reconciles engineering cost claims against Finance's ledger`** (frozen status: *Evaluated - Needs Owner Decision*).
- **Decision**: **Do NOT build a second, independent "engineering cost claim" source** to reconcile the Finance token-usage ledger against. Accept the token-usage ledger as the sole source of truth at current team size and spend scale.
- **Rationale**: The CSV's own recommendation states a second independent estimate *"may be over-engineering for current team size"* and its Recommended Approach is *"Defer unless spend scale or an audit requirement justifies building a second independent estimate."* Its Alternative Solutions: *"Accept the ledger as sole source of truth given current team/spend scale, revisit only if spend grows significantly."* Building a parallel cost-claim pipeline to cross-check a ledger that already draws on real token counts would double the surface area for a reconciliation benefit that does not yet exist a cost-drift problem to catch. The cost-incident RCA (already merged, `ai-os/` #482) plus the live token-usage ledger provide sufficient cost signal at present scale.
- **Authority basis**: This is a scope/engineering-judgment decision (whether to build a second system), not a money decision — squarely within granted decision authority. It adopts the row's own recommendation and alternative. **Revisit only if spend grows significantly or an external audit demands a second source.**
- **Re-score**: row moves off "Needs Owner Decision" to *Decided – no action at current scale*. No code written.
- **Plan ref**: §2(b) D9 → V2-6.

---

## C13 — Bank credential storage security: **target lowered to 3, no action until live bank-API prioritized**

- **CSV row**: `Financial & Banking Integration Depth` / `Compliance & Integration Standards` / **`Financial & Banking Integration Depth: Bank integration credential storage security`** (frozen status: *Evaluated - Unable to Verify*).
- **Decision**: **Lower the target score to 3** (the row's own stated recommendation) and take **no action now**. When a live bank-API integration is actually prioritized and built, **reuse `src/lib/ai-config-crypto.ts`'s existing encryption** for any bank-API config — do not stand up a separate credential vault.
- **Rationale**: The CSV's Gap Identified is *"No bank-integration credentials exist, so there is nothing to secure yet"*, and its Recommendation is *"Lower target to 3 (partial credit ceiling) since this capability is contingent on live bank-API integration being built first, which is not currently planned; when it is, reuse ai-config-crypto.ts's encryption."* There is genuinely nothing to verify or secure — there are no bank credentials in the system. Lowering the target to 3 (from the implied 5) is an honest re-scoring, not a degradation: the capability is contingent on a bank-API build that is not planned, so scoring it at full would be aspirational.
- **Authority basis**: This is a scoring/target decision that adopts the row's own recommendation verbatim — within granted authority. It is *not* a money decision (no purchase). The "reuse ai-config-crypto.ts when built" half is a forward-looking engineering note, not a present action.
- **Re-score**: row moves off "Unable to Verify" to *Decided – target lowered to 3, no action until bank-API prioritized*. No code written.
- **Plan ref**: §2(c) C13 → V2-6.

---

## C16 — Market Fit (PMF validation): **DEFERRED — not yet applicable, no paying-customer base**

- **CSV row**: `General` / `Product Strategy & Market Fit` / **`Market Fit`** (frozen status: *Evaluated - Needs Owner Decision*).
- **Decision**: **Keep deferred — no action.** A structured PMF-validation pass (interviews + retention cohort) is genuinely not-yet-applicable: it requires a paying-customer base that does not yet exist. This is recorded as a deliberate *not-now*, not closed-as-done.
- **Rationale**: The CSV's Gap Identified is *"No confirmed market-fit validation signal"* and its Recommendation is *"Run a structured PMF validation pass (interviews + retention cohort) once a paying-customer base exists."* There is no money required, but the precondition (paying customers) is absent — running a PMF interview pass with zero customers would produce noise, not signal. The honest disposition is *deferred on applicability*, distinct from bucket (a)'s *deferred on money*.
- **Authority basis**: Within granted decision authority (not a money call). Records the decision plainly rather than leaving the row ambiguously "Needs Owner Decision" — the Owner-decision here is "not yet," which is itself the decision.
- **Re-score**: row moves off "Needs Owner Decision" to *Deferred – not yet applicable; revisit once a paying-customer base exists*. No code written.
- **Plan ref**: §2(c) C16 → V2-6.

---

## C17 — OPENAI_API_KEY provisioning (4 rows): **FORMAL OWNER-ACTION REQUEST, not a code or money gap**

- **CSV rows** (4, all frozen status *Evaluated - Needs Owner Decision*, all blocked on the same single missing secret):
  1. `Security & Access Control` / `Secrets Management` — *"Not all required secrets are provisioned"*; Recommendation: *"Owner to provision OPENAI_API_KEY in Vercel + GitHub Secrets"*.
  2. `AI Chat & Insights` / `Chat Experience` — *"Voice-ticket transcription non-functional pending OPENAI_API_KEY"*; Recommendation: *"Same fix as row 21 (provision OPENAI_API_KEY)"*.
  3. `Document & Media Intelligence` / `Audio Transcription Quality` — *"Fully-coded feature blocked on a missing provisioned secret"*; Recommendation: *"Same fix as row 21 … then run a quality benchmark against real voice memos"*.
  4. `Conversational Communication Quality` / `Voice Interaction Readiness` — *"Text-to-speech … unbuilt, and the built speech-to-text path is non-functional without a missing API key"*; Recommendation: *"Provision OPENAI_API_KEY in Vercel + GitHub Secrets to activate the already-built Voice Tickets transcription path; scope TTS and general compose-bar mic separately"*.
- **Decision**: **Formally request the Owner provision `OPENAI_API_KEY`** in Vercel + GitHub Secrets. The code paths that consume it **already exist and are complete**; the only blocker is a config action (secret provisioning) that is the Owner's to perform — it is **neither a code gap nor a money gap** (provisioning an existing-plan secret is not a purchase). This doc **re-flags** the request so it is not lost in the "Needs Owner Decision" pile.
- **Rationale**: All four rows share one root cause — a single un-provisioned secret — and the consuming code is already written (Voice Tickets transcription path). The blocker is an Owner action, not engineering work; engineering cannot resolve it by writing code (the code is done) and should not resolve it by incurring spend the Owner hasn't authorized (the key, if it carries usage cost, is a spend decision the Owner owns). Text-only chat remains the current, working fallback per the rows' own Alternative Solutions.
- **Authority basis**: Granted decision authority covers *recognizing* that this is an Owner-action gap and *formally requesting* it (this doc is that request). It does **not** cover the Owner actually performing the provisioning — that is the Owner's action, surfaced here, not pre-empted. Provisioning a key that incurs usage charges would itself be a money decision (bucket (a)) and is not authorized by this doc.
- **Re-score**: the 4 rows move off "Needs Owner Decision" to *Blocked on Owner config action — formally requested* (not closed; unblocked the moment the Owner provisions the secret). No code written.
- **Plan ref**: §2(c) C17 → V2-6.

---

## C18 — Metadata-Driven Platform: **NO ACTION (deliberate strategic non-goal)**

- **CSV row**: `General` / `Low/No-Code Configuration` / **`Metadata Driven Platform`** (frozen status: *Evaluated - Needs Owner Decision*).
- **Decision**: **No action.** A metadata-driven (schema/UI-generated-from-config) platform is an explicit, deliberate strategic non-goal; VERIDIAN remains hand-coded by design. Close the row by recording this.
- **Rationale**: The CSV's Gap Identified is *"No metadata-driven schema/UI generation exists, and this is an explicit, deliberate strategic decision"*, its Recommendation is *"No action needed; revisit only if a future product requirement demands true metadata-driven extensibility"*, and its Alternative Solutions is *"None - current hand-coded approach is the accepted strategy."* The row is "Needs Owner Decision" only because a decision was pending — the decision is *confirm the deliberate non-goal*. The sibling row `Dynamic Engines / Dynamic Forms Engine` (status: *Evaluated - Gap Open*) is consistent with this — *"Accept as consistent with the documented strategic non-goal."*
- **Authority basis**: This is a product-architecture-strategy decision (not money) — within granted authority. It adopts the row's own recommendation verbatim: no action.
- **Re-score**: row moves off "Needs Owner Decision" to *Decided – no action (strategic non-goal)*. No code written.
- **Plan ref**: §2(c) C18 → V2-6.

---

## C19 — Horizontal Scalability (Supabase IPv4): **DO THE FREE HALF — document + open the support-ticket escalation; IPv4 add-on stays deferred on money**

- **CSV row**: `General` / `Performance & Scalability` / **`Horizontal Scalability`** (frozen status: *Evaluated - Needs Owner Decision*).
- **Decision**: **Do the free half now.** (1) Document the recurring Supavisor connection-pooler bug (ENOTFOUND tenant/user error) with its timeline evidence, and (2) prepare the Supabase-support escalation text. The paid remediation — buying Supabase's IPv4 add-on (~$4/mo) — **stays deferred** as a real-money row (§2(a)); it is not authorized by this doc and remains an Owner spend decision.
- **Rationale**: The CSV's Gap Identified names *"a recurring, previously-documented Supavisor connection-pooler bug (ENOTFOUND tenant/user error) [that] has blocked every Drizzle/withTenantContext-based route in production at least once"*, and its Recommendation offers two paths: *"buy Supabase's IPv4 add-on (~$4/mo, sidesteps Supavisor) or escalate to Supabase support with the existing timeline evidence."* Its Recommended Approach is *"Escalate to Supabase support first (free) since IPv4 add-on cost is real but small; keep evidence-driven timeline ready."* The free half (document + escalate) is within decision authority; the paid half (~$4/mo add-on) is real money and stays deferred per §2(a).
- **Authority basis**: Split decision. The free half (documentation + drafting the support-escalation) is within granted decision authority (no money, no code required to *document*). The paid half (IPv4 add-on purchase) is bucket (a) real-money and is **not** authorized here — it stays deferred until the Owner authorizes spend. This doc closes the free half and leaves the paid half on the deferred-on-money pile, disclosed.
- **Re-score**: row's free half moves off "Needs Owner Decision" to *Decided – free half done (documented + escalation prepared); paid half deferred on money*. The documentation itself (this paragraph + the evidence referenced from `PLATFORM_STRATEGY.md` Section 7) **is** the free-half deliverable.
- **Plan ref**: §2(c) C19 → V2-6 (free half only; paid half → §2(a)).

---

## Summary — what this doc closes vs. what it does not

| Row ref | CSV Parameter (short) | Decision | Closes? |
|---|---|---|---|
| D7/D11 | ERP/CRM Integration Readiness | Hold + document; build Tally only on a real sales blocker | Decided (re-opens on sales signal) |
| D9 | FinOps dashboard reconciles engineering cost claims against Finance's ledger | No second independent cost source at current scale | Decided (revisit on spend growth / audit) |
| C13 | Bank integration credential storage security | Target lowered to 3; reuse ai-config-crypto.ts when bank-API is built | Decided (no action until bank-API prioritized) |
| C16 | Market Fit | Deferred — not yet applicable, no paying-customer base | Deferred on applicability (not money) |
| C17 | OPENAI_API_KEY provisioning (4 rows) | Formal Owner-action request; code already exists | Blocked on Owner config action (re-flagged) |
| C18 | Metadata Driven Platform | No action — deliberate strategic non-goal | Decided (strategic non-goal) |
| C19 | Horizontal Scalability (Supabase IPv4) | Do the free half (document + escalate); IPv4 add-on stays deferred on money | Free half decided; paid half deferred (§2(a)) |

**Honest limitations:**
- This doc is the *decision evidence* for the CSV re-score; it is **not** a substitute for the code/build work that other V2 tasks own (V2-10 Sentry check, V2-11 delegation-expiry, V2-15 storage RLS, etc.). Rows closed by *code* are owned by their respective V2 tasks, not here.
- C16 and the paid half of C19 are *deferred*, not *closed* — they are recorded as decisions ("not now" / "not without spend authorization") rather than left ambiguously pending.
- C17 is *blocked on an Owner action*, not closed — this doc surfaces the request but cannot perform the provisioning.
- The frozen-2026-07-16 CSV `Status` column is stale (per v2 §1); the "Re-score" lines above are the intended post-decision statuses, to be applied when the CSV is re-scored. This doc does not edit the CSV itself (it lives in `claude-control/`, a separate repo outside this task's scope).
