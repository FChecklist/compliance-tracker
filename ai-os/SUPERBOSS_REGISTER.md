# Superboss Register — Reference

AUDIENCE: AI agents. Machine-parseable structure, not narrative. Deployed 2026-07-20 per Owner directive: no session starts from zero.

## What this is, precisely

Four linked, indexed, full-text-searchable SQLite tables at `/opt/veridian/ai-os/memory/superboss-register.sqlite`, distinct from:
- The AI-work cost-control system (`AI_CACHE_AND_TRIAGE_ARCHITECTURE.md`) — that governs dispatched WORKER tasks (GLM fleet, doc-worker fleet). This register governs the Owner<->Superboss operational dialogue itself, which nothing else tracks.
- `conversations`/`messages` in `schema.ts` — VERI Chat's end-customer product tables, a different population, confirmed by direct inspection before building this (not a duplicate).

## Schema (all four: `[table]` + `[table]_fts` FTS5 shadow; first three carry UTM-style tag columns)

- **instructions**: one row per distinct request from the Owner (or any other requester). Columns: `instruction_id` (`INS-YYYYMMDD-HHMMSS-hex`), `ts`, `session_id`, `utm_source/medium/campaign/content/term`, `raw_text`, `metadata_json`, `response_summary`.
- **work_items**: one row per unit of work registered in response. `work_item_id` (`WRK-...`), `instruction_id` FK, `software_task_id` XOR `ai_task_id` (the latter reuses the EXISTING CONTROLLER.yaml task_id verbatim — not reissued, avoids a second ID for the same task), `cache_id`/`ai_cache_id` (references the L1 cache's own key in `glm-response-cache.sqlite` — not a new ID space), UTM tags, `status`.
- **actions**: finest-grained audit trail. `action_id` (`ACT-...`), `work_item_id` FK, `instruction_id` FK, UTM tags, `result`.
- **system_index**: one row per real mechanism that already exists in the system (a script, a TS module, a DB table, a doc section) — built 2026-07-20 to fix the root cause of repeatedly picking the wrong file/table/logic: there was no way to search "does this already exist" before building. Columns: `index_id` (`IDX-YYYYMMDD-HHMMSS-hex`), `ts`, `path` (UNIQUE — the upsert key), `category` (e.g. `cache`, `guardrail`, `validation`, `classification`, `task_register`, `monitor`, `dispatch_entrypoint`), `layer` (`shell`/`typescript`/`database`/`documentation`), `status` (`live`/`partial`/`designed_not_built`/`dead`), `purpose`, `utm_term`, `calls`, `called_by`, `verified_ts`, `metadata_json`. Re-running `index-add` on the same `path` UPDATEs the existing row (real upsert, verified: re-adding `master-decompose.py` after fixing it produced 1 row, not 2) — so re-verifying a mechanism never creates a duplicate entry.

## Usage — the CLI, machine JSON in/out

```
python3 /opt/veridian/scripts/superboss-register.py log-instruction --text "..." --source owner --medium ssh_session --campaign <slug> --content <short_tag> --term "<comma,keywords>"
python3 /opt/veridian/scripts/superboss-register.py log-work --instruction-id INS-... --ai-task-id <existing task_id> --content <short_tag> --status completed
python3 /opt/veridian/scripts/superboss-register.py log-action --instruction-id INS-... --content <short_tag> --result success
python3 /opt/veridian/scripts/superboss-register.py search "<keyword>"
python3 /opt/veridian/scripts/superboss-register.py index-add --path <path> --category <cat> --layer <layer> --status <status> --purpose "<text>" --term "<comma,keywords>" [--calls "<...>"] [--called-by "<...>"]
python3 /opt/veridian/scripts/superboss-register.py check-duplicate "<query>" [--category <cat>]
```

Three retrieval modes, all proven live: FTS5 full-text (`search <query>`, `check-duplicate <query>`), structured UTM-tag filtering (direct SQL on `utm_campaign`/`utm_source`/etc.), and `check-duplicate`'s category filter for a scoped "does this already exist" check before building anything new. `check-duplicate` returns `{"found": N, "verdict": "STOP -- existing mechanism(s) found, review before building" | "no existing match found -- safe to proceed, but this is not exhaustive", "matches": [...]}` — **run this before writing any new script, table, or service**, not just before logging one.

### FTS5 matching note (bug fixed 2026-07-20)

`search`/`check-duplicate` strip stopwords and OR-join the remaining query terms (`_fts_query()` in the script) rather than passing the raw query straight to FTS5 MATCH. Reason: FTS5's default MATCH is an implicit AND across space-separated terms, which produced a real false negative (`check-duplicate 'software vs AI classification' --category classification` returned 0 matches against 3 real matching rows, because "vs" wasn't indexed anywhere). Fixed and re-verified (11 correct matches on retest) — a forgiving, discovery-oriented OR search is the intended behavior for "does this already exist," where a strict AND would systematically undercount and give false confidence that nothing exists.

## Protocol for any AI session working on this server

1. **At the start of a session/topic**: `search` the register for relevant prior `utm_campaign`/keywords before asking the Owner to repeat context that already exists.
2. **When the Owner gives an instruction**: `log-instruction` before starting work.
3. **When work is registered** (a task dispatched, a script written, a decision made): `log-work`, linked to the instruction that spawned it, with `software_task_id` if no AI call was needed or `ai_task_id` if one was.
4. **For significant individual actions** (a file edited, a script deployed, a check run): `log-action`, linked to the work item.

## Honest status, 2026-07-20

Built and tested: schema, FTS5 search, structured filtering, ID linkage across `instructions`/`work_items`/`actions` — all verified with real inserts and real queries, not assumed. `system_index` added same day, seeded with 26 real, individually-verified mechanisms (not guessed), and used live to find and fix two real unprotected entrypoints (`supervisor-entrypoint.sh`, `master-decompose.py`) with zero duplication of either fix. **Still not yet enforced by code** — logging (and checking `check-duplicate` before building) happens because an AI agent chooses to call the CLI, not because anything blocks work from proceeding without it. Making that mandatory (e.g., wiring `log-instruction`/`check-duplicate` into the shell entrypoints' own dispatch path, or into a pre-commit-style gate) is real, scoped follow-up work, not done this pass.

Known real gaps, not glossed over: `software_task_id` has never been populated (0 rows — no software-only task logged that way yet); the status vocabulary (`pending`/`blocked`/`deprecated`) has never been used (only `historical`/`completed`/`live`/`partial`/`designed_not_built`/`dead` exist as real values across the four tables); this register (SQLite, on this Hetzner box) is architecturally unreachable from the TypeScript/Vercel application code (`mother-router.ts`, `team-service.ts` — confirmed via `grep -rln 'superboss-register' src/` returning zero matches) — closing that requires either a Supabase migration or a bespoke API bridge, not yet decided or built; and TASK-05 (`mid_session_self_check` in `CONSTITUTION.yaml`) confirms this register's use in an interactive Superboss/Tier-4 session (i.e. right now) is voluntary discipline only, with zero code-level enforcement.

## Historical import (2026-07-20, `ai-os/scripts/import-memory-history.py`)

79 entries from the local memory index (spanning 2026-06-25 through this session) imported as `work_items` with `status='historical'` and `metadata_json.historical_import=true` — so a historical entry is never confused with a real-time log, and never claims false precision. Import script:
- Parses `- [Title](file.md) — description` lines, extracts a `YYYY-MM-DD` date from filename/description when present (`date_confidence: "explicit"`, 33 of 79) and leaves `ts` at import-time with `date_confidence: "unknown"` when absent (46 of 79) — never guessed.
- Campaign-tags by keyword match against a small, auditable ordered list (software-first: no LLM classification call for a bulk mechanical task).
- Re-runnable: running it again on an updated memory index would re-import (not currently deduplicated against prior imports — if re-run, check for duplicate `source_file` values in `metadata_json` first).

This is a first pass at "the real memory," built from the INDEX line only (title + one-line description), not each memory file's full content — a real, honest depth limit, not the deepest possible import. Deepening specific entries (reading the full file, not just its index line) is real follow-up work if a particular historical topic needs more than the index line provides.
