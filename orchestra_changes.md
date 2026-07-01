# Orchestra Changes Log — VERIDIAN AI Orchestra Transformation

This is the running plan + change log for turning `compliance-tracker` into VERIDIAN AI Orchestra. See [analysis.md](analysis.md) for the Phase 1 discovery (schema map, feature map, gap analysis) this plan is based on.

**Status: PLANNING ONLY. Nothing below has been executed yet.** Per instruction, order of execution once approved is: **GitHub (code/schema/docs) → Supabase (data/migrations) → Vercel (deploy)**, one change at a time, with a log entry appended here after each one.

---

## Open decisions needed from you before execution starts

1. **§A hierarchy scope:** Does "Customer Account" (firm) vs "Client" (who the firm services) need to exist from day one, or is single-entity mode (org = client = account) acceptable for a first cut, with the firm/client split added later? This changes the tenant key on almost every table, so it's cheaper to decide once, up front.
2. **RLS-first sequencing:** analysis.md flags that there is currently zero database-level RLS and the app relies entirely on hand-written `orgId` filters (the MCP route explicitly uses a service-role client that bypasses RLS by design). Recommendation: fix tenant isolation at the schema level (RLS + tenant key) as Wave 1, before building the 4-tier agent/loop tables on top of it. Confirm you want this order.
3. **Relationship to existing `ai-os/` governance layer:** `CLAUDE.md` forbids touching `ai-os/`, `CLAUDE.md`, `AGENTS.md`, `SENTINEL.md`. The new Orchestra Layer / Loop tables (master prompt §E/§F) are conceptually adjacent to what `ai-os/BOARD.yaml` and `ENGINES.yaml` already do (task tracking, agent authorization) but as static YAML rather than measured DB telemetry. Should Orchestra loops be a new, separate system, or should `ai-os/` be migrated into it (which would require revisiting the "don't touch" rule with you explicitly)?
4. **`ai_configurations` / BYOK route:** currently a non-persistent in-memory stub with base64 "obfuscation," ignoring the real `ai_configurations` DB table that already has an `encryptedApiKey` column. Fixing this is small, self-contained, and valuable regardless of how the bigger Orchestra rebuild goes — candidate for an early, low-risk win.

---

## Proposed Wave Plan (pending approval)

### Wave 0 — Foundation fixes (small, low-risk, high value regardless of Orchestra scope)
- Wire `/api/settings/ai-config` to the real `ai_configurations` table with real encryption (pgcrypto), per-user not just per-org.
- Add `orgId`/tenant-key indexes that are currently missing.

### Wave 1 — Tenant isolation at the schema level (blocks everything else per analysis.md §"Critical sequencing flag")
- Resolve open decision #1 (hierarchy scope).
- Add RLS policies to every existing table, keyed to the resolved tenant hierarchy.
- Add `customer_account_id` / `client_id` columns where the hierarchy decision requires it.

### Wave 2 — AI Assistant System (§B)
- `ai_assistants` (5/user), `assistant_memories` (pgvector, reusing the existing `lib/embeddings.ts` pattern), `assistant_sessions`, `assistant_metrics_daily`.

### Wave 3 — Worker Agent Library (§C)
- `worker_agents` (4-tier), versions, usage log, learnings — extending the existing MCP `handleTool` execution substrate rather than replacing it.

### Wave 4 — Task System + Orchestra Layers (§D/§E)
- Generalize the existing `ingestion_batches`/`ingestion_items` plan→review→confirm pattern into `tasks`/`task_execution_plan`/`task_agent_executions`.
- `orchestra_layers`, `customer_model_config` (per-layer BYO model), extending the existing `ai_provider` enum.

### Wave 5 — Self-Improvement Loops + Knowledge Flow (§F/§G)
- Only after Wave 1 RLS is in place (per analysis.md's sequencing flag — knowledge flowing between tiers must not be able to leak across tenants).

### Wave 6 — Supabase migration + Vercel deploy
- Apply all migrations to Supabase, verify RLS with the `get_advisors` tool, then deploy.

---

## Change Log

*(empty — nothing executed yet; entries will be appended here one per change, in the order: GitHub commit → Supabase migration → Vercel deploy, once you approve a wave to start)*

| # | Date | Layer | Change | Commit/Migration ref | Notes |
|---|------|-------|--------|----------------------|-------|
| — | — | — | — | — | Awaiting go-ahead on Wave 1 decisions above |
