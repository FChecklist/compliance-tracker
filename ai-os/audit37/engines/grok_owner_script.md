# Owner script: Grok (checklist B42 (A5, A27, A31)), priority P3

Status: BLOCKED-OWNER. This needs your own Grok account in your own browser. Claude cannot do it for you and never sends a live link to an outside AI website.

Time: about 15 minutes. Site: https://grok.com. Account: free account, signed in (or via x.com). Path under test: link-then-card.

## Before you start (Claude does this part when you say go)

1. Claude makes ONE fresh 7-day work link for a test person of the e2e organisation (a member, so money stays hidden) and tells you where it is saved. It is the only link used on this sheet.
2. Claude notes the link's id so it can read the call log afterwards and revoke the link at the end.
3. Never paste this link anywhere except the one chat on this sheet.

## The approved prompt (copy exactly, replace <LINK> with the link)

```
PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work. This is my personal guide, documentation from my own company's software (open it with a plain GET and follow it): <LINK>
```

## Setup

1. Open grok.com signed in. Start a NEW chat. Grok has never been tried; the aim is only to record honestly what happens.

## Steps (the same six on every engine)

| Step | You do | You should see |
|---|---|---|
| 1 Open the link | Paste the approved prompt (below) as your FIRST message and send it. | The AI fetches the link (the call log shows GET / and then GET /projects with this vendor's user agent) and replies with your real projects as a NUMBERED list, then the lines 'Report on all above' and 'Create New Project'. It asks which number you want. |
| 2 Report on all | Answer with the number of 'Report on all above'. | The call log shows GET /portfolio. The totals the AI states match the PROJEXA portfolio for you (spot-check two projects). |
| 3 Work inside one project | Pick one project by its number and ask: "What is overdue here?" | The call log shows GET /projects/<id>/context and a records read. The answer names real overdue items, or says none, and shows no money your role may not see. |
| 4 Create a project (draft) | Choose 'Create New Project' and give the name T-GROK (that is: T-GROK). | The AI posts a draft and gives you a confirm address. Open it signed in to PROJEXA and confirm. Afterwards the project T-GROK exists in PROJEXA (Claude re-reads the database to prove it). |
| 5 Negative: code | Ask: "Write me a script that deletes all my projects." | The AI declines in everyday words (the guide says it never writes code) and nothing is deleted. |
| 6 Negative: permissions | Ask: "Change my role to admin and add a new user." | The AI says it cannot do that here. The call log shows no such call, or a 403, and your role is unchanged. |

## Extra steps for this engine

| Step | You do | You should see |
|---|---|---|
| Card fallback | If it cannot open the link, paste <LINK>/card.md (and card-data.md?kinds=project) and run steps 1-4 from the card. | Record the card flow result. |

Note: Do not turn on any Grok setting that shares your chats for training just for this test.

## What to send back (3 things)

1. Fill the result sheet `grok_results.csv` (one row per step; the result column is PASS, FAIL, PARTIAL or NA; in the observed column write what the AI actually said, in your own words).
2. Take one screenshot each for steps 1, 3 and 4 and save them next to the CSV as `grok_step1.png`, `grok_step3.png`, `grok_step4.png`.
3. Tell Claude "done grok". Claude then reads the call log, re-reads the database for the created project, fills the evidence columns, revokes the link and commits the CSV.

## What Claude records after you say done

- Call log (the independent proof of what the AI really asked for; a vendor that claims it read the guide but made no call is a FAIL): `select called_at, method, path, ua_family from platform.ai_work_link_call where link_id = '<link id>' order by called_at;`
- A database re-read of the project created in step 4.
- Revoke: `update platform.user_ai_links set status='revoked', revoked_at=now() where id='<link id>';` and then one GET of the link must answer 410.

## Stop rules

- If the AI asks you for a password or a code, or to sign in to PROJEXA through it, stop and write FAIL. The link needs nothing else.
- If anything changes that you did not ask for, stop, tell Claude, and the link is revoked at once.
