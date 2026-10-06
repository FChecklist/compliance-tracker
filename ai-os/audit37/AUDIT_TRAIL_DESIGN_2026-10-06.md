# One shared audit trail: design spec (2026-10-06)

Status: DESIGN ONLY. No migration applied, nothing deployed, no code. Author: Claude session, 2026-10-06.
Products: PROJEXA (low security, keep it small), VERIDIAN-AIOS DPDP app, Corporate Tambola.
Method: read the repo and the live database read-only (project `pcrjmlpuqsbocqfwoxod`, column lists only, no row data). Anything I did not verify is marked UNKNOWN.

## 0. Summary in plain words

- Most of the stamp already exists. We should add columns to what exists, not build a new system.
- Recommend ONE shared "envelope" (a fixed list of stamp fields, section 1) used by all three products, written to three stores because the three products live in three databases:
  - PROJEXA and the central app: `compliance.audit_logs` (extended) plus one new `compliance.access_events` table for logins and AI-link use.
  - DPDP: the existing `dpdp.event` (already hash-chained, already sealed daily) gets the same stamp columns.
  - Tambola: runs on its own Cloudflare D1 database (SQLite), so it cannot write to Supabase tables. It gets a small `trail` table with the same field names.
- The owner asked for "one table design". Honest answer: one table SHAPE and one set of field names, two new-or-extended tables inside Supabase (access log vs change log, because volume and retention differ), plus the product-local stores that already exist. Forcing Tambola's data into Postgres would add a network dependency to a free product. Owner may overrule (decision D1).
- Recommended tamper-evidence: append-only everywhere (already true for audit_logs), no hash chain for PROJEXA or Tambola, keep the existing chain for DPDP.
- Recommended first build: additive columns on `compliance.audit_logs` plus one small pure TypeScript "stamp" module and its test (section 7).

## 1. Field list and what already covers it

"Covered" means the column exists today. Verified from `drizzle/` and live `information_schema`.

| Wanted | Where it exists today | Gap |
|---|---|---|
| actor person | `audit_logs.user_id`, `actor_name`, `actor_role`; `projexa_change_log.actor_id`; `dpdp.event.actor_identity_id`, `actor_label` | Tambola has no accounts (seat or organizer hash only) |
| actor org | `audit_logs.org_id`; `projexa_*.org_id`; `dpdp.event.org_id` | none |
| channel (browser / AI / offline / online / sync) | `audit_logs.surface` (0619) is a DIFFERENT idea: which of 4 product surfaces | NEW `channel` column. Do not overload `surface` |
| machine (device) id | `projexa_sync_op.device_id` (push, regex `[A-Za-z0-9_-]{8,64}`); `dpdp.event.device` (free text); PROJEXA keeps a device id in `local-first/device-meta.ts` | not on `audit_logs`; browser web calls do not send it |
| AI name | `platform.user_ai_links.label` (free text the person typed), `product` | NEW `ai_name` on the event; a label is not an identity, see 2.2 |
| AI session id | `ai_work_link_call.id` (one row per HTTP call) and `link_id` | the event does not point at the call row; NEW `ai_call_id`, `ai_link_id` |
| server date-time | `audit_logs.created_at` (a `timestamp` without time zone in schema.ts) | NEW `server_at timestamptz`; keep `created_at` |
| machine-reported date-time | nothing stored. `projexa_sync_op.created_at` is server time | NEW `client_at timestamptz` and `clock_skew_ms` |
| internet id | none | UNKNOWN what the owner means (ISP? login e-mail? network type?). I assume "IP prefix plus network type". Decision D3 |
| IP address | `audit_logs.ip_address` (full); `ai_work_link_call.ip_prefix` (/24 or /48 only) | for offline and peer edits the IP is the relaying machine's, not the author's. See section 4 |
| user agent family | `audit_logs.user_agent` (full string); `ai_work_link_call.ua_family` | add `ua_family` so the full string can be dropped later |
| per change: entity | `audit_logs.entity_type`, `entity_id`; `projexa_change_log.kind`, `record_id` | none |
| action create/edit/delete/restore/import | `audit_logs.action` free text; `projexa_change_log.op` | free text gives no guarantee. NEW CHECK-listed `action_class` beside it |
| before / after, field diff | `audit_logs.details` (free text); `projexa_change_log.content_hash` (hash only, no values) | NEW `diff jsonb` ({field: [old, new]}), not full copies; sensitive fields masked (section 4) |
| source (UI / AI link / outbox replay / peer sync) | partly `channel`; `projexa_sync_op.function_id` | NEW `source`, CHECK-listed: `ui`, `ai_link`, `outbox_replay`, `peer_sync`, `server_job`, `import` |
| correlation id, offline edit to later sync | `projexa_sync_op.op_id` (unique per user, never reused with other content) | NEW `correlation_id` = the op_id. It already exists on the laptop at edit time, which is exactly what is needed |

Two things already exist and must not be duplicated:
1. `platform.projexa_change_log` (seq, xid, org, project, kind, record_id, version, op, content_hash, actor_id, db_role, at), written by an AFTER trigger that never blocks a business write. It is the sync feed, not a human audit trail (no IP, no device, no diff). Keep it. The audit event links to it by (org, kind, record_id, version).
2. `dpdp.event` (id, org, actor, kind, summary, detail, route, device, occurred_at, prev_hash, hash, sealed_in_batch) plus `dpdp.daily_seal` and `dpdp.access_log`. DPDP already has a hash chain and a daily seal. Do not replace them.

## 2. Table design and write path per channel

### 2.1 Tables

Column names are the same in all stores.

A. `compliance.audit_logs` (exists, 19 columns, UPDATE/DELETE revoked from `app_runtime` and `service_role`, see 0005 and 0236). ADD, all nullable, additive, same style as 0337:

```
product         text          -- 'projexa' | 'veridian_dpdp' | 'tambola'   (CHECK)
channel         text          -- 'web' | 'ai' | 'offline' | 'online' | 'sync'   (CHECK)
source          text          -- list in section 1   (CHECK)
action_class    text          -- create|edit|delete|restore|import|other   (CHECK)
device_id       text          -- per-install random id, <=64 chars
ai_name         text          -- server-derived (2.2)
ai_link_id      text          -- no FK (call log is dropped after 90 days)
ai_call_id      text          -- ai_work_link_call.id, no FK
client_at       timestamptz   -- what the machine said
server_at       timestamptz   -- default now()
clock_skew_ms   integer       -- server_at minus client_at, computed on write
ip_prefix       text          -- /24 or /48 (full address: decision D4)
ua_family       text
correlation_id  text          -- the offline op_id, or a request id online
relay_device_id text          -- peer sync: the laptop that pushed it
diff            jsonb         -- {field: [old, new]}
```
Indexes: (org_id, correlation_id) and (org_id, entity_type, entity_id, server_at desc).

B. NEW `compliance.access_events` (login, logout, failed login, session start, AI link used, new device). Append-only like audit_logs. Columns: id, server_at, org_id, user_id, product, channel, event (login_ok, login_fail, logout, ai_link_call, device_new), device_id, ai_name, ai_link_id, ai_call_id, client_at, clock_skew_ms, ip_prefix, ua_family, session_id, detail jsonb. Separate table because failed logins and AI calls are far more numerous than changes and need a shorter retention. RLS as audit_logs (`org_id = current_org_id()`); written only through one SECURITY DEFINER function.

AI calls: `ai_work_link_call` already logs every call for 90 days (monthly partitions dropped). Do NOT copy every call into `access_events`. Write an access event for the first call of a link per day and for denied calls; the call log stays the detail source. Every change made through AI gets an `audit_logs` row, because the call row will vanish after 90 days.

C. DPDP: `dpdp.event` gets `channel, source, device_id, ai_name, ai_call_id, client_at, clock_skew_ms, ip_prefix, ua_family, correlation_id` (it already has `device` and `route`). The hash input is extended in one place with a `hash_version`, so old rows still verify. UNKNOWN: where the hash function lives; read it before building.

D. Tambola (Cloudflare D1): `trail(id, at_ms, eid, actor_kind, actor_ref, channel, source, action_class, entity, entity_id, diff, device_id, ip_prefix, ua_family, ai_name, correlation_id)`. `eid` (the game) ties retention to the existing game purge (`life.purged_ms`, migration 0004). One migration file; the existing migrations test keeps SCHEMA in sync.

### 2.2 Write path per channel (who sets which field)

Principle: the server sets everything it can observe. The client may only supply `client_at`, `device_id` and `correlation_id`, and these are stored as "claimed".

1. Browser (online web). The route already calls `logActivity(request)`, which reads IP and user agent. New: `channel='web'` (or `online` for the installed local-first app while connected; decision D2), `source='ui'`, `device_id` from header `x-px-device` (the id the laptop already keeps), `client_at` from `x-px-client-time`, `server_at` now, skew computed. `correlation_id` = request id.
2. AI link (the AI cannot forge it). The Edge Functions `ai-work-link` and `ai-work-link-exec` resolve the link from the secret token and write `ai_work_link_call` through a SECURITY DEFINER function. The execution function (not the AI's request body) passes `channel='ai'`, `source='ai_link'`, `ai_link_id`, `ai_call_id`, `ai_name` into the SQL that performs the write. `ai_name` is server-derived: `user_ai_links.label` plus the user-agent family the call row already keeps. UNKNOWN: whether AI clients report a model name; if they do, keep it as a separate `claimed` value inside `diff`-style metadata, never in `ai_name`. The write function must strip any `channel`, `source`, `ai_*`, `server_at` key found in the AI's own params, and a test proves it. The change is attributed to the PERSON who owns the link (`user_id`) with `channel='ai'`, so both the person and the AI are visible (decision D9).
3. Offline outbox. The laptop writes locally, assigns `op_id` (this becomes `correlation_id`) and records `client_at` with the op (NEW: UNKNOWN whether the outbox row stores a time today; check `outbox-merge.ts` and `local-writes.ts`). On `POST /push {device_id, ops:[...]}` each op carries `client_at`. The audit row is written when the op is APPLIED, inside the same transaction as the write (in `projexa_sync_push_*`): `channel='offline'`, `source='outbox_replay'`, `server_at` apply time, `client_at` from the op, skew computed, `device_id` from the push body, IP and UA from the push request. Say plainly in the notice that this is the sync request: an edit made at home and synced from an office shows the office IP. A `duplicate` op writes nothing (idempotent). A `conflict` op writes an event only (detail holds the losing op), so a rejected edit is still traceable.
4. Peer sync (laptop to laptop). The author's laptop hands ops to a peer; the peer pushes. `device_id` = author laptop (carried in the op, claimed), `relay_device_id` = pushing laptop (observed), `channel='sync'`, `source='peer_sync'`. The transport does not prove the author. Proof available today: the peer attest token binds a laptop key (`cnf.jkt`). UNKNOWN whether ops are signed with it. For a low-security product: store both ids, label the author device as claimed, do not build op signing.
5. Server jobs and imports: `source='server_job'` or `'import'`, `channel='online'`, device null.

Clock rule: never order or decide anything by `client_at`. It is evidence only. A skew over 5 minutes is visible in `clock_skew_ms` for reports.

## 3. Tamper-evidence (proportionate)

- (a) Append-only: UPDATE and DELETE revoked, plus a guard trigger like `ai_work_link_call_guard`. `audit_logs` already has the privilege part (0005, 0236). New cost: none.
- (b) Hash chain per org (each row holds the previous row's hash). Cost: an ordering lock on every change, and offline sync replays out of order, so concurrent writes make it fragile.
- (c) Daily seal: hash the day's rows and store the head elsewhere. DPDP has this (`dpdp.daily_seal`).

Recommendation:
- PROJEXA: (a) only. (b) would slow every write and sync for little gain. Optional nightly row-count per org per day (cheap) so a bulk deletion by a superuser is at least noticed (decision D6).
- DPDP: keep what exists ((b)+(c)); the new stamp columns go inside the hashed content with a `hash_version`.
- Tambola: (a) by having no delete path in code for `trail`; games are short-lived and purged on their own timer.
Honest limit: a database superuser can still alter any of this. Only an external copy would stop that.

## 4. DPDP angle (IP, device id, user agent are personal data)

These are OWNER DECISIONS. I am not a lawyer; statements about the law need a lawyer's check (UNKNOWN).

Purpose (one sentence): keep the account safe, prove who changed what and when, settle disputes. Basis: legitimate use for security and accountability, declared in the privacy notice. Not used for marketing or analytics.

What to keep:
- IP address: store the prefix only (/24 IPv4, /48 IPv6), as `ai_work_link_call.ip_prefix` already does. The full address doubles the personal data held and is rarely needed. Conflict: "100% traceable" may be read as "full IP" (decision D4). If full IP is wanted: keep it 90 days, then a scheduled SECURITY DEFINER function cuts it to the prefix. That function is the single allowed update path (it may only touch that column), and it must be tested. Without it, full IPs would stay forever; I do not recommend that.
- Device id: a random value made on first run on that install. NEVER a hardware id, MAC or fingerprint. It resets when site data is cleared.
- User agent: keep only `ua_family` ("Chrome on Windows") on new rows. Old `audit_logs.user_agent` values go in the retention job.
- Diff values: mask fields flagged personal (phone, e-mail, address, ID numbers) as masked plus a hash, so equality can still be shown. Needs a field list per entity; UNKNOWN size.

Retention proposal (decision D5):
- access events (logins, AI calls): 12 months.
- change log: 3 years for PROJEXA; DPDP product as long as the compliance records it describes (owner and lawyer decide). I believe the DPDP rules want logs kept at least a year; UNKNOWN, verify.
- Tambola: removed with the game purge; organizer events 12 months.
- Mechanism: drop monthly partitions where the table is partitioned (the `ai_work_link_call_retention` pattern). `audit_logs` is not partitioned, so v1 is a scheduled function that nulls IP, device and UA on old rows and keeps the event.

Access: a person sees their own events (read-only "My activity" list in Settings); an org admin sees the org's.
Erasure: do not delete audit rows on an erasure request. Replace `user_id` and `actor_name` with a one-way pseudonym and null IP, device and UA. "Someone changed X on date Y" stays (accountability, legal claims). The notice says so.

Draft notice text (short, for owner and lawyer review):
"To keep your account safe and to show who changed what, we record when you sign in or change something: the time, your approximate network address, the kind of browser or device, and a random device code made by this app. AI helpers you connect are recorded the same way. We keep sign-in records for 12 months and change records for 3 years. After 90 days we remove the exact network address and keep only its first part. You can see your own records in Settings and ask us to remove your name from them; we keep the record of the change itself."

## 5. How each product plugs in, and effort

| Product | Store | Minimal work | Effort | Unknowns |
|---|---|---|---|---|
| DPDP app | `dpdp.event` | add stamp columns, pass the request stamp into the existing event writer, extend hash with `hash_version` | LOW-MEDIUM (chain exists) | I did not read the hash function |
| PROJEXA | `audit_logs` + `access_events` | columns, stamp helper, two headers sent by the web client, `client_at` on push ops, audit row inside the push SQL | MEDIUM (push SQL is delicate) | outbox time field; AI-link strip needs its own test |
| Tambola | own D1 `trail` | one migration, one `record()` helper in the worker called from claim, winner and organizer routes | LOW-MEDIUM | I did not read all routes; no accounts, so actor is a seat or organizer hash; may have no device id |

Order by value for effort: 1) central `audit_logs` columns (browser and the AI-link "cannot forge" part, the owner's strongest ask), 2) DPDP (smallest delta, highest legal need), 3) offline and sync correlation (needs a client outbox change), 4) Tambola. DPDP is the cheapest in code but its hash change needs care, so it is second.

## 6. Phased build plan and proof plan

Programme rules in every phase: a committed test, driven through the real surface, seen to FAIL when the behaviour is broken (plant the break, watch it fail, revert), then merged on green CI. Migrations are applied live only by the PM through the Supabase MCP after merge; each has a down file. Check `ai-os/boss/ACTIVE-CLAIMS.yaml` before each phase (I registered no claim; design only).

1. Columns + stamp module + optional `logActivity` param (section 7). Proof: PGlite test inserts through the real `logActivity` and re-reads the row. Plant: break the prefix cut, the test fails.
2. Browser and AI link. Proof: a route test with headers reads `audit_logs`; an AI-link test sends forged `channel`, `ai_name` in params and asserts the stored values are the server's. Plant: remove the strip, test fails.
3. `access_events` and login, failed login, AI-link first call writers. Proof: real login route in test mode; `app_runtime` cannot UPDATE or DELETE (privilege test).
4. Offline outbox and push. Proof: PGlite push test: op with `client_at` and `device_id` applied gives one audit row with `correlation_id = op_id` and skew; the same op twice gives ONE row; a conflict op gives the conflict event. Browser proof in real Chrome or Playwright (the in-app browser cannot register service workers): edit offline, reconnect, read the audit row by correlation id.
5. Peer sync `relay_device_id`. Proof with two simulated devices.
6. DPDP `dpdp.event` columns and `hash_version`. Proof: old rows still verify; a row with tampered `channel` fails verification.
7. Tambola `trail`. Proof: the existing edge test harness; migration test keeps SCHEMA identical.
8. Retention, erasure, "My activity" list, notice live. Proof: seed old rows, run the function, assert IP cut and event kept; erasure keeps the event with a pseudonym.

Every phase is its own PR. Columns are nullable, so a late phase breaks nothing.

## 7. Exact first small PR

Title: "audit trail phase 1: additive stamp columns and stamp helper (no behaviour change)". No deploy, no live DB change by the PR.

1. `drizzle/0730_audit_trail_stamp_columns.sql` plus `drizzle/down/0730_audit_trail_stamp_columns.down.sql`. Next free number was 0730 on 2026-10-06 (latest on main: 0729); re-check at build time. `ALTER TABLE compliance.audit_logs ADD COLUMN IF NOT EXISTS ...` for the 16 columns in 2.1A, nullable; CHECK constraints added NOT VALID then validated (product, channel, source, action_class). No data rewrite.
2. `src/lib/db/schema.ts`: declare the same columns, timestamps with time zone, so Drizzle does not drift (the `memory_records` lesson in CLAUDE.md).
3. `src/lib/audit-stamp.ts` (new, pure, no DB): `buildStamp(request, opts)` returns server-set fields: validated `device_id` (`^[A-Za-z0-9_-]{8,64}$`, else null), bounded `client_at`, `clock_skew_ms`, `ip_prefix`, `ua_family`. `stripForgedStamp(params)` removes `channel`, `source`, `ai_*`, `server_at` keys from AI-supplied input.
4. `src/lib/audit.ts`: `logActivity()` gets an optional `stamp` param, written only when present. Every existing call site is unchanged.
5. Tests: `src/lib/audit-stamp.test.ts` (IPv4 and IPv6 prefix, bad device id rejected, skew sign, forged keys stripped) and `src/lib/audit-log-stamp.pglite.test.ts` (real `logActivity` into a PGlite copy of the table, row re-read). Plant-and-revert: break the prefix cut and the strip; both tests must fail. Run only those two files with `bun test --isolate`. No build (8 GB RAM).

## 8. OWNER DECISIONS

- D1. One table or one shape? Recommended: one shape, three stores (Supabase central, `dpdp.event`, Tambola D1). Alternative: send Tambola events to Supabase (adds a dependency to a free product).
- D2. Tell "web" from "online" (installed app while connected)? Recommended yes, cheap; if not wanted, drop one value.
- D3. What does "internet id" mean? My assumption: IP prefix plus network type. Confirm or define.
- D4. Full IP or prefix only? Recommended prefix only. If full: 90 days, then cut to prefix.
- D5. Retention: access events 12 months; PROJEXA changes 3 years; DPDP product as long as the records described; Tambola with the game. Lawyer to confirm.
- D6. Hash chain for PROJEXA? Recommended no; optional nightly row-count check.
- D7. Erasure: keep the event, pseudonymise the person. Confirm.
- D8. Notice text in section 4: owner and lawyer approve before any live change.
- D9. AI-made change shows the person, the AI, or both? Recommended both.

## 9. Honest unknowns

- Not read: the DPDP hash function, Tambola route code, PROJEXA outbox timestamps, whether ops are signed by the device key.
- `ai_work_link_call` keeps 90 days; older AI calls cannot be re-derived from it, so the audit row copies the stamp.
- Laptop clocks can be wrong or set by the user; `client_at` is evidence, never proof.
- An offline edit's IP shows the sync location, not the edit location.
- Live DB: only column and table lists were read. Row counts and current RLS policies of `audit_logs` were not re-checked.
- The migration number 0730 may be taken at build time.
