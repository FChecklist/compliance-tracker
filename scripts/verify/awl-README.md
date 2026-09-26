# The AI work link verify scripts (BR-490 to BR-499, BR-523)

These scripts check the universal AI work link (the Edge Function `ai-work-link`) from the outside, the way a plain AI or a person would reach it.
Every script reads its settings from environment variables, never prints a token (a `pxa_` token in any output is replaced by `pxa_[masked]`),
writes nothing to disk except a temporary folder it removes, and exits **2** with the names of the missing variables when one is not set. A missing
variable is never a pass.

Nothing here needs a deployed function to be built or tested. `bash scripts/verify/awl-scripts.selftest.sh` runs every script against a local stub
and against the Python reference mock, breaks each rule in turn and requires the script to fail (last line `SELFTEST PASS: <n> cases`). The real
handler runs under bun in `src/lib/ai-links/conformance.edge.test.ts` (BR-523). Only the rows marked live-only below need a deployment.

## Which row runs which script

| Row | Command | Runs locally | Needs a deployed function |
| --- | --- | --- | --- |
| BR-490 | `bash scripts/verify/awl-harness.sh readonly` | yes, against the real handler in `conformance.edge.test.ts` and against the mock in the selftest | the row itself points at the deployed link |
| BR-491 | `bash scripts/verify/awl-reachability.sh` | yes (same two places) | live-only for the real host (IPv4, robots.txt, the gateway) |
| BR-492 | `bash scripts/verify/awl-rate-limits.sh` | yes | live-only for the real gateway (spike S-3: which `X-Forwarded-For` entry the gateway trusts) |
| BR-493 | one `curl` command, no script | no | live-only (spike S-2: a Bearer that is not a JWT through the gateway) |
| BR-494 | one `curl` command, no script | no | live-only |
| BR-495 | two `curl` commands and `bash scripts/verify/awl-member-money.sh` | yes | live-only for the row |
| BR-496 | `bash scripts/verify/awl-static-pages.sh` | selftest, and `src/lib/ai-links/awl-static-pages.test.ts` runs it against a local server that serves the real files of `projexa-link-pages/` (U-47b) | live-only: the static host of decision OD-3 must exist and hold those two files |
| BR-497 | one `curl` command, no script | `src/lib/services/ai-work-link-confirm.test.ts` runs the same two calls and more against the real handler and the real SQL on PGlite (U-47b) | live-only: the deployed function, a real draft, and two real sign-ins. While `writes_enabled` is false the SQL answers `not_enabled` before it checks the person, so the 403 half reads 503 live until that order is changed (see the U-47b report) |
| BR-498 | `bash scripts/verify/awl-live-authority.sh` | selftest only | live-only, and it revokes a throwaway link |
| BR-499 | `bash scripts/verify/awl-largest-page.sh` | yes | live-only for the largest project |
| BR-523 | `bun test --isolate src/lib/ai-links/conformance.edge.test.ts` | yes | no |

## Pacing

A link may make 120 calls a minute, and a full harness run makes more than that against link A (H24 reads one address per record kind). The
harness therefore keeps itself under the limit: at most 100 calls to one link in any 60 seconds, and one wait-and-retry on a 429. A full run
against a live deployment takes a few minutes for that reason. `AWL_HARNESS_MAX_CALLS` and `AWL_HARNESS_WINDOW_SECONDS` change the two
numbers; a test that runs the handler on a faster clock shortens the window.

## Variables

Set them in the shell that runs the command. To keep a token out of shell history, read it without echo: `read -rs AWL_TOKEN; export AWL_TOKEN`.

| Variable | Used by | What it is |
| --- | --- | --- |
| `AWL_F` | BR-492, BR-493, BR-497, BR-498 | The function base URL, `https://<project>.supabase.co/functions/v1/ai-work-link`, no trailing slash. |
| `AWL_TOKEN` | BR-493 | The bare token (`pxa_` and 64 hex characters) of one live link. Header mode sends it in a header, so no link URL is needed. |
| `AWL_LINK` | BR-490, BR-491, BR-492, BR-494 | The pasted link of a manager on test project A: `$AWL_F/$AWL_TOKEN`, exactly as a person pastes it. |
| `AWL_LINK_B` | BR-490 | The pasted link of a manager on a different project (project B). |
| `AWL_LINK_M` | BR-490, BR-495 | The pasted link of a member-role person on project A. |
| `AWL_LINK_REVOKED` | BR-490 | The pasted link of a link that was revoked. |
| `AWL_LINK_DEMOTED` | BR-490 | The pasted link of a person who was demoted after the link was minted. |
| `AWL_PROJECT_B_ID` | BR-494 | The id of project B, sent inside a write that the link of project A must refuse with 403. |
| `AWL_LINK_BIG` | BR-499 | The pasted link of a person on the project with the most BOQ lines. |
| `AWL_CONFIRM_HOST` | BR-496 | The host name of the static pages (decision OD-3), for example `inbox.example.pages.dev`. Host only, no scheme or path. `AWL_STATIC_SCHEME=http` exists for a local stub. |
| `AWL_LINK_T_ID`, `AWL_LINK_T` | BR-498 | The id and the pasted link of a throwaway link made only for this test. The script revokes it. |
| `AWL_LINK_D` | BR-498 | The pasted link of the demoted person (the same one as `AWL_LINK_DEMOTED`). |
| `AWL_OWNER_JWT` | BR-498 | The signed-in session token of the person who owns the throwaway link, used only for the revoke call. |
| `VERIFY_DATABASE_URL` | BR-498 | A read connection for a role that sees `platform.user_ai_links` rows (or `VERIFY_SQL_MODE=mgmt` with the management token in the environment); see `scripts/verify/sql-assert.mjs`. Checked before anything is revoked. |
| `AWL_CONFIRM_TOKEN`, `AWL_DRAFT_ID` | BR-497 | A confirm token and the id of a draft that exist for the person who made the draft (the token is returned once by `POST /drafts`; only its sha256 is stored). |
| `AWL_OTHER_USER_JWT` | BR-497 | The session token of a different signed-in person (not the draft's owner), which must be refused 403. |
| `AWL_RATE_WAIT` | BR-492 | Seconds the script waits between the unknown-token series and the rotated series, default 65 (the window is 60 seconds). |
| `AWL_CURL_TIMEOUT` | all scripts | Seconds per request, default 30. |

## How a person with a deployed function and minted test links sets them

1. Deploy `ai-work-link` (see `supabase/functions/ai-work-link/README.md`; `verify_jwt` is false). Set `AWL_F`.
2. On a TEST project with no other activity, mint the links with the app (the link page, or the mint route once that unit is deployed):
   a manager link on project A, a manager link on project B, a member link on project A, and one link on project A that you then revoke.
   Make the demoted link by minting a link as a manager (or member), then lowering that person's role in the app. Make one more link as a
   throwaway for BR-498. Each link is shown once, as a full URL: that URL is the value of the matching variable.
3. Export the variables above for the row you want and run its command. Example for BR-490:

   ```bash
   export AWL_LINK='...' AWL_LINK_B='...' AWL_LINK_M='...' AWL_LINK_REVOKED='...' AWL_LINK_DEMOTED='...'
   bash scripts/verify/awl-harness.sh readonly
   ```

   The last line must be `RESULT: 23 passed, 0 failed`. The 24th check (H20, one real level-1 write and its replay) is `awl-harness.sh full`; it
   changes data, needs writes switched on and stays blocked on spike S-1.
4. The three rows that are one `curl` command (BR-493, BR-494, BR-497) are copied from the register with the variables above set. Each must
   give exit 0.

## Things the scripts refuse to count as a pass

- BR-492 counts a series only if its bucket was clear when it started. If the link's minute was already used, or the unknown-token bucket was
  full, the script says so and exits 1: wait a minute and run again. The rotated `X-Forwarded-For` series runs after a wait for the same reason.
- BR-495 needs a link whose `/context` says `money_visible` is false, a page with at least one BOQ line, and at least one money column to check.
- BR-496 counts a page only if it answered 200, so a 404 page cannot pass by having no Vercel header.
- BR-498 refuses to start when it cannot read the link row afterwards (nothing is revoked in that case). Until level-1 writes are switched on,
  every link is level 0 and the demoted-write check answers 403 for any link: run it again after writes are enabled, with a person who really
  was demoted, before counting it as proof of live authority.
- BR-499 needs a page with rows: an empty page proves nothing about size.

## Detail rows BR-580 to BR-599

Covered without a deployed function by `conformance.edge.test.ts`: BR-581 (ten functions on links, per role), the Edge halves of BR-582 (a whole
harness run calls only the eight read and log SQL functions) and BR-583 (text over 2,000 characters is refused in a dry run; record text has
control characters removed and cannot close the data fence). BR-581 also has its own test, `scripts/gen-ai-link-registry.test.ts`. Waiting for
the executor or the owner: BR-580, BR-584 to BR-586 (spike S-1 and the function secret), BR-588 to BR-597 (the owner's own vendor accounts).
