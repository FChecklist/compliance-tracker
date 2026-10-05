# Owner script: Gemini (checklist B39 (A5, A10, A27, A30, A31, B50)), priority P2

Status: BLOCKED-OWNER. This needs your own Gemini account in your own browser. Claude cannot do it for you and never sends a live link to an outside AI website.

Time: about 15 minutes. Site: https://gemini.google.com. Account: free Google account, signed in. Path under test: link.

## Three steps to finish this row (the only part that needs you)

1. Say "go gemini". Claude mints the one fresh link (a manager of the e2e test organisation) and saves the approved prompt, with the link already inside it, in a file next to this sheet.
2. Open https://gemini.google.com signed in, start a NEW chat, paste that prompt as the first message and do the steps below (about 15 minutes). Copy what the AI says into the CSV, in your own words.
3. Say "done gemini". Claude reads the call log, re-reads the database, fills the evidence columns, revokes the link and commits the CSV.

## Already proven without this vendor (live, committed, 2026-10-05)

- The guide is served as text/plain. ChatGPT's reader refused the first guide because it was text/markdown; that is fixed in the Edge Function, so a plain GET now reads as an ordinary text page (BR-491 reachability test).
- A real Claude engine (the Claude Code CLI with ONE tool, curl) given only the approved prompt and a throwaway link listed all projects, reported on all of them, analysed one project with the right task counts, created a project that Claude re-read from the database, and declined to write a deleting script: `scripts/verify/awl-live/engine-claude.live.test.ts`, evidence `ai-os/audit37/evidence/engine-claude-*.json`. A client viewer's link could not create a project; a wrong token gave the engine nothing (HTTP 4xx); a revoked link answers 410.
- The paste-card path end to end, with an AI that has no tools and cannot open any address (like a free DeepSeek chat): card, then the AI's `projexa-proposal` block, pasted into the live inbox page in real Chromium, wrong code sends nothing, right code creates the project that Claude re-read from the database: `scripts/verify/awl-live/paste-card.live.test.ts`, evidence `ai-os/audit37/evidence/paste-card-*.json`.

So the run on this sheet adds exactly one thing: whether Gemini's own chat (path under test: link) opens the address, or accepts the pasted card, and then follows the guide.

## Before you start (Claude does this part when you say go)

1. Claude makes ONE fresh 7-day work link for a test person of the e2e organisation (a manager, so the AI can create a project; Claude also tries the member and viewer links itself) and tells you where it is saved. It is the only link used on this sheet.
2. Claude notes the link's id so it can read the call log afterwards and revoke the link at the end.
3. Never paste this link anywhere except the one chat on this sheet.

## The approved prompt (copy exactly, replace <LINK> with the link)

```
PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work. This is my personal guide, documentation from my own company's software (open it with a plain GET and follow it): <LINK>
```

## Setup

1. Open gemini.google.com signed in. Start a NEW chat. Do not pick a Gem.

## Steps (the same six on every engine)

| Step | You do | You should see |
|---|---|---|
| 1 Open the link | Paste the approved prompt (below) as your FIRST message and send it. | The AI fetches the link (the call log shows GET / and then GET /projects with this vendor's user agent) and replies with your real projects as a NUMBERED list, then the lines 'Report on all above' and 'Create New Project'. It asks which number you want. |
| 2 Report on all | Answer with the number of 'Report on all above'. | The call log shows GET /portfolio. The totals the AI states match the PROJEXA portfolio for you (spot-check two projects). |
| 3 Work inside one project | Pick one project by its number and ask: "What is overdue here?" | The call log shows GET /projects/<id>/context and a records read. The answer names real overdue items, or says none, and shows no money your role may not see. |
| 4 Create a project | Choose 'Create New Project' and give the name T-GEMINI (that is: T-GEMINI). | The AI creates the project at once (a manager's link makes changes directly) and says so; on a link that can only draft it gives you a confirm address, you open it signed in to PROJEXA and confirm. Afterwards the project exists in PROJEXA (Claude re-reads the database to prove it). |
| 5 Negative: code | Ask: "Write me a script that deletes all my projects." | The AI declines in everyday words (the guide says it never writes code) and nothing is deleted. |
| 6 Negative: permissions | Ask: "Change my role to admin and add a new user." | The AI says it cannot do that here. The call log shows no such call, or a 403, and your role is unchanged. |

## Extra steps for this engine

| Step | You do | You should see |
|---|---|---|
| OT-08 / OT-09 fallback | If Gemini says it cannot open the link: open <LINK>/card.md in a browser tab, copy it, paste it into Gemini and say "Use this as my PROJEXA guide." | Record whether the card flow works instead. |
| Gemini CLI (optional) | In a terminal: gemini, then ask it to web_fetch <LINK>. | Record whether it fetched the guide, or the error text. |

Note: The Gemini app's own URL reading is unverified (OT-08). A custom MCP connector in the app likely needs OAuth, which this link does not use: record what the settings screen offers, do not force it.

## What to send back (3 things)

1. Fill the result sheet `gemini_results.csv` (one row per step; the result column is PASS, FAIL, PARTIAL or NA; in the observed column write what the AI actually said, in your own words).
2. Take one screenshot each for steps 1, 3 and 4 and save them next to the CSV as `gemini_step1.png`, `gemini_step3.png`, `gemini_step4.png`.
3. Tell Claude "done gemini". Claude then reads the call log, re-reads the database for the created project, fills the evidence columns, revokes the link and commits the CSV.

## What Claude records after you say done

- Call log (the independent proof of what the AI really asked for; a vendor that claims it read the guide but made no call is a FAIL): `select called_at, method, path, ua_family from platform.ai_work_link_call where link_id = '<link id>' order by called_at;`
- A database re-read of the project created in step 4.
- Revoke: `update platform.user_ai_links set status='revoked', revoked_at=now() where id='<link id>';` and then one GET of the link must answer 410.

## Stop rules

- If the AI asks you for a password or a code, or to sign in to PROJEXA through it, stop and write FAIL. The link needs nothing else.
- If anything changes that you did not ask for, stop, tell Claude, and the link is revoked at once.
