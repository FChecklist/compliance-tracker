# dpdp-ai-link -- the AI work link's API (Supabase Edge Function)

WO-DPDP-013 v2 Part 1 ("the inside door"), on the WO-DPDP-011 server-less
path, replacing the WO-012 §7 single-page reader (whose addresses still
work, see below). One person makes a link from their page; an AI they paste
it into gets a **manual** and a small **API** over exactly that person's
view -- at one of three authority levels -- and nothing else. Vercel is not
in this path; the browser side (making, listing, revoking a link; confirming
a draft; undoing an action) talks to Postgres through the RPCs in
`drizzle/0610_dpdp_wo013_ai_work_link.sql`.

The link a person pastes is `https://dpdp.veridian-aios.com/ai/<token>`.
`dpdp-app/functions/ai/[[path]].ts` (Cloudflare Pages) forwards every
method, sub-path, query string and body of it to this function unchanged and
restores the intended content-type (the `*.supabase.co` gateway serves HTML
as `text/plain`; this function names the type it meant in
`x-dpdp-content-type`). Directly, the same paths sit under
`https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/dpdp-ai-link/<token>`.

## Levels (WO-013 §1.2)

| Level | What the AI may do | Default |
|---|---|---|
| 0 · read, analyse, report | every GET below | always on |
| 1 · small edits, directly | `POST /actions` with `NOTE`, `SET_DUE`, `ASSIGN` (existing members only), `MARK_NA` -- applied under the person's own authority, recorded "by <person> via AI assistant", flagged for their next Monday email, undoable 24 h | off; chosen per link |
| 2 · anything with legal weight | `POST /drafts` only -- the reply is a confirmation link the person opens, signs in, and confirms | never direct, on any link |

## Endpoints (relative to the link base)

The single source of truth is `api-definition.ts`; the manual's section E
and the router are both generated from it. In brief:

| Method · path | Level | Returns |
|---|---|---|
| `GET /` (also `/manual`, `/manual.md`, `/manual.json`) | 0 | the manual, personalised: the briefing (S, N, P, T, M, W) then the reference (A-G, WO-013 §1.3) |
| `GET /context` | 0 | `{ org, viewer, link, library, counts, verbs, base }` |
| `GET /jobs?part&status&late&today&mine&nobody&page&per_page` | 0 | `{ items, page, perPage, total, pages }` -- also `?format=md\|csv` |
| `GET /jobs/{id}` | 0 | one job in full, with its `playbook` (`?format=md`) |
| `GET /playbook?part&status&late&today&mine&nobody&page&per_page` | 0 | the playbook of every job in the view: markdown by default, `?format=json` for `{ items: [{ job, playbook, source }], ... }` |
| `GET /law/{code}` | 0 | in-force fact from the database + the plain-English topic from `law.ts` (`?format=md`) |
| `GET /report/{summary\|by-person\|by-law\|by-part}` | 0 | structured JSON, or `?format=md\|csv` with the WO-014 footer |
| `GET /history?page&per_page` | 0 | the append-only change log, newest first (`?format=md`) |
| `POST /actions` `{ verb, job_id, value }` | 1 | `201 { actionId, verb, jobId, appliedAt, undoableUntil, undoUrl, recorded }` |
| `POST /drafts` `{ verb, job_id, value }` | 2 | `201 { draftId, verb, jobId, expiresAt, confirmUrl, draftUrl, executableOnConfirm, next }` |
| `GET /snapshot.md` (also `/snapshot`) | 0 | the pre-WO-013 one-page snapshot |

Pre-WO-013 addresses kept: `GET /<token>.md` = `/snapshot.md`;
`POST /<token>/draft` = `/drafts` (which also accepts the old
`obligationId`/`payload` body keys). The one intentional change: `GET
/<token>` now serves the manual, not the snapshot -- the WO's "first thing
any AI reads".

`undoUrl` is `${APP_ORIGIN}/app/#undo=<actionId>.<undoToken>` and
`confirmUrl` is `${APP_ORIGIN}/app/#draft=<draftId>.<confirmToken>` -- both
tokens travel in the URL **fragment** so they never reach a server log
(WO-012 §2). The dpdp-app reads `#draft=` today (DraftConfirm); `#undo=`
has `readUndoFragment()` / `undoAiAction()` in `src/lib/api.ts` for the
screen that follows.

## Errors

JSON `{ "error": "<plain English>", "status": <n>[, "hint"] }`:

- `400` malformed request, or a refusal the database states (a missing
  reason, a bad date, a job outside the view for a write, an unknown verb);
- `401` no token in the address; `404` unknown path, or a job not in this
  view on `GET /jobs/{id}`; `405` wrong method (with `Allow`);
- `403` this link may not do that: a write on a Level 0 link, a Level 2 verb
  on any link, or an action outside the person's own authority ("Only the
  owner can...");
- `410` the one sentence `This link has expired or was revoked` -- unknown,
  malformed, expired, revoked, or the person no longer an active member;
- `413` body over 8 KB; `429` over the rate limit; `500` ours, nothing echoed.

## Every call logged; rate limit

`public.dpdp_ai_link_log_call(token, method, path)` inserts one
`dpdp.ai_link_call` row **before** the call is served (the path never
contains the token) and returns this link's call count for the last 60 s;
`dpdp_ai_link_log_call_result(callId, status, bytes)` completes it once
afterwards. A trigger makes the table append-only (no DELETE; no UPDATE
except that one completion). The rate limit is **120 calls per rolling
minute per link**, decided from that count -- the 121st call is `429` and is
logged too. `dpdp.ai_link.call_count` / `last_used_at` feed "Your AI links".

## Security (WO-013 §1.4)

- The token (32 random bytes, 64 hex) is stored as its sha256 only; the
  plaintext is returned exactly once by `dpdp_ai_link_create`.
- Every token-taking RPC resolves the token through 0607's
  `dpdp__ai_link_for_token`, which refuses expired / revoked / unknown /
  no-longer-a-member with one sentence -- revocation is effective on the next
  call.
- Every row an RPC returns comes from `dpdp__ai_link_job_rows(link)`, which
  applies the one-page visibility rule for the link's own membership (a staff
  or parent viewer sees only their own jobs and the group jobs they are in)
  and, with `hide_emails`, replaces every other person's email with their
  role. History text is masked the same way. Nothing here can return another
  membership's or organisation's data; `dpdp-ai-work-link-rpc.test.ts`
  proves it endpoint by endpoint.
- The service-role key lives only in this function's env; the browser never
  sees it. The browser-side RPCs (`dpdp_ai_link_warning` / `_create` /
  `_list` / `_revoke`, `dpdp_ai_action_undo`, `dpdp_confirm_ai_draft`) are
  `authenticated`-only and resolve the caller from the JWT.
- Level 1 actions run under the link's own person's authority with the same
  rules as their page (`SET_DUE`/`ASSIGN` owner-only; `MARK_NA` owner or
  assignee; `NOTE` anyone). `ASSIGN` never creates an identity or membership.
  Level 2 verbs are refused by `dpdp_ai_link_action` for every link.

## The manual (WO-013 §1.3, WO-014 §4) and the briefing above it

`manual.ts` builds the page from `facts.ts` + `api-definition.ts` + `GET /context` + the link's own jobs, and renders HTML / Markdown / JSON
with the same words. The WO-014 brand line appears once, in the header, as a plain fact; there is no share ask and no instruction to the AI
to share, promote, rank or recommend anything (`src/lib/services/dpdp-ai-manual.test.ts`). **`facts.ts` is an interim source**: once
`dpdp-app/data/veridian-facts.yaml` (WO-013 §4 item 2) lands, regenerate it from there.

**The briefing (owner, 2026-09-30).** The Monday email pastes two lines, or the person pastes only the link. Either way the AI must be able
to do the work from THIS page without thinking hard, so the sections above the WO's reference A-G are written for it:

| Section | What the AI gets |
|---|---|
| `S` Start here | who it works for, their role and responsibilities, this link's level, today's numbers, the five jobs that most need doing, what to do first, how to update, the rules of conduct |
| `N` Where things stand | completion (done / counted, %), pending (open, late, due today, nobody yet), required by today's law, progress by part, and the people who are behind (defaulters) - only for roles that see the whole organisation |
| `P` The jobs to do first | for each of those jobs its playbook: why, who, steps, questions to ask, what done looks like, the note to record, when "not applicable" is honest, and the email to send if an outside firm has to act |
| `T` What to say, ask, answer | the first message (a script with the real numbers), the opening questions, "if the person says ... you do ..." with the exact calls, and answers to what people ask |
| `M` Emails you can draft | reminders for people with late jobs, a status note, and what VERIDIAN sends by itself. The AI cannot send; the person does |
| `W` Where things are | every call and when to use it, files to hand over with fixed names, the folder layout where the person keeps proof (VERIDIAN keeps a fingerprint, not the document), the person's own page |

The words live in `brief.ts` (the brief, the role guide, the script, the menu, the answers, the emails, the paths) and `playbook.ts` +
`playbook-data.ts` (one entry per library job, keyed by the library's own key; a job with no entry gets a general playbook for its part). The
list of jobs carries each job's `templateKey` (drizzle/0665) so the page can pick the playbooks without a call per job. The playbook never
states a section, rule number or penalty of its own: the law behind a job is fetched with `GET /law/{code}` (`law.ts`, with its `verify`
notes). `src/lib/services/dpdp-ai-link-owner-checklist.test.ts` pins the owner's list item by item;
`dpdp-ai-link-playbook.test.ts` pins the playbook's completeness and honesty.

## Deploy note -- `verify_jwt: false`, and why

An AI tool fetches these URLs with **no headers at all**. Supabase's default
JWT gate would return 401 before the function ran, so this function must be
deployed with JWT verification off:

```
supabase functions deploy dpdp-ai-link --no-verify-jwt --project-ref pcrjmlpuqsbocqfwoxod
```

(or `verify_jwt: false` through the Supabase MCP / dashboard). Apply
`drizzle/0610_dpdp_wo013_ai_work_link.sql` **before** deploying -- the
function calls RPCs that only exist after it. `APP_ORIGIN` defaults to
`https://dpdp.veridian-aios.com`.

## Smoke test after deploy

1. Sign in to the dpdp-app as any member and call
   `supabase.rpc('dpdp_ai_link_create', { p_level: 1, p_days: 1 })`; copy `token`.
2. `curl -s https://dpdp.veridian-aios.com/ai/<token>/manual.md` -- the manual,
   section B naming that person and "authority level: 1".
3. `curl -s .../ai/<token>/jobs?late=1` -- JSON `{ items, total, ... }`.
4. `curl -s '.../ai/<token>/report/summary?format=csv'` -- ends with the
   `# Prepared with VERIDIAN ...` line.
5. `curl -s -X POST .../ai/<token>/actions -H 'content-type: application/json' -d '{"verb":"NOTE","job_id":"<id>","value":{"text":"hello"}}'`
   -- `201` with `undoUrl`; History shows `by <email> via AI assistant -- added a note to "..."`.
6. `curl -s -X POST .../ai/<token>/actions ... -d '{"verb":"MARK_DONE",...}'` -- `403 ... has legal weight`.
7. Revoke the link on the page; `curl -s .../ai/<token>/context` -- `410`.

## Files

- `index.ts` -- Deno entry point: call log, rate limit, routing, RPC calls, error mapping.
- `router.ts` -- pure: path parsing, format negotiation, pagination, md/csv renderings (`dpdp-ai-link-router.test.ts`).
- `api-definition.ts` -- the one API definition (router + manual).
- `manual.ts` -- pure: the manual, sections S, N, P, T, M, W and A-G, HTML/md/json (`dpdp-ai-manual.test.ts`, `dpdp-ai-link-brief.test.ts`).
- `brief.ts` -- pure: the task brief, role guide, first-message script, menu, answers, emails, paths and files (`dpdp-ai-link-brief.test.ts`).
- `playbook.ts`, `playbook-data.ts` -- pure: the job playbook, one entry per library job, and the general fallback (`dpdp-ai-link-playbook.test.ts`).
- `facts.ts` -- interim facts (brand line, About text) until `veridian-facts.yaml`.
- `law.ts` -- the citation table, a port of `dpdp-app/scripts/draft-content/law.mjs`.
- `render.ts` -- the pre-WO-013 snapshot page (`dpdp-ai-link-render.test.ts`).

## Ideas for the product (shared suggestion pool)
`POST /suggestions` (any level) lets the AI say what VERIDIAN lacks -- a feature, report, fix or wording -- and `GET /suggestions` reads the one pool every AI on every link shares, so ideas are endorsed rather than repeated. It is a separate table (`dpdp.ai_suggestion`, drizzle/0671): no job, person or organisation row is read or written, an AI can only add an idea or its voice (never edit or delete; votes are append-only), text carrying an email, phone, PAN, Aadhaar, token link or the customer's own name is refused, and the list never shows who sent it. 20 new ideas per link per day. We review from our side: `select * from dpdp.ai_suggestion order by endorse_count desc`, then `public.dpdp_suggestion_set_status(id, status, note)` (service_role only).
