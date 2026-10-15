# Free chat engines: what they can open, read and write (2026-10-06)

Owner objective: the person never opens PROJEXA. All the work (read, report, analyse, create, edit, delete) is done by the free chat engine the person already uses, given only the AI work link.

This file is research from public vendor documentation (all sources accessed 2026-10-06), cross-checked against our own call log (`platform.ai_work_link_call`, last 30 hours, read-only query). No account was used, nothing was typed into any vendor site, and no PROJEXA link was sent anywhere. No product code was changed in this task.

Legend: **DOC** = stated in the vendor's own docs (source number in brackets). **MEAS** = measured in our server logs or earlier audit runs. **UNKNOWN** = not documented and not measured; do not rely on it until tested.

## 1. Capability matrix (free plans, consumer chat UI)

| | ChatGPT (Free) | Gemini app (Free) | Claude.ai (Free) | DeepSeek chat | z.ai Chat | z.ai Agent | Grok (Free) |
|---|---|---|---|---|---|---|---|
| Opens a URL the person typed | Yes, with Search on; web search is on Free and logged out [DOC 2]. MEAS: guide and /projects fetched | Fetches it (MEAS: user agent family "Google", 4 x 200, 33 KB, today) but told the person it could not access the site. Consumer behaviour not documented | Yes when Web search is on: "retrieve content directly from web pages when provided with specific URLs" [DOC 9] | MEAS: no fetch ever logged. Not documented | MEAS: no web tool | Yes (MEAS: fetched everything) | UNKNOWN for consumer app. The API web_search tool "can browse web pages" [DOC 14] |
| Follows links found inside a fetched page | **No for unknown URLs.** Automatic fetching is only for URLs an independent crawler already saw publicly; otherwise the agent tries elsewhere or warns [DOC 3]. Our token URLs are never public, so this is the cause of the /projects/5/context failure (MEAS) | API url_context: only the URLs given, not nested links [DOC 6]. App: UNKNOWN | Yes by the API rule: URLs from earlier fetch results may be fetched [DOC 8]. claude.ai consumer: UNKNOWN (assumed same tool) | n/a | n/a | Yes (MEAS) | UNKNOWN |
| URL the engine builds itself (fetch) | No (not public, not typed) [DOC 3] | UNKNOWN | **No**: cannot fetch URLs that appear only in its own output [DOC 8] | n/a | n/a | Yes (MEAS) | UNKNOWN |
| Link text vs plain URL | Plain https URL in the user message works (MEAS) | UNKNOWN | URL in the user message [DOC 8] | n/a | n/a | plain URL works (MEAS) | UNKNOWN |
| URL length limit for fetching | UNKNOWN | UNKNOWN | **250 characters** (`url_too_long`) [DOC 8] | n/a | n/a | UNKNOWN | UNKNOWN |
| URL that looks like it carries a credential | UNKNOWN | UNKNOWN | Refused unless that same credential is in the user's message [DOC 8] | n/a | n/a | UNKNOWN | UNKNOWN |
| robots.txt | ChatGPT-User: "robots.txt rules may not apply" (user-initiated) [DOC 1] | Google user-triggered fetchers generally ignore robots.txt [DOC 4]. Google-Extended is a robots token only and governs Gemini Apps grounding [DOC 5] | Anthropic bots incl. Claude-User honour robots.txt [DOC 10]; API lists robots.txt as a `url_not_allowed` cause [DOC 8] | n/a | n/a | UNKNOWN | UNKNOWN |
| noindex / nosnippet (X-Robots-Tag) | UNKNOWN | **Risk**: nosnippet keeps content out of AI Overviews / AI Mode, and X-Robots-Tag applies to non-HTML [DOC 7]. Whether the Gemini app honours it: UNKNOWN. Our function sends `noindex, nofollow, noarchive, nosnippet` (MEAS) | UNKNOWN | n/a | n/a | UNKNOWN | UNKNOWN |
| Content types | MEAS: text/markdown refused once (AUDIT-100), text/plain accepted | API: HTML, JSON, plain text, XML, CSV, PDF, images [DOC 6] | text, HTML, PDF only [DOC 8] | n/a | n/a | text/plain fine (MEAS) | UNKNOWN |
| Page size | UNKNOWN (33 KB worked, MEAS) | API: up to 34 MB per URL, 20 URLs per request [DOC 6] | No fixed limit documented; truncation by `max_content_tokens` on the API; free users warned long pages eat usage [DOC 8, 9] | n/a | n/a | UNKNOWN | UNKNOWN |
| Can POST / send headers | No (GET fetcher; Actions retire, see below) | No in chat | No (fetch is GET; no headers) [DOC 8] | No | No | Yes (MEAS: Agent wrote) | UNKNOWN |
| Custom connectors / MCP on Free | **No.** Developer mode and MCP apps: Business, Enterprise, Edu only [DOC 11]. Custom GPTs (and their Actions) retire 2026-12-11; custom actions do not migrate [DOC 12] | Custom apps (MCP) on free personal accounts, but **only 18+, in the US, English** [DOC 13] | **Yes: one custom connector on Free**, with "No sign in" or static credential options [DOC 15] | Not documented | Not documented (API-side MCP tools exist, not the chat) | built-in tools | Connectors for email/files/calendar mentioned [DOC 14b]; custom MCP UNKNOWN |
| File upload | Free and paid; 512 MB per file; 2M tokens per text file; **Free: 3 uploads per day** [DOC 16] | 10 files per prompt, 100 MB each, rolling limits on Free [DOC 17] | 20 files per chat, 500 MB per file (search snippet of [DOC 18], page itself not opened) | 50 files, 100 MB (third-party source only, UNVERIFIED) | UNKNOWN | UNKNOWN | 150 MB per file (third-party, UNVERIFIED) |
| Paste limit | Not documented by any vendor: UNKNOWN for all. Bounded in practice by the context window (Gemini app 1M tokens [DOC 17]) | | | | | | |

Other facts that matter:
- ChatGPT-User is the user agent for user-asked page visits; IP list at openai.com/chatgpt-user.json [DOC 1].
- OpenAI's link-safety design says the person "may see" a warning that a link "isn't verified" [DOC 3]. Whether this also appears when the PERSON clicks a link the model wrote in chat is UNKNOWN (test it: it is one extra click, not a blocker).
- Gemini Notebook (free) imports a web URL as a source (text only, nested pages not imported, 50 sources) and its fetcher `Google-GeminiNotebook` ignores robots.txt [DOC 4, 19]. It is a second Gemini read path worth a test.
- The URL fragment (`#...`) is not part of the request target, so no server, fetcher or link-preview bot receives it [DOC 20]. HTTP recommends supporting URIs of at least 8000 octets [DOC 20].

## 2. The five most important findings

1. **ChatGPT will only open the exact addresses the person typed.** OpenAI's documented link-safety rule lets an agent fetch automatically only URLs already seen publicly by an independent crawler [DOC 3]. A token URL is never public, so every link inside our pages is dead to ChatGPT, by design, forever. This fully explains the 2026-10-06 measurement. Consequence: one typed address must return everything.
2. **Claude can follow links inside our pages, but not URLs it builds, and not URLs over 250 characters** [DOC 8]. It also refuses a URL that looks like it carries a credential unless that credential is in the person's message. If the person types a SHORT link but our page links to the long `pxa_...` form, Claude may refuse the inner links: inner links must reuse the exact form the person typed.
3. **Gemini's failure is most likely our own `nosnippet` header, not text/plain.** The Gemini fetcher got 200 four times today. Google documents that `nosnippet` keeps content out of its AI answer features and that X-Robots-Tag applies to non-HTML [DOC 7]. Not proven for the Gemini app: it is a one-header A/B test (change 2).
4. **No free engine can POST to us from the chat box except z.ai Agent; only Claude Free can add our MCP server** (one custom connector, no-sign-in option) [DOC 15]. ChatGPT Free has no custom MCP [DOC 11], and Custom GPT Actions retire on 2026-12-11 [DOC 12]. Gemini custom apps are US-only [DOC 13]. So for ChatGPT, Gemini (outside the US), DeepSeek, z.ai Chat and Grok, a write needs ONE human click on a page we control. That click is also the safest possible approval.
5. **The confirm-link idea already half exists.** `projexa-link-pages/ai-inbox.html` already reads `#t=<token>&p=<base64url JSON>` from the fragment and never sends the fragment to any server. Two gaps: (a) language models are unreliable at base64 by hand, so the fragment should be plain percent-encoded words; (b) chat-only engines (DeepSeek, z.ai Chat) cannot read anything we serve, so for them "never open PROJEXA" is impossible: the floor is one paste or one file upload, and ChatGPT Free allows only 3 uploads a day [DOC 16].

## 3. Evaluation of the hypothesis

**(a) READ: one address per person that returns everything inline.** Correct, and required by finding 1. Rules for it: plain text, served as `text/plain; charset=utf-8`; the most useful content first (all projects, overdue items, money where role allows), details after; keep it far below any cap (aim at most 100 KB; the 33 KB guide works for ChatGPT, MEAS); no reliance on any link inside it; same address re-fetched after a change shows the change (the page must include "latest changes made through this link"). Caching risk: Claude's API fetch may return cached content [DOC 8]; ChatGPT caching UNKNOWN. We already send `Cache-Control: no-store`; whether vendors honour it is UNKNOWN, so the confirm page should also give the person a short receipt line to paste back.

Relay fallback for drill-down on ChatGPT: if a project needs more than the workspace holds, the engine prints the next address on its own line and asks the person to paste it back as their next message. A pasted URL is a user-typed URL, so ChatGPT may fetch it. Costs the person one copy-paste, never a PROJEXA screen.

**(b) WRITE for engines without tools: a confirm link with the proposal in the fragment.** Sound, with corrections:
- Clickable: every chat UI renders a plain https URL as a link (not formally documented by any vendor: UNKNOWN per engine, test it). Tell the engine to put the link ALONE on its own line, plain https, no angle brackets, no code block (a code block is not clickable).
- Length: no vendor documents a limit for a link in an answer: UNKNOWN. The fetch limits do not apply because nobody fetches it; the person clicks it. Keep each link below about 1,500 characters as a working budget (one create or edit easily fits; a batch of up to about 10 small changes fits) until measured.
- Format: drop base64 for engines. Use `#t=<token>&do=<function>&<param>=<value>...` percent-encoded, plus `&n=<plain note>`. Models encode spaces as `%20` far more reliably than they base64-encode JSON. Keep `p=` base64 for backward compatibility.
- Whether an engine refuses to write a link carrying a token: UNKNOWN. Careful engines already refuse the guide as a possible prompt injection (AUDIT-100 finding 2). Expect the same here; mitigation is wording (a person's own tool, a link the person clicks themselves) and a fallback: the engine writes the short `projexa-proposal` block and the person pastes it into the inbox page (works today).
- Safety: the click is the human approval and the only protection against a prompt injection hidden in project data turning into a destructive link. Therefore the confirm page must show the change in plain words, read live from the server (names of the records that will be deleted or changed, amounts), never only what the fragment claims. Recommendation for owner decision: create and edit go with one Confirm click; delete and anything that moves money show the affected records in red and need one extra tick box on the same page; no typed code. The owner's "deletes without asking" rule for level-1 links still applies to tool engines (z.ai Agent, Claude connector); for chat-only engines the click is unavoidable anyway, so nothing is lost by making that click informative.
- Prefetch safety: link-preview bots never see the fragment [DOC 20], and the static page does nothing on load except read (it already only GETs `/history` and POSTs `/check`, a dry run). Keep it that way.

**(c) Engines with tools write directly.** Correct where it exists: z.ai Agent (MEAS), Claude Free with our MCP URL as its one custom connector [DOC 15], Gemini custom apps for US users only [DOC 13]. ChatGPT Free cannot [DOC 11]. Grok: UNKNOWN.

## 4. Ranked design (by feasibility, most feasible first)

1. **Workspace page, one typed address (READ for ChatGPT, Claude, Gemini, z.ai Agent, maybe Grok).** Already being built. Single biggest win; required by ChatGPT's documented rule.
2. **Confirm link with plain fragment (WRITE for every engine that can print a link).** Extend the existing inbox page. One click by the person on a one-screen PROJEXA-hosted page, never the app.
3. **Remove `nosnippet` on the engine-facing text routes, A/B test Gemini.** One header; may unlock Gemini reads. If not, try Gemini Notebook with the workspace URL as a source.
4. **Claude Free connector.** Our MCP endpoint already exists; document a 3-step "add as custom connector, No sign in" path. Full read and write with Claude's own tool approvals, no confirm page.
5. **Relay drill-down** (engine prints the next address, person pastes it back). Zero code beyond wording in the workspace page.
6. **Chat-only engines (DeepSeek, z.ai Chat): one paste or one file.** A `/workspace.txt` download and a "copy everything for my AI" button. The person does touch a page once to copy or download; this is the honest floor for engines without web access. The engine then writes the confirm link (2) for writes.
7. **ChatGPT Custom GPT with Actions:** not recommended; GPTs retire 2026-12-11 and custom actions do not migrate [DOC 12].

## 5. Prompt wording per engine (from the docs)

- ChatGPT: the person must turn on Search (tools menu, or `/` then Search) [DOC 2]; every address must be in the person's own message [DOC 3]. Give ONE address (the workspace), on its own line, full https. Do not ask it to "open the links inside": it cannot.
- Claude: turn on Web search (the + menu) [DOC 9]; ask with a verb about a specific page ("Read this page and ..."), which is what triggers a fetch [DOC 8]. Keep every address at most 250 characters [DOC 8]. Use the same link form (short or long) everywhere.
- Gemini: no documented way to make the app open a URL. Test with the workspace address alone on a line after change 2. Alternative: Gemini Notebook, add the address as a web source [DOC 19].
- DeepSeek, z.ai Chat: do not give an address. Give the pasted workspace text or the file.
- z.ai Agent: the current prompt works (MEAS).
- All engines: the workspace page itself should carry the instruction "to make a change, print ONE link on its own line in this form ..." with a worked example, because ChatGPT cannot read a second page to learn it.

## 6. Concrete change list (for a coder; not done here)

Function = `supabase/functions/ai-work-link/` in compliance-tracker. Pages = `projexa-link-pages/` in compliance-tracker (Cloudflare Pages `projexa-link-pages.pages.dev`). Function changes need a redeploy by the PM.

1. **GET `/workspace` (person link): everything in one text answer.** Files: `handler.ts` (route), `render.ts` (text), `reads.ts` (one SQL read path, time-boxed), `api-definition.ts`, `openapi.ts`. Content order: who and level; numbered projects with status, overdue counts and items, money by role; per-project sections; latest 20 changes made through this link; the confirm-link recipe (change 4). Acceptance: a bun test with a fixture person of 3 projects asserts every project name and every overdue item appear in ONE response, `text/plain`, under 100 KB, and that no fact needed for the six owner tasks lives only behind a link.
2. **Header A/B: drop `nosnippet` on `/`, `/workspace`, `/card.md` (keep `noindex, nofollow`).** File: `handler.ts`. Acceptance: header test; then an owner Gemini run logs 200 and the answer quotes a project name.
3. **Inbox fragment v2: plain key=value proposals.** File: `projexa-link-pages/ai-inbox.html` (and its CSP hash), test `src/lib/ai-links/awl-static-pages.test.ts`. Accept `#t=<token>&do=<fn>&<k>=<v>...&n=<note>`; several changes as `do1=..&do2=..` or repeated groups; keep `p=` base64. Acceptance: a link with `name=Tower%20B%20%26%20Annex` renders "Tower B & Annex"; a malformed link shows "This link could not be read" and sends nothing; the fragment is removed from the address bar.
4. **Recipe in the workspace and manual.** Files: `render.ts`, `manual.ts`. One worked example per common change (create project, add task, mark task done, delete task) with the exact link form, "put the link alone on its own line, no code block". Acceptance: a test takes each example link, runs it through the inbox parser (shared fixture), and gets a `POST /check` that is valid for a level-1 fixture link.
5. **Plain-words confirm screen, read live.** Files: `reads.ts` (`/check` returns a `summary` with the names and amounts of the affected records), `ai-inbox.html` (shows it; delete or money changes in red with one extra tick; no typed code). Acceptance: for a delete, the page shows the task's real title read from the database, not the fragment's text; Confirm stays disabled until the tick; a forged fragment naming a record of another org shows "not found" and sends nothing.
6. **Receipt after confirm.** Files: `ai-inbox.html`, `drafts.ts` or the action answer. Show one line ("Done: task 'X' deleted, receipt R-7F3K") for the person to paste back; the workspace's "latest changes" lists the same receipt. Acceptance: after a confirmed action, a fresh GET `/workspace` contains the receipt.
7. **Same link form inside every page.** Files: `render.ts`, `manual.ts`. Any address we print uses the exact base the request came in on (short or long). Acceptance: a request through the short form returns no `pxa_` long-form addresses in its body.
8. **Download and copy for chat-only engines.** Files: `handler.ts`, `render.ts`: `GET /workspace.txt` with `Content-Disposition: attachment; filename=projexa-workspace.txt`, same body as change 1. Acceptance: header and byte-equality test. (A "copy for my AI" button belongs in the PROJEXA repo, out of scope here.)
9. **Measure the unknowns.** File: `handler.ts`: log a finer user-agent family (keep only the product token, for example `ChatGPT-User`, `Google-GeminiNotebook`, `Claude-User`, never the full string). Acceptance: unit test maps sample user agents to families; the next owner runs fill the UNKNOWN cells in section 1.
10. **Claude connector how-to.** File: `manual.ts` (a short section) plus the owner script `ai-os/audit37/engines/claude_owner_script.md`. Acceptance: an owner Claude Free run with the MCP URL as the one custom connector lists projects and creates a draft, found in the database afterwards.

Owner decisions needed: (D1) one tick for delete and money on the confirm page, or no extra step; (D2) whether a chat-only engine's first confirm per session should also show the person's name and organisation as a phishing check.

## 7. Sources (all accessed 2026-10-06)

1. OpenAI, Overview of OpenAI crawlers: https://developers.openai.com/api/docs/bots (redirect from platform.openai.com/docs/bots)
2. OpenAI Help, Searching the web with ChatGPT: https://help.openai.com/en/articles/9237897-searching-the-web-with-chatgpt
3. OpenAI, Keeping your data safe when an AI agent clicks a link (2026-01-28): https://openai.com/index/ai-agent-link-safety/
4. Google, User-triggered fetchers: https://developers.google.com/search/docs/crawling-indexing/google-user-triggered-fetchers
5. Google, Common crawlers (Google-Extended): https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
6. Google AI for Developers, URL context: https://ai.google.dev/gemini-api/docs/url-context
7. Google, Robots meta tag and X-Robots-Tag: https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
8. Anthropic, Web fetch tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool
9. Claude Help, Enable and use web search: https://support.claude.com/en/articles/10684626-enable-and-use-web-search
10. Claude Help, Does Anthropic crawl data from the web: https://support.claude.com/en/articles/8896518
11. OpenAI Help, Developer mode and MCP apps in ChatGPT: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
12. OpenAI Help, Custom GPT retirement and migration FAQ: https://help.openai.com/en/articles/20001519-custom-gpt-retirement-and-migration-faq
13. Gemini Apps Help, Connect and manage custom apps: https://support.google.com/gemini/answer/17209137?hl=en
14. xAI, Search tools (API): https://docs.x.ai/docs/guides/tools/search-tools ; 14b. xAI, Grok overview: https://docs.x.ai/grok/overview
15. Claude Help, Get started with custom connectors using remote MCP: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
16. OpenAI Help, File uploads FAQ: https://help.openai.com/en/articles/8555545-file-uploads-faq
17. Gemini Apps Help, Upload and analyze files: https://support.google.com/gemini/answer/14903178?hl=en
18. Claude Help, Upload files to Claude: https://support.claude.com/en/articles/8241126-upload-files-to-claude (figures from the search-engine snippet; the page was not opened)
19. Gemini Notebook Help, Add or discover new sources: https://support.google.com/gemininotebook/answer/16215270?hl=en
20. IETF RFC 9110, HTTP Semantics, section 4 (URIs) and 4.1 (length): https://www.rfc-editor.org/rfc/rfc9110
21. DeepSeek API news 2025-01-15 (app features: web search, file upload; no URL reading mentioned): https://api-docs.deepseek.com/news/news250115
22. Z.ai developer docs (API web search and reader tools; the chat and Agent modes are not documented there): https://docs.z.ai/guides/tools/web-search

Not found in any vendor doc (so UNKNOWN above): ChatGPT fetch size and content-type rules; how the Gemini consumer app opens a typed URL; DeepSeek and z.ai consumer URL reading; Grok consumer URL reading and custom connectors; paste limits for every engine; link length limits in every chat UI; whether engines warn on or refuse to print a link carrying a token.

Measurements cited as MEAS: `platform.ai_work_link_call`, 2026-10-05 03:53 UTC to 2026-10-06 02:51 UTC, grouped by `ua_family`, path with token removed; AUDIT-100 notes in `ai-os/audit37/engines/README.md`.
