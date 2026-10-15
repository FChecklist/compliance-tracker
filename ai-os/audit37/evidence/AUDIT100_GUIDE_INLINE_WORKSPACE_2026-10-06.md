# AUDIT-100: guide with the project list inline, /workspace, doc robots (2026-10-06)

**Why.** In the owner's real engine runs on 2026-10-06, ChatGPT, Gemini, DeepSeek DeepThink and z.ai Chat all read the guide. None of them could, or would, open `/projects`. Only z.ai Agent did. ENGINE_CAPABILITIES_2026-10-06.md explains why: ChatGPT opens only addresses the person typed, and Gemini probably refused because the page was marked `nosnippet`.

## What shipped

| PR | Merged | What it does |
|---|---|---|
| #2096 | e93954ba | The guide of a user link now carries the numbered project list itself ("Your projects"). It uses the same reader and renderer as `/projects`, with rows fenced as data, at most 20 rows and an as-of time. GET addresses are Markdown links. Every Markdown answer of a user link ends with an "All addresses" footer. `GET /workspace` (also `/all` and `/workspace.txt`) returns everything in one page. The guide and its documents send `X-Robots-Tag: noindex, nofollow`. The call log now names the AI fetcher. The guide budget went from 40,000 to 46,000 bytes. |
| #2099 | 6909a7ba | `/workspace` sends `noindex, nofollow` as well. The live check after v32 showed it still sent the full value. |

**Deployed:** only `ai-work-link`. v31 changed to v32 (e93954ba), then to v33 (6909a7ba). Both were deployed from a clean checkout of origin/main, under `C:/ct/deploy-ai-work-link.lock`.

## Tests

- **New:** `src/lib/services/ai-work-link-guide-inline-projects.test.ts` (16 tests) and `src/lib/services/ai-work-link-workspace.test.ts` (12 tests).
  - On the old code, 21 of 27 failed. The 6 that passed pin behaviour that has not changed: a project link has no list, data headers are unchanged, the content type is unchanged, and so on.
  - The robots follow-up failed 1 of 11 on the old code.
- **Locally:** 643 tests in 46 files passed with `--isolate`. CI was green on both PRs.

## Live checks (throwaway links, all revoked)

- **v33** (`awl-v33-postdeploy-2026-10-06.json`):
  - The guide was fetched twice. Both times: 200, `text/plain`, robots `noindex, nofollow`, 43,281 bytes, the inline list with 19 of 19 rows, and the footer.
  - `/projects` still sends the full robots value.
  - `/workspace`: 200 in 1.6 s, 24,892 bytes, every section present, nothing marked "not read", and a page-2 line.
  - `/workspace.txt` is served as an attachment.
- **One-fetch simulation** (`one-fetch-claude-*.json`): the Claude Code CLI, allowed one curl of the typed link only.
  - Run 1: the live DB answered 503 ("call log could not be written"). This is the known saturation, not a code fault.
  - Run 2: one GET `/` (call log) returned 200. The engine reported all 19 projects, with real names and figures, from that single fetch. It summarised the list and was cautious; it did not reprint the numbered list word for word.
- **engine-claude.live.test.ts "1 list"** (`engine-claude-2026-10-06T05-07-57-684Z.json`): PASS.
  - One curl call. The call log shows only GET `/` with 200.
  - The answer matched the database total (19) and names.
  - The test's expectation was updated: before this change it required a `/projects` fetch, but the list now comes from the guide.
- **paste-card.live.playwright.ts:** 3 passed and 1 failed, twice.
  - Cause, reproduced directly: the test person (PEOPLE.manager) hit `PROJECT_CAP_DAY`, the limit of 5 new projects a day, after today's runs. `/actions` answered 429.
  - This is not caused by this change. The card, the confirm route and the inbox page were not touched.

## Not done in this pass (next PR)

These are from the coordinator's later list:

- (3) Key=value proposals in the inbox fragment, and "one confirm link alone on its line".
- (4) A confirm screen in plain words, with the D1 tick and the D2 name and organisation.
- (5) A receipt, plus "recent changes by you via AI" in `/workspace`.
- (6) Links that reuse the address form the person typed.
- (8) A Claude.ai connector how-to.

## What the owner should retry

Use the prompts in `C:\ct\logs\owner-prompts\*_prompt_v2.txt`. In these, the main address is the guide and the second address is `<LINK>/workspace`. Mint a fresh link first.

- **ChatGPT, Gemini, DeepSeek:** paste the v2 prompt.
- **Gemini:** the robots header no longer says `nosnippet`.
- **DeepSeek:** turn Search on.
- **With more than 8 projects:** `/workspace` has more pages. The engine will name `<LINK>/workspace?page=2`; paste it when asked.
