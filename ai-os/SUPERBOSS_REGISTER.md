# Superboss Register — Reference

AUDIENCE: AI agents. Machine-parseable structure, not narrative. Deployed 2026-07-20 per Owner directive: no session starts from zero.

## What this is, precisely

Three linked, indexed, full-text-searchable SQLite tables at `/opt/veridian/ai-os/memory/superboss-register.sqlite`, distinct from:
- The AI-work cost-control system (`AI_CACHE_AND_TRIAGE_ARCHITECTURE.md`) — that governs dispatched WORKER tasks (GLM fleet, doc-worker fleet). This register governs the Owner<->Superboss operational dialogue itself, which nothing else tracks.
- `conversations`/`messages` in `schema.ts` — VERI Chat's end-customer product tables, a different population, confirmed by direct inspection before building this (not a duplicate).

## Schema (all three: `[table]` + `[table]_fts` FTS5 shadow + UTM-style tag columns)

- **instructions**: one row per distinct request from the Owner (or any other requester). Columns: `instruction_id` (`INS-YYYYMMDD-HHMMSS-hex`), `ts`, `session_id`, `utm_source/medium/campaign/content/term`, `raw_text`, `metadata_json`, `response_summary`.
- **work_items**: one row per unit of work registered in response. `work_item_id` (`WRK-...`), `instruction_id` FK, `software_task_id` XOR `ai_task_id` (the latter reuses the EXISTING CONTROLLER.yaml task_id verbatim — not reissued, avoids a second ID for the same task), `cache_id`/`ai_cache_id` (references the L1 cache's own key in `glm-response-cache.sqlite` — not a new ID space), UTM tags, `status`.
- **actions**: finest-grained audit trail. `action_id` (`ACT-...`), `work_item_id` FK, `instruction_id` FK, UTM tags, `result`.

## Usage — the CLI, machine JSON in/out

```
python3 /opt/veridian/scripts/superboss-register.py log-instruction --text "..." --source owner --medium ssh_session --campaign <slug> --content <short_tag> --term "<comma,keywords>"
python3 /opt/veridian/scripts/superboss-register.py log-work --instruction-id INS-... --ai-task-id <existing task_id> --content <short_tag> --status completed
python3 /opt/veridian/scripts/superboss-register.py log-action --instruction-id INS-... --content <short_tag> --result success
python3 /opt/veridian/scripts/superboss-register.py search "<keyword>"
```

Two retrieval modes, both proven live tonight: FTS5 full-text (`search <query>`) and structured UTM-tag filtering (direct SQL on `utm_campaign`/`utm_source`/etc. — a real query dimension, not a display label).

## Protocol for any AI session working on this server

1. **At the start of a session/topic**: `search` the register for relevant prior `utm_campaign`/keywords before asking the Owner to repeat context that already exists.
2. **When the Owner gives an instruction**: `log-instruction` before starting work.
3. **When work is registered** (a task dispatched, a script written, a decision made): `log-work`, linked to the instruction that spawned it, with `software_task_id` if no AI call was needed or `ai_task_id` if one was.
4. **For significant individual actions** (a file edited, a script deployed, a check run): `log-action`, linked to the work item.

## Honest status, 2026-07-20

Built and tested tonight: schema, FTS5 search, structured filtering, ID linkage across all three tables — all verified with real inserts and real queries, not assumed. **Not yet enforced by code** — logging happens because an AI agent chooses to call the CLI, not because anything blocks work from proceeding without it. Making that mandatory (e.g., wiring `log-instruction` into the shell entrypoints' own dispatch path) is real, scoped follow-up work, not done this pass.

## Historical import (2026-07-20, `ai-os/scripts/import-memory-history.py`)

79 entries from the local memory index (spanning 2026-06-25 through this session) imported as `work_items` with `status='historical'` and `metadata_json.historical_import=true` — so a historical entry is never confused with a real-time log, and never claims false precision. Import script:
- Parses `- [Title](file.md) — description` lines, extracts a `YYYY-MM-DD` date from filename/description when present (`date_confidence: "explicit"`, 33 of 79) and leaves `ts` at import-time with `date_confidence: "unknown"` when absent (46 of 79) — never guessed.
- Campaign-tags by keyword match against a small, auditable ordered list (software-first: no LLM classification call for a bulk mechanical task).
- Re-runnable: running it again on an updated memory index would re-import (not currently deduplicated against prior imports — if re-run, check for duplicate `source_file` values in `metadata_json` first).

This is a first pass at "the real memory," built from the INDEX line only (title + one-line description), not each memory file's full content — a real, honest depth limit, not the deepest possible import. Deepening specific entries (reading the full file, not just its index line) is real follow-up work if a particular historical topic needs more than the index line provides.
