# ICP rounds: log

Each round: FIX -> TEST -> AUDIT (fresh independent read-only auditor). Verdict lines are copied from the auditor's own report.

## Round 1: IDENTIFY + CLASSIFY + weekly record (migration 0761)

**Fixed / built**
- `drizzle/0761`: `dpdp.icp_item` register (names of things only; e-mail/phone-like names refused), classification columns, `icp_item_flags` derived flags, `dpdp_icp_apply_rules` (children's-data jobs switched ON, never off), `dpdp.icp_run` append-only weekly record, `dpdp_icp_status` checklist, History-chain advisory lock. Data sets mirror into `dpdp.data_category` / `data_location` so the AI link's data-map read and the CA client list see the register.
- App: `IcpWeek` screen (three stages, register, classify editor), offline mock engine `icp-mock.ts`, API calls. The Discover/Act/Confirm draft (PR 2206) and its proposed migration 0760 are replaced.

**Tests (run locally, `--isolate`)**
- `src/lib/services/dpdp-icp-identify-classify.pglite.test.ts`: 20 pass (incl. a 288-case TS/SQL parity run of the flag rules, with and without a parent answer; migration runs twice; rollback).
- `dpdp-app/src/lib/icp.test.ts`: 26 pass.
- `tsc --noEmit` on dpdp-app: clean.
- `dpdp-app/e2e/icp-week.spec.ts`: written; NOT run locally (needs a build and Chromium with > 2 GB free RAM); CI is the proof surface.

**Audit 1**: (pending)
