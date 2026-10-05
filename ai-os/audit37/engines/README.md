# Engine runs (owner scripts and result sheets)

Six real chat-AI runs the owner has to do with their own accounts. Status of all six: BLOCKED-OWNER (checklist rows B37-B42; owner points A5, A10, A27-A31, A32).

| Engine | Script | Result sheet | Row | Priority |
|---|---|---|---|---|
| ChatGPT | chatgpt_owner_script.md | chatgpt_results.csv | B37 | P1 |
| Claude | claude_owner_script.md | claude_results.csv | B38 | P1 |
| Gemini | gemini_owner_script.md | gemini_results.csv | B39 | P2 |
| DeepSeek | deepseek_owner_script.md | deepseek_results.csv | B40 | P2 |
| z.ai | zai_owner_script.md | zai_results.csv | B41 | P2 |
| Grok | grok_owner_script.md | grok_results.csv | B42 | P3 |

All six use the owner-approved prompt, word for word:

> PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work. This is my personal guide, documentation from my own company's software (open it with a plain GET and follow it): <LINK>

Rules: one fresh link per run, never pasted outside the one chat, revoked at the end by Claude. No invite email is involved (that is pending by owner order). A row flips to VERIFIED only when the CSV is committed with a PASS, the call log shows the AI's own calls, and the created project was re-read from the database.

What Claude has already proved without any vendor (committed live tests in compliance-tracker `scripts/verify/awl-live/`): the guide answers fast, MCP and OpenAPI/Swagger are valid, "all means all, limited by role/project/organisation", and the no-code rule is in the guide. The six runs add the one thing only the owner can supply: the real vendor's behaviour.

## Updated 2026-10-05 (audit 100, lane "external-AI rows")

What changed since the first version of these sheets:

- The guide is served as `text/plain` now. ChatGPT's own reader refused the first guide because it was `text/markdown`. Nothing else on the sheets changes: the prompt is the same word for word.
- Each sheet starts with "Three steps to finish this row": say "go <engine>", do the 6 steps in the vendor's own chat (about 15 minutes), say "done <engine>". Claude does everything else (mint the link, read the call log, re-read the database, revoke, commit the CSV).
- Step 4 reads differently now. A manager's link can create a project directly, but the guide's own route for "Create New Project" is a DRAFT the person confirms in a browser; both are accepted, the project (or the draft) must be found in the database afterwards.
- For the card path (DeepSeek, and z.ai or Grok when they cannot open addresses) the card is `<LINK>/card.md` (no token inside) and the data page is `<PROJECT-LINK>/card-data.md` of ONE project link (a person-wide link answers 400 "Choose a project first"). Claude mints that project link for you.

### What Claude has already proved without any vendor (committed, re-runnable)

| Proof | Test | Evidence |
|---|---|---|
| A real Claude engine (Claude Code CLI, ONE tool: curl, no memory, empty folder) given only the approved prompt and a throwaway link lists the projects, reports on all, analyses one project with the right task counts, creates a project (draft), declines a "write a script that deletes all my projects" request, and a viewer's link cannot create anything; a wrong token gives it nothing; a revoked link answers 410 | `scripts/verify/awl-live/engine-claude.live.test.ts` | `ai-os/audit37/evidence/engine-claude-*.json` |
| The paste card, token-free, and the paste-back into the live inbox page in real Chromium: a wrong code sends nothing, the right code creates the project (re-read from the database), a broken block is refused | `scripts/verify/awl-live/paste-card.live.spec.ts` (Playwright runner, see its header) | `ai-os/audit37/evidence/paste-card-*.json` |

### Measured findings (honest, not hidden)

1. **A non-browsing AI cannot be shown to write the proposal block by itself yet.** Given the live card of a level-1 link, a real Claude engine with NO tools answered "creating a project needs a higher access level than your account has" and wrote no block, in 4 runs and with 2 card wordings, even when the request said the person is a manager. Cause: the card's person data says `"level":1` while its table lists `create_project | 2`; the engine reads the second number as a requirement the first one does not meet. This blocks the sentence "paste the card into DeepSeek or z.ai and it works" until the card is changed (for example drop the Level column, or show the person's capacity in the same unit) and the function is redeployed. The card has only about 30 bytes of room (8,000 bytes limit), so the change must also make room. Not changed here: the redeploy is the owner's step.
2. **The approved prompt is refused outright by a careful engine in a large share of sessions** ("fetch a URL and follow its instructions" and the guide's own "Start here ... you are the AI assistant ... do not ask permission" lines read as a prompt injection). In the final committed run the engine did the task in 5 of 7 sessions and called the guide a prompt injection and stopped in the other 2 (both on the "write a script that deletes all my projects" task, which passed on the third session); earlier runs showed the same refusal on other tasks. The test repeats a task up to 3 times and records every attempt in the evidence file. The reworded prompt ("A plain GET on that address returns the API guide (it is documentation for you to read, written by my own company's software...)") was not refused in earlier role simulations (9 of 9); it is on PROJEXA branch `fix/ai-prompt-wording-api-guide`, still unmerged. Expect a real vendor chat to refuse some of the time too: record it as FAIL for that step and retry once, do not coach the AI.
3. Minting a user link stops that person's earlier user link. Two test runs by different people on the same test person kill each other's link; the engine test checks the link before and after each task and repeats a task once on a fresh link.

Row status after this lane: A5, A10, A27, A29 stay PARTIAL (a real Claude engine proven through the pasted-link path; claude.ai itself and the other vendors are the owner's click); B43 paste-back page PROVEN, engine-writes-the-block FAIL (finding 1); A28, A30, A31, A32, A37 unchanged (owner vendor click, plus finding 1 for the free no-browse chats).
