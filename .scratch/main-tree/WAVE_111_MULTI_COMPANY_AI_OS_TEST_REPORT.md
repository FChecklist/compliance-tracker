# Wave 111 — Multi-Company AI-OS End-to-End Test

## Scope and how this wave actually ran

The original ask was end-to-end testing of the full VERIDIAN AI OS across 5 demo companies using real OpenRouter calls within a $2 budget. Mid-wave the instruction changed twice: first the scale doubled to 10 companies × 100 people, then OpenRouter was dropped entirely in favour of using this Claude Code Desktop session itself as the reasoning engine for Layers 1–4, "for depth and understanding." This report reflects the final scope actually executed.

**What this wave is, honestly:** a large-scale multi-tenant data seed (10 companies, 1,000 people) plus a curated, representative sample of AI-layer reasoning done directly by Claude rather than routed through a model API. It is not an exhaustive test of every one of the 500 staff or every screen — that would be pure volume without added signal. It *is* a genuine test of whether the platform's schema, tenant isolation, and AI-output shapes hold up under realistic multi-industry load, plus real bug-finding.

## 1. The 10 demo companies

Each company profile was picked to exercise a different combination of VERIDIAN's product branches, spanning every major built module:

| # | Company | Industry | Product branches exercised |
|---|---|---|---|
| 1 | Sharma & Associates LLP | CA/Tax/Legal practice firm | THE FIRM, Compliance/GRC core |
| 2 | Meridian Auto Components Pvt Ltd | Auto parts manufacturing | ERP (customers) |
| 3 | Campus Facilities Services Pvt Ltd | Facilities management provider | FM & CS |
| 4 | Velocity Softworks Pvt Ltd | SaaS/tech | PMS |
| 5 | Apex Consulting Group | Strategy consulting | Core + Sales Engine potential |
| 6 | Horizon Freight & Logistics Pvt Ltd | Logistics/freight | ERP (customers) |
| 7 | Grand Vista Hotels Pvt Ltd | Hospitality | FM & CS |
| 8 | Skyline Construction Co | Construction | PMS |
| 9 | Rise Academy Trust | Education | Core GRC/HR |
| 10 | Wellness Care Hospitals Pvt Ltd | Healthcare | Core GRC/HR/Legal |

Each company got: 5 departments, 50 staff (2 Directors, 4 HODs, 6 Managers, 8 Senior Consultants, 15 Executives, 10 Associates, 5 Third-Party Associates), 50 CRM customer leads, 15 compliance items, 2 meetings, 5 support tickets, and company-specific extras (THE FIRM clients for Sharma & Associates, ERP customers for the two logistics/manufacturing companies). **10 companies × 100 people = 1,000 personas, seeded entirely via set-based SQL (`generate_series`), not row-by-row — the only way this scale was tractable in one session.** 20 real Supabase Auth logins were created (director + first HOD per company, password `DemoVeridian2026!`) for future browser verification.

## 2. Real technical blockers hit, and how they were resolved

- **OpenRouter/DATABASE_URL are Vercel Sensitive env vars** — confirmed empty when pulled locally (`vercel env pull` returns blank placeholders for both, by Vercel design). This blocked (a) encrypting a real BYOK key for per-org model routing, and (b) any locally-run route that imports the raw `db` client. The user resolved (a) by pasting the real OpenRouter key directly for one-time use, then pivoted the whole test away from OpenRouter entirely.
- **The app's own `/api/settings/model-config` route requires the caller to supply the plaintext API key** — there's no way to set "use platform key but a different model" for a single org. This remains a real, unaddressed gap in the BYOK model-config UX (documented here, not fixed this wave — fixing it wasn't the point of this test and risks touching a security-sensitive path without focused attention).
- **The Claude Preview browser tool is scoped to the local dev server only** — navigating to the production Vercel URL via `window.location.href` silently no-ops back to `localhost`. This meant real UI/API plumbing testing was only possible against the DB-blocked local server, so browser-based verification of the actual request/response cycle was not achievable in this session with the available tools. Direct SQL verification via Supabase MCP and Vercel's `get_runtime_errors` monitor were used instead.

## 3. AI-layer reasoning tests actually performed (by Claude, standing in for the model)

Given the layers map cleanly onto real `orchestra_layers` rows (`layer_order` 1–4: `task_oa`, `user_assistant_oa`, `customer_account_oa`, `global_intelligence_oa`):

- **L3 (`customer_account_oa` — meeting/document intelligence):** for all 10 companies, reasoned through the seeded meeting minutes exactly as `veri-meeting-service.ts`'s real LLM call would, writing `ai_summary`/`ai_key_decisions`/`ai_suggested_action_items` and publishing the meeting. Full 10/10 coverage since this is the real, already-built code path.
- **L1 (`task_oa` — CRM lead scoring, the real call site in `crm-service.ts`):** for one representative qualified lead per company (10/10), wrote a genuinely differentiated `ai_score`/`ai_score_reasoning`/`ai_recommended_action` per industry — e.g. Sharma & Associates' lead reasoned as a recurring-compliance prospect (score 78), Wellness Care Hospitals' identical-shaped lead reasoned as a likely vendor/partnership inquiry needing clarification, not a patient lead (score 69). Not templated — the reasoning genuinely differs by business context.
- **L2 (`user_assistant_oa` — VERI Chat):** for 3 companies (Sharma & Associates, Velocity Softworks, Wellness Care Hospitals), simulated a real human query ("show me whats overdue") against the actual seeded compliance data and wrote a grounded assistant reply citing the real overdue items and their real priority.
- **L4 (`global_intelligence_oa` — meta/evolution):** **confirmed to have zero real call sites anywhere in the codebase.** Nothing calls `resolveModelConfig(orgId, "global_intelligence_oa")`. This is a genuine, previously-undocumented gap: the layer exists in the `orchestra_layers` catalog but no service ever invokes it. Given there was no real schema target to write a synthesized cross-tenant insight into without misrepresenting it as coming from a real pipeline, this is documented here rather than faked into a DB row: **L4 is architecturally aspirational, not yet wired to any actual capability.**

## 4. Bug found and fixed

**Home dashboard silently reports "you're in good shape — nothing overdue" when the stats fetch actually failed**, not when there's genuinely nothing overdue.

- `src/app/(app)/home/page.tsx` fetched `/api/compliance/stats` with `.catch(() => {})`, leaving `stats` at its initial `null`. The briefing line then computed `stats?.overdue ?? 0`, which produces the exact same `0` whether the org has zero overdue items *or* the API call failed for any reason (timeout, transient DB blip, pooler exhaustion). Reproduced directly: every one of the 10 seeded companies has 3 real `overdue` compliance items, yet Sharma & Associates' Managing Director dashboard said "nothing overdue" — because the local dev environment's known DATABASE_URL constraint made the stats call 500, and the failure was swallowed silently.
- **This is not merely a local-dev artifact.** The same code pattern would produce the identical false reassurance in production if `/api/compliance/stats` ever failed for any transient reason. In a compliance product, telling a user "you're all clear" when the system actually couldn't check is a worse failure mode than showing no answer at all.
- **Fix applied:** added a `statsError` state, set on fetch failure (checking `r.ok` before parsing, not just catching parse errors), and the briefing line now has a distinct, honest message for the error case ("I couldn't check what's overdue just now... I don't want to tell you 'you're all clear' without actually knowing") instead of falling through to the same path as a genuine zero-overdue org. Verified clean via `tsc --noEmit` and `eslint`.

## 5. What this wave did NOT do (explicit, so scope is honest)

- Did not exercise all 500 staff or all 500 customer leads individually — a representative sample per company was reasoned through at genuine depth instead.
- Did not test VERI FDE, FM register digitization, or Policy Enforcement Engine scenarios this wave (time was spent on the seed-scale pivot, the tooling-constraint discovery, and the one real bug found+fixed instead).
- Did not verify the deployed app via real browser clicks — blocked by the preview tool being local-only and local being DB-blocked (see §2). `get_runtime_errors` confirms zero production errors in the 2 hours spanning this wave's DB writes, which is reassuring but not the same as a real click-through.
- Spent $0 of the original $2 OpenRouter budget — the whole test pivoted away from real model calls per the user's own instruction.

## 6. Recommendation for a future wave

If deeper real-pipeline testing is wanted next: (a) fix the BYOK model-config route to accept "override model, inherit platform key" so per-org OpenRouter routing doesn't require the raw key to pass through chat again, (b) either wire `global_intelligence_oa` to a real capability or remove it from the catalog until it has one, (c) do real HTTP-level testing against the deployed Vercel URL directly (via `curl`/fetch rather than the local-only preview browser tool) to actually exercise API route plumbing, not just DB state.
