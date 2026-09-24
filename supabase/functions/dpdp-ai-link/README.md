# dpdp-ai-link -- the AI link's reader (Supabase Edge Function)

WO-DPDP-012 §7, on the WO-DPDP-011 server-less path. Serves the read-only
page an AI reads, and accepts a draft for one of five verbs. Vercel is not in
this path; the browser side (making the link, confirming a draft) talks to
Postgres directly through the RPCs in `drizzle/0607_dpdp_wo012_ai_link.sql`.

## Endpoints

| Method | Path | Returns |
| --- | --- | --- |
| `GET` | `/functions/v1/dpdp-ai-link/<token>` | clean HTML, no scripts, inline CSS only |
| `GET` | `/functions/v1/dpdp-ai-link/<token>.md` (or `Accept: text/markdown`) | Markdown |
| `POST` | `/functions/v1/dpdp-ai-link/<token>/draft` | `201 { draftId, verb, obligationId, expiresAt, draftUrl }` |

`POST` body: `{ "verb": "ASSIGN|SET_DUE|NOTE|MARK_NA|DRAFT", "obligationId": "<Job id from the page>", "payload": { ... } }`.
Payload shapes and what each verb means are printed on the page itself.

`draftUrl` is `${APP_ORIGIN}/app/#draft=<draftId>.<confirmToken>` -- the
confirm token travels in the URL **fragment** so it never reaches a server
log (WO-012 §2). The dpdp-app reads `location.hash`, calls
`dpdp_ai_draft_preview` to show the draft, and `dpdp_confirm_ai_draft` when
the signed-in person presses Confirm. Until then nothing has changed.

Every response carries `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`,
`Referrer-Policy: no-referrer`, `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff` and a CSP of `default-src 'none';
style-src 'unsafe-inline'`. The HTML also has `<meta name="robots"
content="noindex, nofollow, noarchive, nosnippet">` and no third-party
resource of any kind (WO-012 §2, §0).

## Errors

- Any bad token -- unknown, malformed, expired, revoked, or its person no
  longer an active member -- is `404` with the one sentence
  `This link has expired or was revoked`. No other hint, on purpose.
- A draft the database refuses (a sixth verb, a job outside the link's
  scope, a missing reason for MARK_NA, a malformed date) is `400
  { "error": "<plain English>" }` -- the message comes straight from the
  RPC's own `raise`, so the AI can read it and fix the request.
- `429` after 30 requests per rolling minute from one IP (see below).
- `405` for the wrong method, `413` for a body over 8 KB.

## Rate limit

30 requests per rolling 60 s per client IP (`x-forwarded-for` first hop,
else `cf-connecting-ip` / `x-real-ip`), kept **in memory per isolate**.
Best-effort only: a new isolate starts empty and isolates do not share
state. It blunts a scripted guessing loop against one instance; the
32-byte random token (64 hex chars, only its sha256 stored) is the real
boundary.

## Secrets / configuration

| Name | Source | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | injected by the platform | also used to print the function's own public URL on the page |
| `SUPABASE_SERVICE_ROLE_KEY` | injected by the platform | the only role granted `dpdp_ai_link_read` / `dpdp_draft_action`; never appears in any response or log |
| `APP_ORIGIN` | **set by hand** | origin of the static dpdp-app, e.g. `https://dpdp.example.com` -- used only to build `draftUrl`. Drafts return `500` until it is set. |

```
supabase secrets set APP_ORIGIN=https://<the dpdp-app origin> --project-ref pcrjmlpuqsbocqfwoxod
```

## Deploy note -- `verify_jwt: false`, and why

An AI tool fetches this URL with **no headers at all** -- no `apikey`, no
`Authorization`. Supabase's default JWT gate would return 401 before the
function ran. So this function must be deployed with JWT verification off:

```
supabase functions deploy dpdp-ai-link --no-verify-jwt --project-ref pcrjmlpuqsbocqfwoxod
```

(or `verify_jwt: false` when deploying through the Supabase MCP / dashboard,
or `[functions.dpdp-ai-link] verify_jwt = false` in a `supabase/config.toml`
if one is ever added). The token in the path is the credential; the
database, not this function, decides what that token may see and do.

Apply `drizzle/0607_dpdp_wo012_ai_link.sql` **before** deploying -- the
function calls two RPCs that only exist after it.

## Smoke test after deploy

1. Sign in to the dpdp-app as any member and call
   `supabase.rpc('dpdp_create_ai_link')` (or, from the repo with a test
   JWT, `select public.dpdp_create_ai_link()`); copy `token`.
2. `curl -s https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/dpdp-ai-link/<token>.md`
   -- a Markdown page with the jobs that person can see, and only those.
3. `curl -s -X POST .../dpdp-ai-link/<token>/draft -H 'content-type: application/json' -d '{"verb":"NOTE","obligationId":"<a Job id from step 2>","payload":{"text":"hello"}}'`
   -- `201` with a `draftUrl`. Nothing in the org has changed.
4. `curl -s .../dpdp-ai-link/not-a-real-token` -- `404 This link has expired or was revoked`.
5. Open `draftUrl` in the browser as that same person, confirm; History shows
   `drafted by AI, confirmed by <email> -- added a note to "..."`.

## Files

- `index.ts` -- Deno entry point: routing, rate limit, headers, RPC calls, error mapping.
- `render.ts` -- pure HTML/Markdown renderer (no Deno globals); unit-tested by
  `src/lib/services/dpdp-ai-link-render.test.ts` with `bun test`.
