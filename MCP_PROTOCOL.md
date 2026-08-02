# Veridian AI — MCP Protocol Specification

**Version:** 1.0.0 | **Date:** 2026-06-29 | **Protocol:** MCP 2024-11-05 (JSON-RPC 2.0)

> **CORRECTION (2026-07-15, `ai-os/CONSTITUTION.yaml` DEBT-02):** Only **MCP Server 1** (`/api/mcp`) exists in code today — confirmed live, 9 tools (see `src/app/api/mcp/route.ts`). **MCP Server 2** (the Supabase Edge Function `mcp-dev`, Groq-orchestrator-driven dev dispatch) described throughout this document has ZERO matching code anywhere in this repo — no `mcp-dev` function, no `MCP_DEV_SECRET`, no Groq orchestrator dispatcher. It was never built, or built-then-removed with no record. The sections below describing MCP Server 2 are a design spec for a system that does not exist, not a description of current behavior — treat them as such until/unless it's actually built.

---

## Overview

Veridian AI runs two MCP servers. They serve completely different layers of the AI-OS architecture and must never be confused.

| | MCP Server 1 | MCP Server 2 |
|---|---|---|
| **Name** | Compliance Data MCP | Dev Dispatch MCP |
| **Host** | Vercel Edge (Next.js) | Supabase Edge Function |
| **Endpoint** | `https://veridian-compliance-ai.vercel.app/api/mcp` | `https://<project>.supabase.co/functions/v1/mcp-dev` |
| **Auth** | `Authorization: Bearer <access_token>` | `X-Internal-Secret: <secret>` |
| **Caller** | Customer AI + Groq orchestrator | Groq orchestrator ONLY |
| **Scope** | Reads + writes compliance data | Fires GitHub dispatch events |
| **Runtime** | Vercel Edge (V8 isolate) | Supabase Edge (Deno) |
| **Public?** | Yes — any authorized token | No — internal secret only |

---

## Information Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2 — Customer's Own AI                                    │
│  (Claude Desktop / ChatGPT / any MCP client)                   │
└───────────────────────┬─────────────────────────────────────────┘
                        │  Bearer <access_token>
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  MCP SERVER 1 — Compliance Data                                 │
│  POST https://veridian-compliance-ai.vercel.app/api/mcp         │
│  Runtime: Vercel Edge | Data: Supabase PostgreSQL              │
│  Tools: list_compliance_items, get_stats, get_overdue_items,   │
│         create_compliance_item, update_compliance_status,       │
│         list_departments, get_penalty_estimate                  │
└───────────────────────┬─────────────────────────────────────────┘
                        │  Supabase JS (fetch / HTTP)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase PostgreSQL + pgvector                                 │
│  Schema: compliance | RLS: scoped by org_id                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1 — Groq Orchestrator (Llama 3.3 70B Versatile 128k)   │
│  Acts as MCP CLIENT for BOTH servers                           │
└──────────┬────────────────────────────┬────────────────────────┘
           │ Bearer <access_token>      │ X-Internal-Secret
           ▼                            ▼
   MCP Server 1                  MCP Server 2
   (reads compliance data)       (fires dev tasks)
                                        │
                                        │ GitHub repository_dispatch
                                        ▼
                         ┌──────────────────────────┐
                         │  GitHub Actions           │
                         │  event: claude-task       │ → Claude Code
                         │  event: zai-task          │ → Z.ai GLM
                         └──────────────────────────┘
```

---

## Coordination Rules

These rules govern how the two MCP servers coordinate. Any agent reading this must follow them.

### Rule 1 — Separation of Concerns
MCP Server 1 handles **data**. MCP Server 2 handles **development dispatch**.  
Neither server calls the other. Only the Groq orchestrator may call both.

### Rule 2 — Customer AI Scope
A customer's AI (connected via their own API key) may only call **MCP Server 1** using their org-scoped Bearer token. They have zero access to MCP Server 2. Row Level Security in Supabase enforces this — a token can only read/write data for its own `org_id`.

### Rule 3 — Orchestrator Scope
The Groq orchestrator calls MCP Server 1 when it needs **compliance data** to reason about.  
It calls MCP Server 2 when it needs to **dispatch a build task** to Claude Code or Z.ai.  
The orchestrator holds the `MCP_DEV_SECRET` internally — it is never exposed to customers.

### Rule 4 — Dev Task Routing
When the Groq orchestrator calls `create_claude_task` or `create_zai_task`:
- The payload fires a `repository_dispatch` to `FChecklist/compliance-tracker`
- GitHub Actions picks it up and assigns to the correct agent (AGENTS.md)
- SENTINEL.yaml governs all resulting PRs — no agent merges its own code
- The BOARD.yaml is updated by the agent upon task start

**Claude Code** gets: architecture decisions, backend/DB changes, security fixes, code reviews  
**Z.ai** gets: frontend features, UI components, new API routes, full-stack features

### Rule 5 — Auth Token Lifecycle (Wave 10: unified with the rest of the platform)
MCP access is via the same org-scoped `vk_...` API keys used everywhere else external, stored (SHA-256 hashed) in `compliance.api_keys`.  
- Generated via **Settings → API Keys** in the app, or `POST /api/settings/api-keys` (admin-only, requires Supabase session)
- Choose `read` or `write` scope — MCP's write tools (`create_compliance_item`, `update_compliance_status`) require a `write`-scoped key
- Key value shown **once** at generation — not retrievable again
- Revoked by deactivating it in Settings
- `last_used_at` updated on every MCP call for audit
- The old `POST /api/mcp/tokens` (a separate `mcp_access_codes` token system) is deprecated and now returns `410` — any already-issued token from that path still works for `GET`/`DELETE` (view/revoke), but `/api/mcp` itself no longer accepts it

### Rule 6 — MCP Dev Secret Rotation
`MCP_DEV_SECRET` is stored as:
- Supabase Edge Function secret: `MCP_DEV_SECRET`
- Groq orchestrator environment: `MCP_DEV_SECRET`
- NOT in `.env`, NOT committed to git
Rotate by updating both locations simultaneously.

### Rule 7 — Idempotency
`create_claude_task` and `create_zai_task` fire GitHub dispatch events.  
GitHub dispatch has no built-in deduplication. The orchestrator must not fire duplicate tasks for the same work. Use `get_board_status` to check open tasks before dispatching.

### Rule 8 — Error Propagation
Both MCP servers return JSON-RPC 2.0 errors on failure:
- `-32600` — Invalid request / Unauthorized
- `-32601` — Method not found
- `-32700` — Parse error
- `-32000` — Tool execution error (details in `message`)

The Groq orchestrator must handle errors gracefully — log them, do not retry blindly.

---

## MCP Server 1 — Tool Reference

**Endpoint:** `POST https://veridian-compliance-ai.vercel.app/api/mcp`  
**Auth:** `Authorization: Bearer <access_token>`

### `list_compliance_items`
```json
{ "status": "overdue", "compliance_type": "GST", "page": 1, "limit": 20 }
```
Returns compliance items filtered by status, type, department, or search term.

### `get_compliance_stats`
```json
{}
```
Returns total, overdue, completed, dueThisWeek counts + department breakdown.

### `get_overdue_items`
```json
{}
```
Returns all overdue items with `daysLate` and `penaltyEstimate` per Indian compliance defaults.

### `create_compliance_item`
```json
{
  "title": "GSTR-3B July 2026",
  "compliance_type": "GST",
  "department_id": "<dept_id>",
  "due_date": "2026-08-20T00:00:00Z",
  "priority": "high"
}
```

### `update_compliance_status`
```json
{ "id": "<item_id>", "status": "completed" }
```

### `list_departments`
```json
{}
```

### `get_penalty_estimate`
```json
{ "compliance_type": "GST", "days_late": 45 }
```
Returns estimated penalty, rate label, and disclaimer. Values are indicative only.

---

## MCP Server 2 — Tool Reference

**Endpoint:** `POST https://<project>.supabase.co/functions/v1/mcp-dev`  
**Auth:** `X-Internal-Secret: <MCP_DEV_SECRET>`  
**Access:** Internal only — Groq orchestrator

### `create_claude_task`
```json
{
  "title": "Add pgvector semantic search to compliance items",
  "description": "Enable vector embeddings on compliance_items.title+description. Expose search_compliance tool in MCP Server 1.",
  "priority": "high",
  "files_hint": ["src/lib/db/schema.ts", "src/app/api/mcp/route.ts"]
}
```

### `create_zai_task`
```json
{
  "title": "MCP Token Management UI",
  "description": "Add a Settings > API Tokens page where admin users can generate and revoke MCP access tokens.",
  "priority": "medium"
}
```

### `health_check`
```json
{}
```
Pings the Vercel app (`/api/health`) and Supabase DB simultaneously. Returns `{ app, database, checkedAt }`.

### `get_board_status`
```json
{}
```
Fetches `ai-os/boss/BOARD.yaml` from GitHub and returns its raw content. Use before dispatching a task to avoid duplicates.

### `get_deployment_status`
```json
{}
```
Returns last 5 GitHub Actions workflow runs with status and conclusion.

---

## Setup Instructions

### Step 1 — No migration needed
MCP now reuses the `compliance.api_keys` table that already exists for Settings > API Keys — nothing new to create.

### Step 2 — Set required env vars
**Vercel** (already set — no new vars needed):
- `NEXT_PUBLIC_SUPABASE_URL` ✓
- `SUPABASE_SERVICE_ROLE_KEY` ✓

**Supabase Edge Function secrets** (set via Supabase dashboard → Edge Functions → mcp-dev → Secrets):
```
SUPABASE_URL=<your project URL>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
PAT_FCHECKLIST=<GitHub PAT — already in GitHub Secrets>
MCP_DEV_SECRET=<generate with: openssl rand -hex 32>
```

**Groq orchestrator** (when built):
```
MCP_DATA_URL=https://veridian-compliance-ai.vercel.app/api/mcp
MCP_DATA_TOKEN=<key generated via Settings > API Keys, write scope>
MCP_DEV_URL=https://<project>.supabase.co/functions/v1/mcp-dev
MCP_DEV_SECRET=<same as above>
```

### Step 3 — Deploy the Edge Function
```bash
supabase functions deploy mcp-dev --project-ref <project-ref>
```

### Step 4 — Generate your first MCP access key
Via the app: **Settings → API Keys → Generate key**, choose `read` or `write` scope.

Or via API (requires an active session cookie, same as any other admin action):
```bash
curl -X POST https://veridian-compliance-ai.vercel.app/api/settings/api-keys \
  -H "Cookie: <your session cookie>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Groq Orchestrator", "scopes": "read,write"}'
```
Save the returned key — it will not be shown again.

### Step 5 — Connect your AI client
**Claude Desktop** (`~/.config/claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "compliancetrack": {
      "url": "https://veridian-compliance-ai.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer <your_token>" }
    }
  }
}
```

**Custom AI / Groq orchestrator** — POST to `/api/mcp` directly:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_overdue_items",
    "arguments": {}
  }
}
```

---

## What's Next (pgvector)

Once `CREATE EXTENSION IF NOT EXISTS vector;` is run in Supabase, MCP Server 1 will gain:

### `search_compliance` (planned — M-07 in features_to_be_added_claude.md)
```json
{ "query": "GST late fee circular July 2026", "limit": 5 }
```
Performs semantic similarity search across all compliance items using pgvector embeddings.  
Embeddings are generated on item create/update via the Groq orchestrator.

---

*This document is the source of truth for MCP coordination. Update it when tools are added or rules change.*
