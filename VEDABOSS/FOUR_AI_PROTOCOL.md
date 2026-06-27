# Four-AI GitHub Coordination Protocol

**Repo:** https://github.com/FChecklist/compliance-tracker  
**Superboss:** VEDABOSS (runs on **Claude Code only**)

---

## The rule

GitHub is the **only** shared brain. The four engines never coordinate in chat with each other — they read and write files in `VEDABOSS/`.

| File | Purpose |
|------|---------|
| `VEDABOSS/WORK_ASSIGNMENTS.json` | Task board — who does what, status, dependencies |
| `VEDABOSS/AI_ENGINES.json` | Which AI engine is online, token limits, check-ins |
| `VEDABOSS/AGENT_REGISTRY.json` | 12 virtual agent roles (DEV_1, QC, UI_UX, etc.) |
| `VEDABOSS/AGENT_PROMPTS.json` | Copy-paste prompts to start a worker session |
| `VEDABOSS/VEDABOSS_MANUAL.json` | Claude Code prompt to run as VEDABOSS |
| `VEDABOSS/INTEGRATION_LOG.json` | Log when approved work is merged into main codebase |
| `ai-instructions/compliance_tracker_progress.json` | 48-step build progress |

---

## Roles

```
                    ┌─────────────────┐
                    │  Claude Code    │
                    │   (VEDABOSS)    │
                    │  assign · approve│
                    │  integrate      │
                    └────────┬────────┘
                             │ writes WORK_ASSIGNMENTS.json
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
    ┌─────────┐         ┌─────────┐         ┌─────────┐
    │  z.ai   │         │ Cursor  │         │  Codex  │
    │ backend │         │ frontend│         │   QC    │
    │ product │         │ design  │         │  tests  │
    └────┬────┘         └────┬────┘         └────┬────┘
         │                   │                   │
         └───────────────────┴───────────────────┘
                             │
                    GitHub commits + pull
```

---

## Daily loop (each engine)

### Workers (z.ai, Cursor, Codex)

1. `git pull origin main`
2. Read `VEDABOSS/AI_ENGINES.json` — confirm you are `available`
3. Read `VEDABOSS/WORK_ASSIGNMENTS.json` — find task where `executed_by` matches your engine OR `assigned_to` matches your agent role and `status` = `assigned`
4. Read your agent manual under `agents/<AGENT>/`
5. Do **one small task** — save output to `agents/<AGENT>/output/` only
6. Update `WORK_ASSIGNMENTS.json`: `status` = `completed`, `files_created`, `completed_at`
7. Update `AI_ENGINES.json`: `last_check_in`, clear `current_task_id`
8. `git commit -m "[ENGINE] Completed <task_id>"` and `git push`
9. **STOP** — wait for VEDABOSS to assign next task

### VEDABOSS (Claude Code)

1. `git pull origin main`
2. Read `WORK_ASSIGNMENTS.json` + `AI_ENGINES.json`
3. For each `completed` task → send to Codex QC if needed → `approved` or send back
4. Integrate approved files from `agents/*/output/` into monorepo root (log in `INTEGRATION_LOG.json`)
5. Assign **small** next tasks — one per available engine, update `executed_by` field
6. Commit + push board updates

---

## Token limit hit

When any engine runs out of context/tokens:

```json
// In VEDABOSS/AI_ENGINES.json → availability.<engine>
{
  "status": "paused",
  "token_status": "exhausted",
  "limit_resets_at": "2026-06-27T08:00:00Z",
  "note": "Hit daily limit. Partial work saved in agents/DEV_1/output/. Step 3 half done."
}
```

VEDABOSS reads this and either waits or reassigns the task to another engine.

---

## Task size rule

VEDABOSS must assign tasks small enough to finish in **one AI session**:

- ✅ Good: "DEV_1 Step 3 — create packages/types enums.ts and organisation.ts"
- ❌ Bad: "Build entire foundation steps 1-9"

Large task IDs (T-D1-001) stay on the board; VEDABOSS splits them using `sub_progress` and assigns one build step at a time.

---

## Suggested engine mapping (Wave 1)

| Engine | Current assignment |
|--------|-------------------|
| **Claude Code** | VEDABOSS — coordinate, assign, integrate |
| **z.ai** | T-M1 PRODUCT decisions, then DEV_1 step 3+ |
| **Cursor** | Resume T-D1-001 (step 3 shared types) or DEV_4 later |
| **Codex** | Standby → T-M3 QC when DEV_1 completes |

---

## Commit message format

```
[VEDABOSS] Assigned T-D1-step3 to cursor
[CURSOR] DEV_1 step 3/9 — shared types enums + organisation
[ZAI] [PRODUCT] Completed T-M1 — product decisions
[CODEX] [QC] Reviewed DEV_1 — verdict: pass
```

---

## Human operator

You only need to:

1. Open each AI tool when VEDABOSS assigns it work (or on a schedule)
2. Paste the prompt from `AGENT_PROMPTS.json` or `VEDABOSS_MANUAL.json`
3. Tell engines when token limits reset (or they self-report in `AI_ENGINES.json`)

Everything else is in GitHub.
